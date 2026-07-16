#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pure local Wallpaper Engine workshop folder to mobile MPKG converter."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import os
import re
import shutil
import struct
import tempfile
import time
from dataclasses import dataclass, field
from enum import IntEnum
from io import BytesIO
from pathlib import Path
from typing import BinaryIO, Dict, List, Optional, Tuple

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import lz4.block
    LZ4_AVAILABLE = True
except ImportError:
    LZ4_AVAILABLE = False

try:
    import etcpak
    ETCPAK_AVAILABLE = True
except ImportError:
    ETCPAK_AVAILABLE = False

try:
    import texture2ddecoder
    TEXTURE2DDECODER_AVAILABLE = True
except Exception:
    texture2ddecoder = None
    TEXTURE2DDECODER_AVAILABLE = False


MOBILE_MPKG_MAGIC = "PKGM0020"
WORKSHOP_PREVIEW_EXTENSIONS = ('.gif', '.jpg', '.jpeg', '.png', '.webp')
MOBILE_AUDIO_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'}
TEXTURE_CODECS = ('auto', 'rgba', 'etc2')
TEXTURE_PROFILES = ('fast', 'compact')
REPORT_FILE_NAME = 'conversion-report.json'
DEFAULT_AUTO_RGBA_TEXTURE_THRESHOLD = 600
DEFAULT_AUTO_RGBA_LZ4_COMPRESSION_LEVEL = 7
DEFAULT_AUTO_RGBA_LZ4_MAX_WORKERS = 16

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


def mpkg_debug_enabled() -> bool:
    return str(os.environ.get('WALLHUB_MPKG_DEBUG') or '').strip().lower() in {'1', 'true', 'yes', 'on', 'debug'}


def mpkg_debug_verbose_enabled() -> bool:
    return mpkg_debug_enabled() and str(os.environ.get('WALLHUB_MPKG_DEBUG_VERBOSE') or '').strip().lower() in {'1', 'true', 'yes', 'on', 'debug'}


def debug_log(message: str) -> None:
    if mpkg_debug_enabled():
        logger.info(f"Debug {message}")


def is_numeric_mpkg_output_name(output: Path) -> bool:
    name = output.name
    marker = '.mpkg.tmp-'
    if marker in name.lower():
        name = name[:name.lower().index(marker)]
    elif name.lower().endswith('.mpkg'):
        name = name[:-len('.mpkg')]
    else:
        name = output.stem
    return name.isdigit()


def elapsed_ms(started_at: float) -> int:
    return max(0, int((time.monotonic() - started_at) * 1000))


def auto_rgba_texture_threshold() -> int:
    raw_value = str(os.environ.get('WALLHUB_MPKG_AUTO_RGBA_TEXTURE_THRESHOLD') or '').strip()
    if not raw_value:
        return DEFAULT_AUTO_RGBA_TEXTURE_THRESHOLD
    try:
        return max(0, int(raw_value))
    except ValueError:
        return DEFAULT_AUTO_RGBA_TEXTURE_THRESHOLD


def auto_rgba_lz4_compression_level() -> int:
    raw_value = str(os.environ.get('WALLHUB_MPKG_AUTO_RGBA_LZ4_COMPRESSION_LEVEL') or '').strip()
    if not raw_value:
        return DEFAULT_AUTO_RGBA_LZ4_COMPRESSION_LEVEL
    try:
        return min(12, max(0, int(raw_value)))
    except ValueError:
        return DEFAULT_AUTO_RGBA_LZ4_COMPRESSION_LEVEL


def auto_rgba_lz4_workers(entry_count: int) -> int:
    raw_value = str(os.environ.get('WALLHUB_MPKG_AUTO_RGBA_LZ4_WORKERS') or '').strip()
    try:
        configured_workers = int(raw_value) if raw_value else DEFAULT_AUTO_RGBA_LZ4_MAX_WORKERS
    except ValueError:
        configured_workers = DEFAULT_AUTO_RGBA_LZ4_MAX_WORKERS
    available_workers = os.cpu_count() or 1
    return min(max(1, int(entry_count)), max(1, min(configured_workers, available_workers)))


def resolve_preprocess_texture_codec(requested_codec: str, texture_count: int,
                                     texture_profile: str = 'fast') -> Tuple[str, str]:
    if requested_codec != 'auto':
        return requested_codec, 'requested'
    if texture_profile == 'compact':
        return 'auto', 'compact-auto'
    threshold = auto_rgba_texture_threshold()
    if threshold and texture_count >= threshold:
        return 'rgba', f'texture-count-threshold:{threshold}'
    return 'auto', 'auto'


def normalize_texture_profile(texture_profile: str) -> str:
    return texture_profile if texture_profile in TEXTURE_PROFILES else 'fast'


def resolve_effective_texture_profile(texture_codec: str, texture_profile: str) -> Tuple[str, str, str]:
    requested_profile = normalize_texture_profile(texture_profile)
    if requested_profile == 'compact' and texture_codec == 'auto' and not ETCPAK_AVAILABLE:
        return requested_profile, 'fast', 'etcpak is unavailable; compact profile fell back to fast'
    return requested_profile, requested_profile, ''


def configure_preprocess_texture_profile(report: 'ConvertReport', texture_codec: str,
                                         texture_count: int, texture_profile: str) -> Tuple[str, str]:
    requested_profile, effective_profile, warning = resolve_effective_texture_profile(texture_codec, texture_profile)
    report.requested_texture_profile = requested_profile
    report.effective_texture_profile = effective_profile
    if warning:
        report.warnings.append(warning)
    effective_texture_codec, codec_reason = resolve_preprocess_texture_codec(
        texture_codec,
        texture_count,
        texture_profile=effective_profile,
    )
    report.requested_texture_codec = texture_codec
    report.effective_texture_codec = effective_texture_codec
    report.texture_codec_reason = codec_reason
    return effective_texture_codec, codec_reason


class EntryType(IntEnum):
    BINARY = 0
    TEX = 1


class TexFormat(IntEnum):
    RGBA8888 = 0
    DXT5 = 4
    ETC2_RGBA8 = 5
    DXT3 = 6
    DXT1 = 7
    RG88 = 8
    R8 = 9


class TexFlags(IntEnum):
    IS_GIF = 4
    IS_VIDEO_TEXTURE = 32


class MipmapFormat(IntEnum):
    IMAGE_PNG = 13
    IMAGE_JPEG = 2
    IMAGE_GIF = 25
    VIDEO_MP4 = 35
    RGBA8888 = -102
    COMPRESSED_DXT1 = -103
    COMPRESSED_DXT3 = -104
    COMPRESSED_DXT5 = -105
    COMPRESSED_ETC2_RGBA8 = -106
    RG88 = -101
    R8 = -100


@dataclass
class PackageEntry:
    full_path: str
    offset: int
    length: int
    bytes: bytes = b""
    type: EntryType = EntryType.BINARY


@dataclass
class Package:
    magic: str = ""
    entries: List[PackageEntry] = field(default_factory=list)


@dataclass
class MpkgFile:
    file_name: str
    file_length: int
    file_start: int
    file_stop: int


@dataclass
class RawTexMipmap:
    width: int
    height: int
    is_lz4: bool
    decompressed_size: int
    payload: bytes
    data: bytes


@dataclass
class RawTexFile:
    format: int
    flags: int
    texture_width: int
    texture_height: int
    image_width: int
    image_height: int
    unk_int0: int
    container_magic: str
    image_count: int
    image_format: int
    is_mp4: int
    mipmaps: List[RawTexMipmap]
    tail_data: bytes = b""


@dataclass
class ConvertReport:
    removed_audio: int = 0
    included_sounds: int = 0
    converted_tex: int = 0
    copied_tex: int = 0
    failed_tex: int = 0
    rewritten_shaders: int = 0
    texture_modes: Dict[str, int] = field(default_factory=dict)
    texture_formats: Dict[str, int] = field(default_factory=dict)
    texture_elapsed_ms: int = 0
    dxt_decoders: Dict[str, Dict[str, int]] = field(default_factory=dict)
    slowest_textures: List[Dict[str, object]] = field(default_factory=list)
    requested_texture_codec: str = ''
    effective_texture_codec: str = ''
    texture_codec_reason: str = ''
    requested_texture_profile: str = 'fast'
    effective_texture_profile: str = 'fast'
    rgba_lz4_hc: Dict[str, int] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def add_mode(self, mode: str):
        self.texture_modes[mode] = self.texture_modes.get(mode, 0) + 1

    def add_texture_format(self, texture_format: str) -> None:
        self.texture_formats[texture_format] = self.texture_formats.get(texture_format, 0) + 1

    def add_dxt_decode(self, decoder_name: str, duration_ms: int) -> None:
        bucket = self.dxt_decoders.setdefault(decoder_name, {'count': 0, 'elapsedMs': 0})
        bucket['count'] += 1
        bucket['elapsedMs'] += max(0, int(duration_ms))

    def add_texture_timing(self, file_name: str, duration_ms: int,
                           input_bytes: int, output_bytes: int) -> None:
        elapsed = max(0, int(duration_ms))
        self.texture_elapsed_ms += elapsed
        self.slowest_textures.append({
            'file': file_name,
            'elapsedMs': elapsed,
            'inputBytes': max(0, int(input_bytes)),
            'outputBytes': max(0, int(output_bytes)),
        })
        self.slowest_textures.sort(key=lambda item: (-int(item['elapsedMs']), str(item['file'])))
        del self.slowest_textures[5:]

    def add_rgba_lz4_hc(self, profile: Dict[str, int]) -> None:
        self.rgba_lz4_hc = {
            'level': max(0, int(profile.get('level', 0))),
            'workers': max(0, int(profile.get('workers', 0))),
            'textures': max(0, int(profile.get('textures', 0))),
            'savedBytes': max(0, int(profile.get('savedBytes', 0))),
            'elapsedMs': max(0, int(profile.get('elapsedMs', 0))),
        }

    def texture_profile(self) -> Dict[str, object]:
        texture_count = self.converted_tex + self.copied_tex + self.failed_tex
        return {
            'textureElapsedMs': self.texture_elapsed_ms,
            'averageTextureElapsedMs': round(self.texture_elapsed_ms / texture_count, 2) if texture_count else 0,
            'textureFormats': dict(sorted(self.texture_formats.items())),
            'dxtDecoders': {
                name: {'count': int(values['count']), 'elapsedMs': int(values['elapsedMs'])}
                for name, values in sorted(self.dxt_decoders.items())
            },
            'rgbaLz4HighCompression': dict(self.rgba_lz4_hc),
            'slowestTextures': list(self.slowest_textures),
        }


def read_i32(reader: BinaryIO) -> int:
    data = reader.read(4)
    if len(data) != 4:
        raise ValueError("Unexpected end of file")
    return struct.unpack('<i', data)[0]


def read_u32(reader: BinaryIO) -> int:
    data = reader.read(4)
    if len(data) != 4:
        raise ValueError("Unexpected end of file")
    return struct.unpack('<I', data)[0]


def read_length_string(reader: BinaryIO, max_length: int = -1) -> str:
    size = read_i32(reader)
    if size < 0:
        raise ValueError(f"Negative string length: {size}")
    read_size = min(size, max_length) if max_length > -1 else size
    data = reader.read(read_size)
    if len(data) != read_size:
        raise ValueError("Unexpected end of file while reading string")
    if read_size < size:
        reader.read(size - read_size)
    return data.decode('utf-8')


def read_c_string(reader: BinaryIO) -> str:
    data = bytearray()
    while True:
        byte = reader.read(1)
        if not byte or byte == b'\x00':
            break
        data.extend(byte)
    return data.decode('utf-8', errors='replace')


def get_entry_type(path: str) -> EntryType:
    return EntryType.TEX if path.lower().endswith('.tex') else EntryType.BINARY


def read_pkg(path: Path) -> Package:
    started_at = time.monotonic()
    try:
        source_size = path.stat().st_size
    except OSError:
        source_size = -1
    debug_log(f"stage=read-pkg start file={path.name} bytes={source_size}")
    with path.open('rb') as f:
        package = Package()
        package.magic = read_length_string(f, 32)
        entry_count = read_i32(f)
        for _ in range(entry_count):
            full_path = read_length_string(f, 255).replace('\\', '/')
            offset = read_i32(f)
            length = read_i32(f)
            package.entries.append(PackageEntry(full_path, offset, length, type=get_entry_type(full_path)))

        data_start = f.tell()
        debug_log(f"stage=read-pkg index-ready entries={len(package.entries)} payloadOffset={data_start}")
        for entry in package.entries:
            f.seek(data_start + entry.offset)
            entry.bytes = f.read(entry.length)
    debug_log(f"stage=read-pkg done entries={len(package.entries)} elapsedMs={elapsed_ms(started_at)}")
    return package


def create_mpkg_header(entry_count: int, magic: str = MOBILE_MPKG_MAGIC) -> bytes:
    magic_bytes = magic.encode('ascii')
    return (
        len(magic_bytes).to_bytes(4, 'little') +
        magic_bytes +
        entry_count.to_bytes(4, 'little')
    )


def parse_mpkg_header(data: bytes) -> Tuple[str, int, int]:
    if len(data) < 8:
        raise ValueError("MPKG is too small")
    magic_len = int.from_bytes(data[:4], 'little')
    if magic_len <= 0 or magic_len > 64 or len(data) < 8 + magic_len:
        raise ValueError("Invalid MPKG header")
    magic = data[4:4 + magic_len].decode('ascii')
    count = int.from_bytes(data[4 + magic_len:8 + magic_len], 'little')
    return magic, count, 8 + magic_len


def parse_mpkg_file_list(data: bytes) -> List[MpkgFile]:
    magic, count, pos = parse_mpkg_header(data)
    if not magic.startswith('PKGM'):
        raise ValueError(f"Invalid MPKG magic: {magic}")

    files: List[MpkgFile] = []
    for _ in range(count):
        name_len = int.from_bytes(data[pos:pos + 4], 'little')
        pos += 4
        name = data[pos:pos + name_len].decode('utf-8')
        pos += name_len
        offset = int.from_bytes(data[pos:pos + 4], 'little')
        pos += 4
        length = int.from_bytes(data[pos:pos + 4], 'little')
        pos += 4
        files.append(MpkgFile(name, length, offset, offset + length - 1))

    data_start = pos
    for file in files:
        file.file_start = data_start + file.file_start
        file.file_stop = file.file_start + file.file_length - 1
    return files


def mpkg_sort_key(path: Path) -> Tuple[str, str]:
    rel = path.as_posix().lower()
    name = path.name.lower()
    return rel.rsplit('/', 1)[0] if '/' in rel else '', name


def collect_files(root: Path) -> List[Path]:
    files = [p for p in root.rglob('*') if p.is_file() and p.name != REPORT_FILE_NAME]
    return sorted(files, key=lambda p: mpkg_sort_key(p.relative_to(root)))


def pack_mpkg_entries(entries: List[Tuple[str, bytes]], output: Path,
                      magic: str = MOBILE_MPKG_MAGIC) -> None:
    started_at = time.monotonic()
    files: List[Tuple[str, bytes]] = []
    for file_name, data in entries:
        normalized_name = str(file_name).replace('\\', '/')
        if Path(normalized_name).name != REPORT_FILE_NAME:
            files.append((normalized_name, data))
    files.sort(key=lambda entry: mpkg_sort_key(Path(entry[0])))
    debug_log(f"stage=pack start files={len(files)} output={output.name}")

    offset = 0
    table = bytearray()
    payloads: List[bytes] = []
    for index, (file_name, data) in enumerate(files, start=1):
        rel_bytes = file_name.encode('utf-8')
        table.extend(len(rel_bytes).to_bytes(4, 'little'))
        table.extend(rel_bytes)
        table.extend(offset.to_bytes(4, 'little'))
        table.extend(len(data).to_bytes(4, 'little'))
        payloads.append(data)
        offset += len(data)
        if index == 1 or index == len(files) or index % 50 == 0:
            debug_log(f"stage=pack collect progress={index}/{len(files)} payloadBytes={offset}")

    output.parent.mkdir(parents=True, exist_ok=True)
    debug_log(f"stage=pack write-start files={len(files)} tableBytes={len(table)} payloadBytes={offset}")
    with output.open('wb') as f:
        f.write(create_mpkg_header(len(files), magic))
        f.write(table)
        for index, data in enumerate(payloads, start=1):
            f.write(data)
            if index == len(payloads) or index % 50 == 0:
                debug_log(f"stage=pack write progress={index}/{len(payloads)}")
    debug_log(f"stage=pack done files={len(files)} outputBytes={output.stat().st_size} elapsedMs={elapsed_ms(started_at)}")


def pack_mpkg(root: Path, output: Path, magic: str = MOBILE_MPKG_MAGIC) -> None:
    entries = [
        (file_path.relative_to(root).as_posix(), file_path.read_bytes())
        for file_path in collect_files(root)
    ]
    pack_mpkg_entries(entries, output, magic)


def unpack_mpkg(path: Path, output_dir: Path, overwrite: bool = False) -> None:
    data = path.read_bytes()
    files = parse_mpkg_file_list(data)
    output_dir.mkdir(parents=True, exist_ok=True)
    for file in files:
        out = output_dir / file.file_name
        if out.exists() and not overwrite:
            raise FileExistsError(f"Output file already exists: {out}")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data[file.file_start:file.file_stop + 1])
        logger.info(f"Extracted file: {file.file_name}")


def align_to_block(value: int, block_size: int = 4) -> int:
    return ((value + block_size - 1) // block_size) * block_size


def parse_tex(data: bytes) -> RawTexFile:
    reader = BytesIO(data)
    if read_c_string(reader) != "TEXV0005":
        raise ValueError("Invalid TEXV magic")
    if read_c_string(reader) != "TEXI0001":
        raise ValueError("Invalid TEXI magic")

    format_val = read_i32(reader)
    flags = read_i32(reader)
    texture_width = read_i32(reader)
    texture_height = read_i32(reader)
    image_width = read_i32(reader)
    image_height = read_i32(reader)
    unk_int0 = read_u32(reader)

    container_magic = read_c_string(reader)
    image_count = read_i32(reader)
    image_format = -1
    is_mp4 = 0
    if container_magic in ("TEXB0003", "TEXB0004"):
        image_format = read_i32(reader)
        if container_magic == "TEXB0004":
            is_mp4 = read_i32(reader)
    elif container_magic not in ("TEXB0001", "TEXB0002"):
        raise ValueError(f"Unknown TEX container: {container_magic}")

    if image_count != 1:
        raise ValueError(f"Unsupported TEX image count: {image_count}")

    mipmaps = []
    for _ in range(read_i32(reader)):
        width = read_i32(reader)
        height = read_i32(reader)
        if container_magic == "TEXB0001":
            data_size = read_i32(reader)
            payload = reader.read(data_size)
            mipmaps.append(RawTexMipmap(width, height, False, data_size, payload, payload))
            continue

        is_lz4 = read_i32(reader) == 1
        decompressed_size = read_i32(reader)
        data_size = read_i32(reader)
        payload = reader.read(data_size)
        if is_lz4:
            if not LZ4_AVAILABLE:
                raise RuntimeError("lz4 is required to read compressed TEX mipmaps")
            mip_data = lz4.block.decompress(payload, uncompressed_size=decompressed_size)
        else:
            mip_data = payload
            if decompressed_size == 0:
                decompressed_size = len(mip_data)
        mipmaps.append(RawTexMipmap(width, height, is_lz4, decompressed_size, payload, mip_data))

    return RawTexFile(
        format_val, flags, texture_width, texture_height, image_width, image_height,
        unk_int0, container_magic, image_count, image_format, is_mp4, mipmaps, reader.read()
    )


def write_mobile_tex(format_val: int, flags: int, texture_width: int, texture_height: int,
                     image_width: int, image_height: int, unk_int0: int,
                     mip_width: int, mip_height: int, payload_data: bytes,
                     use_lz4: bool = True, tail_data: bytes = b"",
                     lz4_compression_level: int = 0) -> bytes:
    if use_lz4:
        if not LZ4_AVAILABLE:
            raise RuntimeError("lz4 is required for mobile TEX output")
        if lz4_compression_level > 0:
            payload = lz4.block.compress(
                payload_data,
                store_size=False,
                mode='high_compression',
                compression=min(12, max(1, int(lz4_compression_level))),
            )
        else:
            payload = lz4.block.compress(payload_data, store_size=False)
        is_lz4 = 1
        decompressed_size = len(payload_data)
    else:
        payload = payload_data
        is_lz4 = 0
        decompressed_size = len(payload_data)

    out = bytearray()
    out.extend(b"TEXV0005\x00")
    out.extend(b"TEXI0001\x00")
    out.extend(struct.pack('<i', format_val))
    out.extend(struct.pack('<i', flags))
    out.extend(struct.pack('<i', texture_width))
    out.extend(struct.pack('<i', texture_height))
    out.extend(struct.pack('<i', image_width))
    out.extend(struct.pack('<i', image_height))
    out.extend(struct.pack('<I', unk_int0))
    out.extend(b"TEXB0004\x00")
    out.extend(struct.pack('<i', 1))
    out.extend(struct.pack('<i', -1))
    out.extend(struct.pack('<i', 0))
    out.extend(struct.pack('<i', 1))
    out.extend(struct.pack('<i', mip_width))
    out.extend(struct.pack('<i', mip_height))
    out.extend(struct.pack('<i', is_lz4))
    out.extend(struct.pack('<i', decompressed_size))
    out.extend(struct.pack('<i', len(payload)))
    out.extend(payload)
    out.extend(tail_data)
    return bytes(out)


def is_recompressible_mobile_rgba_tex(tex: RawTexFile) -> bool:
    return (
        tex.format == TexFormat.RGBA8888.value
        and tex.container_magic == 'TEXB0004'
        and tex.image_count == 1
        and tex.image_format == -1
        and not tex.is_mp4
        and len(tex.mipmaps) == 1
        and tex.mipmaps[0].is_lz4
        and not tex.tail_data
    )


def recompress_mobile_rgba_entry(entry: Tuple[str, bytes], compression_level: int) -> Tuple[Tuple[str, bytes], int]:
    file_name, data = entry
    if not file_name.lower().endswith('.tex'):
        return entry, 0
    try:
        tex = parse_tex(data)
        if not is_recompressible_mobile_rgba_tex(tex):
            return entry, 0
        mipmap = tex.mipmaps[0]
        recompressed = write_mobile_tex(
            tex.format,
            tex.flags,
            tex.texture_width,
            tex.texture_height,
            tex.image_width,
            tex.image_height,
            tex.unk_int0,
            mipmap.width,
            mipmap.height,
            mipmap.data,
            use_lz4=True,
            lz4_compression_level=compression_level,
        )
    except Exception:
        return entry, 0
    saved_bytes = len(data) - len(recompressed)
    if saved_bytes <= 0:
        return entry, 0
    return (file_name, recompressed), saved_bytes


def recompress_mobile_rgba_entries(entries: List[Tuple[str, bytes]], compression_level: int,
                                   max_workers: Optional[int] = None) -> Tuple[List[Tuple[str, bytes]], Dict[str, int]]:
    level = min(12, max(0, int(compression_level)))
    candidate_indexes = [
        index for index, (file_name, _) in enumerate(entries)
        if file_name.lower().endswith('.tex')
    ]
    requested_workers = auto_rgba_lz4_workers(len(candidate_indexes)) if max_workers is None else max_workers
    workers = min(max(1, int(requested_workers)), max(1, len(candidate_indexes)))
    profile = {'level': level, 'workers': workers if level and LZ4_AVAILABLE else 0, 'textures': 0, 'savedBytes': 0, 'elapsedMs': 0}
    if not level or not LZ4_AVAILABLE or not candidate_indexes:
        return entries, profile

    started_at = time.monotonic()
    candidates = [entries[index] for index in candidate_indexes]
    if workers == 1:
        results = [recompress_mobile_rgba_entry(entry, level) for entry in candidates]
    else:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(lambda entry: recompress_mobile_rgba_entry(entry, level), candidates))

    recompressed_entries = list(entries)
    for index, (entry, saved_bytes) in zip(candidate_indexes, results):
        recompressed_entries[index] = entry
        if saved_bytes:
            profile['textures'] += 1
            profile['savedBytes'] += saved_bytes
    profile['elapsedMs'] = elapsed_ms(started_at)
    return recompressed_entries, profile


def mipmap_format(image_format: int, tex_format: int) -> MipmapFormat:
    if image_format != -1:
        try:
            return MipmapFormat(image_format)
        except ValueError:
            return MipmapFormat.IMAGE_PNG
    if tex_format == TexFormat.RGBA8888.value:
        return MipmapFormat.RGBA8888
    if tex_format == TexFormat.DXT1.value:
        return MipmapFormat.COMPRESSED_DXT1
    if tex_format == TexFormat.DXT3.value:
        return MipmapFormat.COMPRESSED_DXT3
    if tex_format == TexFormat.DXT5.value:
        return MipmapFormat.COMPRESSED_DXT5
    if tex_format == TexFormat.ETC2_RGBA8.value:
        return MipmapFormat.COMPRESSED_ETC2_RGBA8
    if tex_format == TexFormat.RG88.value:
        return MipmapFormat.RG88
    if tex_format == TexFormat.R8.value:
        return MipmapFormat.R8
    raise ValueError(f"Unsupported TEX format: {tex_format}")


def decompress_dxt_color_block(block: bytes, is_dxt1: bool) -> List[List[int]]:
    color0, color1 = struct.unpack('<HH', block[:4])

    def rgb565(value: int) -> Tuple[int, int, int]:
        r = ((value >> 11) & 0x1F) << 3
        g = ((value >> 5) & 0x3F) << 2
        b = (value & 0x1F) << 3
        return r | (r >> 5), g | (g >> 6), b | (b >> 5)

    r0, g0, b0 = rgb565(color0)
    r1, g1, b1 = rgb565(color1)
    colors = [[r0, g0, b0, 255], [r1, g1, b1, 255]]
    if is_dxt1 and color0 <= color1:
        colors.append([(r0 + r1) // 2, (g0 + g1) // 2, (b0 + b1) // 2, 255])
        colors.append([0, 0, 0, 0])
    else:
        colors.append([(2 * r0 + r1) // 3, (2 * g0 + g1) // 3, (2 * b0 + b1) // 3, 255])
        colors.append([(r0 + 2 * r1) // 3, (g0 + 2 * g1) // 3, (b0 + 2 * b1) // 3, 255])

    indices = int.from_bytes(block[4:8], 'little')
    return [colors[(indices >> (2 * i)) & 0x3] for i in range(16)]


def decompress_dxt_alpha(block: bytes, is_dxt5: bool) -> List[int]:
    if not is_dxt5:
        alpha = []
        for byte in block:
            lo = byte & 0x0F
            hi = byte >> 4
            alpha.extend([(lo << 4) | lo, (hi << 4) | hi])
        return alpha

    a0, a1 = block[0], block[1]
    codes = [a0, a1]
    if a0 <= a1:
        codes.extend([((5 - i) * a0 + i * a1) // 5 for i in range(1, 5)])
        codes.extend([0, 255])
    else:
        codes.extend([((7 - i) * a0 + i * a1) // 7 for i in range(1, 7)])
    bits = int.from_bytes(block[2:8], 'little')
    return [codes[(bits >> (3 * i)) & 0x7] for i in range(16)]


def _decompress_dxt_python(width: int, height: int, data: bytes, fmt: int) -> bytes:
    rgba = bytearray(width * height * 4)
    block_size = 8 if fmt == TexFormat.DXT1.value else 16
    offset = 0
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            if offset + block_size > len(data):
                break
            if fmt == TexFormat.DXT1.value:
                colors = decompress_dxt_color_block(data[offset:offset + 8], True)
                alpha = [c[3] for c in colors]
            else:
                alpha = decompress_dxt_alpha(data[offset:offset + 8], fmt == TexFormat.DXT5.value)
                colors = decompress_dxt_color_block(data[offset + 8:offset + 16], False)
            for py in range(4):
                for px in range(4):
                    sx, sy = x + px, y + py
                    src = py * 4 + px
                    if sx < width and sy < height:
                        dst = 4 * (sy * width + sx)
                        rgba[dst:dst + 4] = bytes(colors[src][:3] + [alpha[src]])
            offset += block_size
    return bytes(rgba)


def decode_dxt_with_texture2ddecoder(width: int, height: int, data: bytes, fmt: int) -> Optional[Tuple[bytes, str]]:
    if not TEXTURE2DDECODER_AVAILABLE or not PIL_AVAILABLE:
        return None
    if fmt == TexFormat.DXT1.value:
        decoder = texture2ddecoder.decode_bc1
        decoder_name = 'texture2ddecoder-bc1'
    elif fmt == TexFormat.DXT5.value:
        decoder = texture2ddecoder.decode_bc3
        decoder_name = 'texture2ddecoder-bc3'
    else:
        return None
    try:
        bgra = decoder(data, width, height)
        if len(bgra) != width * height * 4:
            return None
        return Image.frombytes('RGBA', (width, height), bgra, 'raw', 'BGRA').tobytes(), decoder_name
    except Exception:
        return None


def decompress_dxt_with_decoder(width: int, height: int, data: bytes, fmt: int) -> Tuple[bytes, str]:
    native = decode_dxt_with_texture2ddecoder(width, height, data, fmt)
    if native is not None:
        return native
    return _decompress_dxt_python(width, height, data, fmt), f'python-dxt{fmt}'


def decompress_dxt(width: int, height: int, data: bytes, fmt: int) -> bytes:
    return decompress_dxt_with_decoder(width, height, data, fmt)[0]


def convert_r8_to_rgba(data: bytes, width: int, height: int) -> bytes:
    pixel_count = width * height
    if PIL_AVAILABLE and len(data) >= pixel_count:
        return Image.frombytes('L', (width, height), data[:pixel_count]).convert('RGBA').tobytes()
    rgba = bytearray(width * height * 4)
    for i, gray in enumerate(data[:pixel_count]):
        rgba[i * 4:i * 4 + 4] = bytes([gray, gray, gray, 255])
    return bytes(rgba)


def convert_rg88_to_rgba(data: bytes, width: int, height: int) -> bytes:
    rgba = bytearray(width * height * 4)
    for i in range(min(width * height, len(data) // 2)):
        r = data[i * 2]
        g = data[i * 2 + 1]
        rgba[i * 4:i * 4 + 4] = bytes([g, g, g, r])
    return bytes(rgba)


def image_payload_to_rgba(image_data: bytes, target_width: int, target_height: int) -> bytes:
    if not PIL_AVAILABLE:
        raise RuntimeError("Pillow is required to decode image-backed TEX files")
    image = Image.open(BytesIO(image_data)).convert('RGBA')
    if image.width > target_width or image.height > target_height:
        image = image.crop((0, 0, min(image.width, target_width), min(image.height, target_height)))
    if image.size == (target_width, target_height):
        return image.tobytes()
    canvas = Image.new('RGBA', (target_width, target_height), (0, 0, 0, 0))
    canvas.paste(image, (0, 0))
    return canvas.tobytes()


def raw_mipmap_to_rgba(tex: RawTexFile, mipmap: RawTexMipmap,
                       target_width: int, target_height: int,
                       report: Optional[ConvertReport] = None) -> bytes:
    fmt = mipmap_format(tex.image_format, tex.format)
    if fmt.value >= 0:
        return image_payload_to_rgba(mipmap.data, target_width, target_height)
    if fmt == MipmapFormat.RGBA8888:
        rgba = mipmap.data
    elif fmt in (MipmapFormat.COMPRESSED_DXT1, MipmapFormat.COMPRESSED_DXT3, MipmapFormat.COMPRESSED_DXT5):
        decode_started_at = time.monotonic()
        rgba, decoder_name = decompress_dxt_with_decoder(mipmap.width, mipmap.height, mipmap.data, tex.format)
        if report is not None:
            report.add_dxt_decode(decoder_name, elapsed_ms(decode_started_at))
    elif fmt == MipmapFormat.R8:
        rgba = convert_r8_to_rgba(mipmap.data, mipmap.width, mipmap.height)
    elif fmt == MipmapFormat.RG88:
        rgba = convert_rg88_to_rgba(mipmap.data, mipmap.width, mipmap.height)
    else:
        raise ValueError(f"Unsupported mipmap format: {fmt.name}")

    if mipmap.width == target_width and mipmap.height == target_height:
        return rgba
    if not PIL_AVAILABLE:
        raise RuntimeError("Pillow is required to resize/pad raw TEX files")
    image = Image.frombytes('RGBA', (mipmap.width, mipmap.height), rgba)
    image = image.crop((0, 0, min(tex.image_width, mipmap.width), min(tex.image_height, mipmap.height)))
    canvas = Image.new('RGBA', (target_width, target_height), (0, 0, 0, 0))
    canvas.paste(image, (0, 0))
    return canvas.tobytes()


def is_static_image_tex(tex: RawTexFile) -> bool:
    if tex.image_format < 0:
        return False
    if tex.image_format in (MipmapFormat.IMAGE_GIF.value, MipmapFormat.VIDEO_MP4.value):
        return False
    if tex.flags & (TexFlags.IS_GIF | TexFlags.IS_VIDEO_TEXTURE):
        return False
    return True


def is_etc2_candidate(rel_path: Path, tex: RawTexFile) -> bool:
    normalized = rel_path.as_posix().lower()
    if not normalized.startswith('materials/'):
        return False
    if '/workshop/' in normalized or normalized.startswith('materials/workshop/'):
        return False
    return is_static_image_tex(tex) or tex.format in (TexFormat.DXT1.value, TexFormat.DXT3.value, TexFormat.DXT5.value)


def texture_format_name(format_code: int) -> str:
    try:
        return TexFormat(format_code).name.lower()
    except ValueError:
        return f'unknown-{format_code}'


def has_transparency(rgba: bytes) -> bool:
    return any(rgba[i] < 255 for i in range(3, len(rgba), 4))


def choose_texture_mode(rel_path: Path, tex: RawTexFile, rgba: bytes,
                        codec: str, report: ConvertReport) -> str:
    if codec == 'rgba':
        return 'rgba'
    if codec == 'etc2':
        if not ETCPAK_AVAILABLE:
            raise RuntimeError("etcpak is required for --texture-codec etc2")
        return 'etc2'
    if not ETCPAK_AVAILABLE:
        report.warnings.append("etcpak is not available; auto texture codec fell back to RGBA8888")
        return 'rgba'
    if not is_etc2_candidate(rel_path, tex):
        return 'rgba'

    area = tex.image_width * tex.image_height
    normalized = rel_path.as_posix().lower()
    # UI icons, masks and highly transparent controls are safer as RGBA8888 on mobile.
    if area <= 512 * 512 and has_transparency(rgba):
        return 'rgba'
    if '/masks/' in normalized or 'icon' in normalized or 'radio_button' in normalized:
        return 'rgba'
    return 'etc2'


def convert_tex_mobile(rel_path: Path, tex_data: bytes, codec: str, report: ConvertReport) -> bytes:
    tex = parse_tex(tex_data)
    report.add_texture_format(texture_format_name(tex.format))
    if not tex.mipmaps:
        report.copied_tex += 1
        report.add_mode('copied-empty')
        return tex_data
    if tex.flags & (TexFlags.IS_GIF | TexFlags.IS_VIDEO_TEXTURE) or tex.is_mp4:
        report.copied_tex += 1
        report.add_mode('copied-video-gif')
        return tex_data
    if tex.tail_data:
        report.copied_tex += 1
        report.add_mode('copied-tail')
        return tex_data

    first = tex.mipmaps[0]
    rgba_width = tex.image_width
    rgba_height = tex.image_height
    if is_etc2_candidate(rel_path, tex) and codec in ('auto', 'etc2'):
        rgba_width = align_to_block(tex.image_width)
        rgba_height = align_to_block(tex.image_height)

    if is_static_image_tex(tex):
        rgba = image_payload_to_rgba(first.data, rgba_width, rgba_height)
    else:
        rgba = raw_mipmap_to_rgba(tex, first, rgba_width, rgba_height, report)

    mode = choose_texture_mode(rel_path, tex, rgba, codec, report)
    if mode == 'etc2':
        etc2_data = etcpak.compress_etc2_rgba(rgba, rgba_width, rgba_height)
        report.converted_tex += 1
        report.add_mode('etc2')
        return write_mobile_tex(
            TexFormat.ETC2_RGBA8.value, tex.flags, rgba_width, rgba_height,
            tex.image_width, tex.image_height, tex.unk_int0,
            rgba_width, rgba_height, etc2_data, use_lz4=True
        )

    report.converted_tex += 1
    report.add_mode('rgba')
    rgba_exact = rgba
    if (rgba_width, rgba_height) != (tex.image_width, tex.image_height):
        if not PIL_AVAILABLE:
            raise RuntimeError("Pillow is required to crop RGBA texture output")
        image = Image.frombytes('RGBA', (rgba_width, rgba_height), rgba)
        image = image.crop((0, 0, tex.image_width, tex.image_height))
        rgba_exact = image.tobytes()
    return write_mobile_tex(
        TexFormat.RGBA8888.value, tex.flags, tex.image_width, tex.image_height,
        tex.image_width, tex.image_height, tex.unk_int0,
        tex.image_width, tex.image_height, rgba_exact, use_lz4=True
    )


def rewrite_shader_numeric_literals(source: str) -> str:
    integer_literal = re.compile(r'(?<![A-Za-z0-9_$.])(-?\d+)(?![A-Za-z0-9_$.])')
    out: List[str] = []
    for line in source.splitlines(True):
        newline = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
        body = line[:-len(newline)] if newline else line
        stripped = body.lstrip()
        if stripped.startswith('#') or stripped.startswith('//') or stripped.startswith('for ') or stripped.startswith('for('):
            out.append(line)
            continue
        code, sep, comment = body.partition('//')

        def repl(match: re.Match) -> str:
            token = match.group(1)
            before = code[:match.start()].rstrip()
            after = code[match.end():].lstrip()
            if before.endswith('[') or after.startswith(']') or re.search(r'[0-9.]e[+-]?$', code[:match.start()], re.I):
                return token
            return f"{token}.0"

        out.append(integer_literal.sub(repl, code) + (sep + comment if sep else '') + newline)
    return ''.join(out)


def rewrite_shader_source(source: str) -> str:
    source = re.sub(r'\bsample\b', '_sample', source)
    replacements = {
        'vec2(1, 0)': 'vec2(1.0, 0.0)',
        'vec2(0, 1)': 'vec2(0.0, 1.0)',
        'vec2(0, -0.5)': 'vec2(0.0, -0.5)',
        'vec2(0, 0.5)': 'vec2(0.0, 0.5)',
        'CAST3(0)': 'CAST3(0.0)',
        'mix(blurred.a, 1, step(blurred.a, 0))': 'mix(blurred.a, 1.0, step(blurred.a, 0.0))',
        '2 * abs(': '2.0 * abs(',
        '30 / 50.0': '30.0 / 50.0',
        '30 / 4.0': '30.0 / 4.0',
        '30 / 8.0': '30.0 / 8.0',
        '30 / 15.0': '30.0 / 15.0',
    }
    for old, new in replacements.items():
        source = source.replace(old, new)
    source = source.replace(
        '#define SMOOTH_CURVE A_SMOOTH_CURVE // For compatability with old wallpapers that get ported to Android\r\n\r\n',
        ''
    ).replace(
        '#define SMOOTH_CURVE A_SMOOTH_CURVE // For compatability with old wallpapers that get ported to Android\n\n',
        ''
    )
    source = re.sub(r'const int sampleCount = (\d+);', r'const float sampleCount = \1.0;', source)
    source = source.replace('const float sampleDrop = sampleCount - 1;', 'const float sampleDrop = sampleCount - 1.0;')
    source = re.sub(r'for \(int i = 0; i < sampleCount; \+\+i\)', 'for (float i = 0.0; i < sampleCount; ++i)', source)
    source = re.sub(r'(v_TexCoord\.[zw] = )0;', r'\g<1>0.0;', source)
    source = re.sub(r'(?<=\de)\+0(?![\w.])', '+0.0', source)
    source = rewrite_shader_numeric_literals(source)
    if '#include "common_blur.h"' in source:
        newline = '\r\n' if '\r\n' in source else '\n'
        source = source.replace('uniform sampler2D g_Texture0; // {"hidden":true}', ' // {"hidden":true}')
        if ' // {"hidden":true}' in source and 'uniform sampler2D g_Texture0;' not in source:
            source = source.replace('#include "common_blur.h"', f'uniform sampler2D g_Texture0;{newline}#include "common_blur.h"', 1)
    return source


def find_preview(input_dir: Path) -> Optional[Path]:
    previews = [p for p in input_dir.iterdir() if p.is_file() and p.stem.lower() == 'preview']
    if not previews:
        return None
    return sorted(previews, key=lambda p: (
        WORKSHOP_PREVIEW_EXTENSIONS.index(p.suffix.lower())
        if p.suffix.lower() in WORKSHOP_PREVIEW_EXTENSIONS else len(WORKSHOP_PREVIEW_EXTENSIONS),
        p.name.lower()
    ))[0]


def read_project_json(input_dir: Path) -> dict:
    with (input_dir / 'project.json').open('r', encoding='utf-8-sig') as f:
        return json.load(f)


def default_output_path(input_dir: Path, project: dict) -> Path:
    workshop_id = str(project.get('workshopid') or '').strip()
    if workshop_id.isdigit():
        return Path(f"{workshop_id}.mpkg")
    if input_dir.name.isdigit():
        return Path(f"{input_dir.name}.mpkg")
    return Path(f"{input_dir.name}.mpkg")


def preprocess_dir(root: Path, texture_codec: str, report: ConvertReport,
                   keep_audio: bool = False, include_sounds: bool = False,
                   texture_profile: str = 'fast') -> None:
    started_at = time.monotonic()
    files = [file_path for file_path in root.rglob('*') if file_path.is_file()]
    tex_total = sum(1 for file_path in files if file_path.suffix.lower() == '.tex')
    shader_total = sum(1 for file_path in files if file_path.suffix.lower() in ('.frag', '.vert'))
    effective_texture_codec, codec_reason = configure_preprocess_texture_profile(
        report,
        texture_codec,
        tex_total,
        texture_profile,
    )
    debug_log(
        f"stage=preprocess start files={len(files)} textures={tex_total} shaders={shader_total} "
        f"requestedProfile={report.requested_texture_profile} effectiveProfile={report.effective_texture_profile} "
        f"requestedCodec={texture_codec} effectiveCodec={effective_texture_codec} codecReason={codec_reason}"
    )
    verbose_debug = mpkg_debug_verbose_enabled()
    tex_processed = 0
    for index, file_path in enumerate(files, start=1):
        rel = file_path.relative_to(root)
        suffix = file_path.suffix.lower()
        in_sounds_dir = rel.parts[:1] == ('sounds',)
        if in_sounds_dir:
            if not (keep_audio or include_sounds):
                file_path.unlink()
                report.removed_audio += 1
                continue
            if include_sounds:
                report.included_sounds += 1
        elif suffix in MOBILE_AUDIO_EXTENSIONS and not keep_audio:
            file_path.unlink()
            report.removed_audio += 1
            continue
        if suffix == '.tex':
            original = file_path.read_bytes()
            texture_started_at = time.monotonic()
            if verbose_debug:
                debug_log(f"stage=tex start progress={index}/{len(files)} file={rel.as_posix()} bytes={len(original)}")
            try:
                converted = convert_tex_mobile(Path(rel.as_posix()), original, effective_texture_codec, report)
            except Exception as exc:
                report.failed_tex += 1
                report.warnings.append(f"{rel.as_posix()}: {exc}")
                converted = original
            if converted != original:
                file_path.write_bytes(converted)
            tex_processed += 1
            texture_elapsed_ms = elapsed_ms(texture_started_at)
            report.add_texture_timing(rel.as_posix(), texture_elapsed_ms, len(original), len(converted))
            if verbose_debug:
                debug_log(
                    f"stage=tex done progress={index}/{len(files)} file={rel.as_posix()} "
                    f"outputBytes={len(converted)} elapsedMs={texture_elapsed_ms}"
                )
            elif tex_processed == tex_total or tex_processed % 25 == 0:
                profile = report.texture_profile()
                debug_log(
                    f"stage=preprocess tex-progress={tex_processed}/{tex_total} sourceProgress={index}/{len(files)} "
                    f"textureElapsedMs={profile['textureElapsedMs']} "
                    f"avgTextureElapsedMs={profile['averageTextureElapsedMs']}"
                )
            continue
        if suffix in ('.frag', '.vert'):
            with file_path.open('r', encoding='utf-8', errors='replace', newline='') as f:
                text = f.read()
            converted = rewrite_shader_source(text)
            if converted != text:
                with file_path.open('w', encoding='utf-8', newline='') as f:
                    f.write(converted)
                report.rewritten_shaders += 1
        if index == len(files) or index % 100 == 0:
            debug_log(f"stage=preprocess progress={index}/{len(files)}")
    debug_log(
        f"stage=preprocess done convertedTex={report.converted_tex} copiedTex={report.copied_tex} "
        f"failedTex={report.failed_tex} elapsedMs={elapsed_ms(started_at)}"
    )
    debug_log(f"stage=preprocess profile={json.dumps(report.texture_profile(), ensure_ascii=False, sort_keys=True)}")


def collapse_last_write_wins(entries: List[Tuple[str, bytes]]) -> List[Tuple[str, bytes]]:
    collapsed: Dict[str, Tuple[str, bytes]] = {}
    for file_name, data in entries:
        normalized_name = str(file_name).replace('\\', '/')
        collapsed[normalized_name] = (normalized_name, data)
    return list(collapsed.values())


def preprocess_package_entries(entries: List[Tuple[str, bytes]], texture_codec: str,
                               report: ConvertReport, keep_audio: bool = False,
                               include_sounds: bool = False,
                               texture_profile: str = 'fast') -> List[Tuple[str, bytes]]:
    started_at = time.monotonic()
    source_entries = collapse_last_write_wins(entries)
    tex_total = sum(1 for file_name, _ in source_entries if Path(file_name).suffix.lower() == '.tex')
    shader_total = sum(1 for file_name, _ in source_entries if Path(file_name).suffix.lower() in ('.frag', '.vert'))
    effective_texture_codec, codec_reason = configure_preprocess_texture_profile(
        report,
        texture_codec,
        tex_total,
        texture_profile,
    )
    debug_log(
        f"stage=preprocess-memory start files={len(source_entries)} textures={tex_total} shaders={shader_total} "
        f"requestedProfile={report.requested_texture_profile} effectiveProfile={report.effective_texture_profile} "
        f"requestedCodec={texture_codec} effectiveCodec={effective_texture_codec} codecReason={codec_reason}"
    )

    verbose_debug = mpkg_debug_verbose_enabled()
    tex_processed = 0
    processed_entries: List[Tuple[str, bytes]] = []
    for index, (file_name, original) in enumerate(source_entries, start=1):
        rel = Path(file_name)
        suffix = rel.suffix.lower()
        in_sounds_dir = rel.parts[:1] == ('sounds',)
        if in_sounds_dir:
            if not (keep_audio or include_sounds):
                report.removed_audio += 1
                continue
            if include_sounds:
                report.included_sounds += 1
        elif suffix in MOBILE_AUDIO_EXTENSIONS and not keep_audio:
            report.removed_audio += 1
            continue

        if suffix == '.tex':
            texture_started_at = time.monotonic()
            if verbose_debug:
                debug_log(f"stage=tex start progress={index}/{len(source_entries)} file={file_name} bytes={len(original)}")
            try:
                converted = convert_tex_mobile(Path(file_name), original, effective_texture_codec, report)
            except Exception as exc:
                report.failed_tex += 1
                report.warnings.append(f"{file_name}: {exc}")
                converted = original
            tex_processed += 1
            texture_elapsed = elapsed_ms(texture_started_at)
            report.add_texture_timing(file_name, texture_elapsed, len(original), len(converted))
            if verbose_debug:
                debug_log(
                    f"stage=tex done progress={index}/{len(source_entries)} file={file_name} "
                    f"outputBytes={len(converted)} elapsedMs={texture_elapsed}"
                )
            elif tex_processed == tex_total or tex_processed % 25 == 0:
                profile = report.texture_profile()
                debug_log(
                    f"stage=preprocess-memory tex-progress={tex_processed}/{tex_total} "
                    f"sourceProgress={index}/{len(source_entries)} textureElapsedMs={profile['textureElapsedMs']} "
                    f"avgTextureElapsedMs={profile['averageTextureElapsedMs']}"
                )
            processed_entries.append((file_name, converted))
            continue

        converted = original
        if suffix in ('.frag', '.vert'):
            text = original.decode('utf-8', errors='replace')
            rewritten = rewrite_shader_source(text)
            if rewritten != text:
                converted = rewritten.encode('utf-8')
                report.rewritten_shaders += 1
        processed_entries.append((file_name, converted))
        if index == len(source_entries) or index % 100 == 0:
            debug_log(f"stage=preprocess-memory progress={index}/{len(source_entries)}")

    if effective_texture_codec == 'rgba' and codec_reason.startswith('texture-count-threshold:'):
        compression_level = auto_rgba_lz4_compression_level()
        if compression_level:
            candidate_count = sum(1 for file_name, _ in processed_entries if file_name.lower().endswith('.tex'))
            debug_log(
                f"stage=rgba-lz4-hc start level={compression_level} "
                f"workers={auto_rgba_lz4_workers(candidate_count)} candidates={candidate_count}"
            )
            processed_entries, lz4_profile = recompress_mobile_rgba_entries(
                processed_entries,
                compression_level=compression_level,
            )
            report.add_rgba_lz4_hc(lz4_profile)
            debug_log(
                f"stage=rgba-lz4-hc done textures={lz4_profile['textures']} "
                f"savedBytes={lz4_profile['savedBytes']} elapsedMs={lz4_profile['elapsedMs']}"
            )

    debug_log(
        f"stage=preprocess-memory done convertedTex={report.converted_tex} copiedTex={report.copied_tex} "
        f"failedTex={report.failed_tex} elapsedMs={elapsed_ms(started_at)}"
    )
    debug_log(f"stage=preprocess-memory profile={json.dumps(report.texture_profile(), ensure_ascii=False, sort_keys=True)}")
    return processed_entries


def collect_input_sound_entries(input_dir: Path, report: ConvertReport) -> List[Tuple[str, bytes]]:
    sounds_dir = input_dir / 'sounds'
    if not sounds_dir.is_dir():
        return []
    sound_files = sorted(
        (path for path in sounds_dir.rglob('*') if path.is_file()),
        key=lambda path: path.relative_to(sounds_dir).as_posix().lower(),
    )
    entries: List[Tuple[str, bytes]] = []
    for source_path in sound_files:
        rel = source_path.relative_to(sounds_dir).as_posix()
        entries.append((f'sounds/{rel}', source_path.read_bytes()))
        report.included_sounds += 1
    return entries


def include_input_sounds(input_dir: Path, temp_dir: Path, report: ConvertReport) -> None:
    sounds_dir = input_dir / 'sounds'
    if not sounds_dir.is_dir():
        return

    sound_files = sorted(
        (path for path in sounds_dir.rglob('*') if path.is_file()),
        key=lambda path: path.relative_to(sounds_dir).as_posix().lower(),
    )
    for source_path in sound_files:
        rel = source_path.relative_to(sounds_dir)
        target = temp_dir / 'sounds' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target)
        report.included_sounds += 1


def write_report(report: ConvertReport, temp_dir: Path, output: Path, texture_codec: str,
                 project: dict, include_report: bool) -> None:
    if not include_report:
        return

    data = {
        "output": str(output),
        "texture_codec": texture_codec,
        "effective_texture_codec": report.effective_texture_codec or texture_codec,
        "texture_codec_reason": report.texture_codec_reason or 'requested',
        "requested_texture_profile": report.requested_texture_profile,
        "effective_texture_profile": report.effective_texture_profile,
        "workshopid": project.get('workshopid'),
        "removed_audio": report.removed_audio,
        "included_sounds": report.included_sounds,
        "converted_tex": report.converted_tex,
        "copied_tex": report.copied_tex,
        "failed_tex": report.failed_tex,
        "rewritten_shaders": report.rewritten_shaders,
        "texture_modes": report.texture_modes,
        "texture_profile": report.texture_profile(),
        "warnings": report.warnings,
    }
    (temp_dir / REPORT_FILE_NAME).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def convert_workshop(input_dir: Path, output: Optional[Path], overwrite: bool = False,
                     texture_codec: str = 'auto', keep_audio: bool = False,
                     include_sounds: bool = False,
                     include_report: bool = False,
                     texture_profile: str = 'fast') -> Path:
    started_at = time.monotonic()
    if texture_codec not in TEXTURE_CODECS:
        raise ValueError(f"Unsupported texture codec: {texture_codec}")
    if texture_profile not in TEXTURE_PROFILES:
        raise ValueError(f"Unsupported texture profile: {texture_profile}")
    if not PIL_AVAILABLE:
        raise RuntimeError("Pillow is required. Install with: pip install Pillow")
    if not LZ4_AVAILABLE:
        raise RuntimeError("lz4 is required. Install with: pip install lz4")

    input_dir = input_dir.resolve()
    scene_pkg = input_dir / 'scene.pkg'
    project_json = input_dir / 'project.json'
    preview = find_preview(input_dir)
    missing = [p.name for p in (scene_pkg, project_json) if not p.is_file()]
    if preview is None:
        missing.append('preview.*')
    if missing:
        raise FileNotFoundError(f"Input folder is missing required file(s): {', '.join(missing)}")

    project = read_project_json(input_dir)
    output = output or default_output_path(input_dir, project)
    if output.exists() and not overwrite:
        raise FileExistsError(f"Output file already exists: {output}")
    if output.name and not is_numeric_mpkg_output_name(output):
        logger.warning("Output name is not numeric; Wallpaper Engine mobile may cache or handle it differently.")

    report = ConvertReport()
    logger.info(f"Converting workshop folder: {input_dir}")
    logger.info(f"Texture codec: {texture_codec}; profile: {texture_profile}")
    logger.info(f"Output: {output}")
    debug_log(
        f"stage=convert start input={input_dir.name} scenePkgBytes={scene_pkg.stat().st_size} "
        f"output={output.name} includeSounds={include_sounds} "
        f"pillow={PIL_AVAILABLE} lz4={LZ4_AVAILABLE} etcpak={ETCPAK_AVAILABLE} "
        f"dxtDecoder={'texture2ddecoder' if TEXTURE2DDECODER_AVAILABLE else 'python'}"
    )
    if not TEXTURE2DDECODER_AVAILABLE:
        report.warnings.append(
            'texture2ddecoder is unavailable; DXT1/DXT5 uses the slow Python fallback. '
            'Install it with: pip install texture2ddecoder'
        )

    package = read_pkg(scene_pkg)
    entries = [(entry.full_path, entry.bytes) for entry in package.entries]
    del package
    entries = preprocess_package_entries(
        entries,
        texture_codec,
        report,
        keep_audio=keep_audio,
        include_sounds=include_sounds,
        texture_profile=texture_profile,
    )
    if include_sounds:
        debug_log("stage=include-sounds start")
        entries = collapse_last_write_wins([*entries, *collect_input_sound_entries(input_dir, report)])
        debug_log(f"stage=include-sounds done count={report.included_sounds}")
        if report.included_sounds == 0:
            report.warnings.append('--include-sounds was set, but no sounds files were found')
    entries = collapse_last_write_wins([
        *entries,
        ('project.json', project_json.read_bytes()),
        (preview.name, preview.read_bytes()),
    ])
    debug_log(f"stage=metadata done preview={preview.name} includeReport={include_report} reportPacked=False")
    pack_mpkg_entries(entries, output)

    debug_log(f"stage=convert done outputBytes={output.stat().st_size} elapsedMs={elapsed_ms(started_at)}")

    logger.info(
        "Done: "
        f"converted TEX={report.converted_tex}, copied TEX={report.copied_tex}, "
        f"failed TEX={report.failed_tex}, removed audio={report.removed_audio}, "
        f"included sounds={report.included_sounds}, "
        f"rewritten shaders={report.rewritten_shaders}"
    )
    for warning in report.warnings:
        logger.warning(f"Warning: {warning}")
    return output


def show_info(path: Path) -> None:
    if path.suffix.lower() == '.mpkg':
        data = path.read_bytes()
        magic, count, _ = parse_mpkg_header(data)
        logger.info(f"MPKG: {path}")
        logger.info(f"Magic: {magic}")
        logger.info(f"Files: {count}")
        for file in parse_mpkg_file_list(data):
            logger.info(f"  {file.file_name} ({file.file_length} bytes)")
        return
    if path.suffix.lower() == '.pkg':
        package = read_pkg(path)
        logger.info(f"PKG: {path}")
        logger.info(f"Magic: {package.magic}")
        logger.info(f"Files: {len(package.entries)}")
        for entry in package.entries:
            logger.info(f"  {entry.full_path} ({entry.length} bytes)")
        return
    if path.suffix.lower() == '.tex':
        tex = parse_tex(path.read_bytes())
        logger.info(f"TEX: {path}")
        logger.info(f"Format: {tex.format}")
        logger.info(f"Image: {tex.image_width}x{tex.image_height}")
        logger.info(f"Texture: {tex.texture_width}x{tex.texture_height}")
        logger.info(f"Container: {tex.container_magic}")
        logger.info(f"Mipmaps: {len(tex.mipmaps)}")
        return
    raise ValueError(f"Unsupported info file type: {path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Pure local Wallpaper Engine mobile MPKG converter',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Commands:
  convert           Convert a Wallpaper workshop folder to mobile MPKG
  convert-workshop  Alias of convert, compatible with the old command name
  unpack            Extract MPKG files
  extract           Alias of unpack, accepts --mpkg for old command compatibility
  info              Show PKG/MPKG/TEX information

Texture codecs:
  auto  Default. RGBA for UI/transparent/small textures, ETC2 for larger candidates when etcpak exists.
  rgba  Most compatible pure local mode. Larger MPKG files.
  etc2  Force ETC2 where mobile conversion applies. Requires etcpak.

Texture profiles:
  fast     Default. Texture-heavy projects use RGBA + LZ4-HC for low-latency lossless output.
  compact  Keeps auto codec selection for safe ETC2 candidates. Requires etcpak for compact output.

Examples:
  python mobile_mpkg.py convert "F:\\S\\Steam\\steamapps\\workshop\\content\\431960\\3577513994" --overwrite
  python mobile_mpkg.py convert ./3577513994 -o 3577513994.mpkg --texture-codec rgba --overwrite
  python mobile_mpkg.py unpack 3577513994.mpkg -o ./output --overwrite
  python mobile_mpkg.py extract 3577513994.mpkg --mpkg -o ./output --overwrite
  python mobile_mpkg.py info 3577513994.mpkg
"""
    )
    sub = parser.add_subparsers(dest='command')

    def add_convert(name: str):
        p = sub.add_parser(name, help='Convert Wallpaper workshop folder to mobile MPKG')
        p.add_argument('input', help='Wallpaper workshop folder containing scene.pkg, project.json and preview.*')
        p.add_argument('-o', '--output', help='Output MPKG path. Default uses project.json workshopid when available.')
        p.add_argument('--texture-codec', choices=TEXTURE_CODECS, default='auto', help='Texture conversion mode')
        p.add_argument('--texture-profile', choices=TEXTURE_PROFILES, default='fast', help='fast keeps RGBA + LZ4-HC; compact enables safe auto ETC2 candidates')
        p.add_argument('--keep-audio', action='store_true', help='Keep audio files instead of stripping them')
        p.add_argument('--include-sounds', action='store_true', help='Include sounds/ files from scene.pkg and input folder sounds/ in the MPKG')
        p.add_argument('--include-report', action='store_true', help='Include conversion-report.json inside the MPKG')
        p.add_argument('--overwrite', action='store_true', help='Overwrite existing output')

    add_convert('convert')
    add_convert('convert-workshop')

    unpack = sub.add_parser('unpack', help='Extract MPKG files')
    unpack.add_argument('input', help='Input MPKG')
    unpack.add_argument('-o', '--output', default='./output', help='Output directory')
    unpack.add_argument('--overwrite', action='store_true', help='Overwrite existing extracted files')

    extract = sub.add_parser('extract', help='Alias of unpack for MPKG files')
    extract.add_argument('input', help='Input MPKG')
    extract.add_argument('-o', '--output', default='./output', help='Output directory')
    extract.add_argument('--mpkg', action='store_true', help='Accepted for old command compatibility')
    extract.add_argument('--overwrite', action='store_true', help='Overwrite existing extracted files')

    info = sub.add_parser('info', help='Show PKG/MPKG/TEX information')
    info.add_argument('input', help='Input PKG/MPKG/TEX file')

    return parser


def main_with_args(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0
    try:
        if args.command in ('convert', 'convert-workshop'):
            convert_workshop(
                Path(args.input),
                Path(args.output) if args.output else None,
                overwrite=args.overwrite,
                texture_codec=args.texture_codec,
                texture_profile=args.texture_profile,
                keep_audio=args.keep_audio,
                include_sounds=args.include_sounds,
                include_report=args.include_report,
            )
        elif args.command in ('unpack', 'extract'):
            unpack_mpkg(Path(args.input), Path(args.output), overwrite=args.overwrite)
        elif args.command == 'info':
            show_info(Path(args.input))
        return 0
    except Exception as exc:
        debug_log(f"stage=failed type={type(exc).__name__} error={exc}")
        logger.error(f"Error: {exc}")
        return 1


def main() -> int:
    return main_with_args()


if __name__ == '__main__':
    raise SystemExit(main())
