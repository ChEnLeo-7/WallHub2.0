import os
import shutil
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mobile_mpkg


class MobileMpkgDebugTests(unittest.TestCase):
    def test_debug_log_emits_only_when_wallhub_debug_flag_is_enabled(self):
        with patch.object(mobile_mpkg.logger, 'info') as info:
            with patch.dict(os.environ, {'WALLHUB_MPKG_DEBUG': '1'}, clear=False):
                mobile_mpkg.debug_log('stage=unit')
        info.assert_called_once_with('Debug stage=unit')

        with patch.object(mobile_mpkg.logger, 'info') as info:
            with patch.dict(os.environ, {'WALLHUB_MPKG_DEBUG': '0'}, clear=False):
                mobile_mpkg.debug_log('stage=unit')
        info.assert_not_called()

    def test_numeric_atomic_mpkg_name_is_not_misreported_as_non_numeric_output(self):
        self.assertTrue(mobile_mpkg.is_numeric_mpkg_output_name(Path('3750175441.mpkg.tmp-23452-1783922656075-8ypyo2')))
        self.assertFalse(mobile_mpkg.is_numeric_mpkg_output_name(Path('wallpaper.mpkg.tmp-23452-1783922656075-8ypyo2')))

    def test_regular_debug_batches_texture_progress_while_verbose_mode_keeps_per_texture_traces(self):
        root = Path(tempfile.mkdtemp(prefix='wallhub-mpkg-debug-'))
        try:
            for index in range(25):
                (root / f'texture-{index}.tex').write_bytes(b'raw')

            report = mobile_mpkg.ConvertReport()
            with patch.object(mobile_mpkg, 'convert_tex_mobile', side_effect=lambda _path, payload, _codec, _report: payload), \
                 patch.object(mobile_mpkg.logger, 'info') as info, \
                 patch.dict(os.environ, {'WALLHUB_MPKG_DEBUG': '1', 'WALLHUB_MPKG_DEBUG_VERBOSE': '0'}, clear=False):
                mobile_mpkg.preprocess_dir(root, 'auto', report)
            regular_messages = [str(call.args[0]) for call in info.call_args_list]
            self.assertTrue(any('stage=preprocess tex-progress=25/25' in message for message in regular_messages))
            self.assertTrue(any('stage=preprocess profile=' in message for message in regular_messages))
            self.assertFalse(any('stage=tex start' in message or 'stage=tex done' in message for message in regular_messages))
            self.assertLessEqual(len(regular_messages), 4, 'normal Debug must stay bounded for large texture batches')

            report = mobile_mpkg.ConvertReport()
            with patch.object(mobile_mpkg, 'convert_tex_mobile', side_effect=lambda _path, payload, _codec, _report: payload), \
                 patch.object(mobile_mpkg.logger, 'info') as info, \
                 patch.dict(os.environ, {'WALLHUB_MPKG_DEBUG': '1', 'WALLHUB_MPKG_DEBUG_VERBOSE': '1'}, clear=False):
                mobile_mpkg.preprocess_dir(root, 'auto', report)
            verbose_messages = [str(call.args[0]) for call in info.call_args_list]
            self.assertTrue(any('stage=tex start' in message for message in verbose_messages))
            self.assertTrue(any('stage=tex done' in message for message in verbose_messages))
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_native_bc3_decoder_normalizes_bgra_to_existing_rgba_order(self):
        class FakeTextureDecoder:
            def __init__(self):
                self.calls = []

            def decode_bc3(self, payload, width, height):
                self.calls.append((payload, width, height))
                return bytes([0x33, 0x22, 0x11, 0x44]) * (width * height)

        decoder = FakeTextureDecoder()
        with patch.object(mobile_mpkg, 'texture2ddecoder', decoder, create=True), \
             patch.object(mobile_mpkg, 'TEXTURE2DDECODER_AVAILABLE', True, create=True):
            rgba, decoder_name = mobile_mpkg.decompress_dxt_with_decoder(
                4,
                4,
                b'bc3-payload',
                mobile_mpkg.TexFormat.DXT5.value,
            )

        self.assertEqual(decoder.calls, [(b'bc3-payload', 4, 4)])
        self.assertEqual(decoder_name, 'texture2ddecoder-bc3')
        self.assertEqual(rgba, bytes([0x11, 0x22, 0x33, 0x44]) * 16)

    def test_r8_conversion_uses_pillow_native_luma_path_without_changing_rgba_output(self):
        with patch.object(mobile_mpkg.Image, 'frombytes', wraps=mobile_mpkg.Image.frombytes) as frombytes:
            rgba = mobile_mpkg.convert_r8_to_rgba(bytes([0x10, 0x20, 0x30, 0x40]), 2, 2)

        frombytes.assert_called_once_with('L', (2, 2), bytes([0x10, 0x20, 0x30, 0x40]))
        self.assertEqual(
            rgba,
            bytes([
                0x10, 0x10, 0x10, 0xFF,
                0x20, 0x20, 0x20, 0xFF,
                0x30, 0x30, 0x30, 0xFF,
                0x40, 0x40, 0x40, 0xFF,
            ]),
        )

    def test_auto_codec_uses_fast_rgba_only_for_texture_heavy_projects(self):
        effective_codec, reason = mobile_mpkg.resolve_preprocess_texture_codec('auto', 600)
        self.assertEqual(effective_codec, 'rgba')
        self.assertEqual(reason, 'texture-count-threshold:600')

        self.assertEqual(mobile_mpkg.resolve_preprocess_texture_codec('auto', 599), ('auto', 'auto'))
        self.assertEqual(mobile_mpkg.resolve_preprocess_texture_codec('etc2', 2000), ('etc2', 'requested'))
        with patch.dict(os.environ, {'WALLHUB_MPKG_AUTO_RGBA_TEXTURE_THRESHOLD': '0'}, clear=False):
            self.assertEqual(mobile_mpkg.resolve_preprocess_texture_codec('auto', 2000), ('auto', 'auto'))

    def test_compact_profile_keeps_auto_codec_for_texture_heavy_projects(self):
        effective_codec, reason = mobile_mpkg.resolve_preprocess_texture_codec(
            'auto',
            600,
            texture_profile='compact',
        )

        self.assertEqual(effective_codec, 'auto')
        self.assertEqual(reason, 'compact-auto')

    def test_auto_fast_rgba_uses_parallel_lz4_hc7_unless_explicitly_disabled(self):
        self.assertEqual(mobile_mpkg.auto_rgba_lz4_compression_level(), 7)
        with patch.dict(os.environ, {'WALLHUB_MPKG_AUTO_RGBA_LZ4_COMPRESSION_LEVEL': '0'}, clear=False):
            self.assertEqual(mobile_mpkg.auto_rgba_lz4_compression_level(), 0)

    def test_memory_preprocess_preserves_audio_shader_and_texture_rules(self):
        entries = [
            ('materials/demo.tex', b'raw-tex'),
            ('sounds/keep.mp3', b'sound'),
            ('root.mp3', b'root-audio'),
            ('shaders/demo.frag', b'const int count = 1;\n'),
            ('readme.txt', b'unchanged'),
        ]
        report = mobile_mpkg.ConvertReport()
        with patch.object(mobile_mpkg, 'convert_tex_mobile', return_value=b'converted-tex') as convert_tex:
            result = mobile_mpkg.preprocess_package_entries(entries, 'auto', report, include_sounds=True)

        self.assertEqual(convert_tex.call_args.args[1], b'raw-tex')
        self.assertEqual(
            result,
            [
                ('materials/demo.tex', b'converted-tex'),
                ('sounds/keep.mp3', b'sound'),
                ('shaders/demo.frag', b'const int count = 1.0;\n'),
                ('readme.txt', b'unchanged'),
            ],
        )
        self.assertEqual(report.included_sounds, 1)
        self.assertEqual(report.removed_audio, 1)
        self.assertEqual(report.rewritten_shaders, 1)

    def test_compact_profile_passes_auto_codec_to_safe_texture_selector(self):
        report = mobile_mpkg.ConvertReport()
        with patch.object(mobile_mpkg, 'ETCPAK_AVAILABLE', True), \
             patch.object(mobile_mpkg, 'convert_tex_mobile', return_value=b'compact-tex') as convert_tex:
            entries = mobile_mpkg.preprocess_package_entries(
                [('materials/demo.tex', b'raw-tex')],
                'auto',
                report,
                texture_profile='compact',
            )

        self.assertEqual(convert_tex.call_args.args[2], 'auto')
        self.assertEqual(entries, [('materials/demo.tex', b'compact-tex')])

    def test_compact_profile_without_etcpak_falls_back_to_fast_rgba(self):
        report = mobile_mpkg.ConvertReport()
        source_entries = [(f'materials/texture-{index}.tex', b'raw-tex') for index in range(600)]
        with patch.object(mobile_mpkg, 'ETCPAK_AVAILABLE', False), \
             patch.object(mobile_mpkg, 'auto_rgba_lz4_compression_level', return_value=0), \
             patch.object(mobile_mpkg, 'convert_tex_mobile', return_value=b'fast-tex') as convert_tex:
            mobile_mpkg.preprocess_package_entries(
                source_entries,
                'auto',
                report,
                texture_profile='compact',
            )

        self.assertEqual(convert_tex.call_args.args[2], 'rgba')
        self.assertEqual(report.requested_texture_profile, 'compact')
        self.assertEqual(report.effective_texture_profile, 'fast')
        self.assertTrue(any('etcpak' in warning and 'fast' in warning for warning in report.warnings))

    @unittest.skipUnless(mobile_mpkg.ETCPAK_AVAILABLE and mobile_mpkg.LZ4_AVAILABLE, 'etcpak and lz4 are required')
    def test_compact_profile_transcodes_safe_dxt_texture_to_etc2(self):
        dxt1_block = struct.pack('<HHI', 0xF800, 0x07E0, 0)
        source_tex = mobile_mpkg.write_mobile_tex(
            mobile_mpkg.TexFormat.DXT1.value,
            0,
            4,
            4,
            4,
            4,
            0,
            4,
            4,
            dxt1_block,
            use_lz4=True,
        )
        report = mobile_mpkg.ConvertReport()

        entries = mobile_mpkg.preprocess_package_entries(
            [('materials/demo.tex', source_tex)],
            'auto',
            report,
            texture_profile='compact',
        )

        output_tex = mobile_mpkg.parse_tex(dict(entries)['materials/demo.tex'])
        self.assertEqual(output_tex.format, mobile_mpkg.TexFormat.ETC2_RGBA8.value)
        self.assertEqual(report.requested_texture_profile, 'compact')
        self.assertEqual(report.effective_texture_profile, 'compact')

    def test_convert_cli_passes_compact_profile_to_converter(self):
        with patch.object(mobile_mpkg, 'convert_workshop') as convert_workshop:
            exit_code = mobile_mpkg.main_with_args([
                'convert',
                'workshop-folder',
                '--texture-profile',
                'compact',
            ])

        self.assertEqual(exit_code, 0)
        self.assertEqual(convert_workshop.call_args.kwargs['texture_profile'], 'compact')

    @unittest.skipUnless(mobile_mpkg.LZ4_AVAILABLE, 'lz4 runtime dependency is required')
    def test_parallel_lz4_hc_recompression_preserves_rgba_tex_bytes_after_decompression(self):
        width = height = 256
        raw_rgba = bytes(
            component
            for y in range(height)
            for x in range(width)
            for component in ((x // 4) & 0xFF, (y // 4) & 0xFF, ((x + y) // 8) & 0xFF, 0xFF)
        )
        fast_tex = mobile_mpkg.write_mobile_tex(
            mobile_mpkg.TexFormat.RGBA8888.value,
            0,
            width,
            height,
            width,
            height,
            0,
            width,
            height,
            raw_rgba,
            use_lz4=True,
        )

        entries, profile = mobile_mpkg.recompress_mobile_rgba_entries(
            [('materials/demo.tex', fast_tex), ('readme.txt', b'unchanged')],
            compression_level=7,
            max_workers=2,
        )

        recompressed = dict(entries)['materials/demo.tex']
        parsed = mobile_mpkg.parse_tex(recompressed)
        self.assertEqual(parsed.format, mobile_mpkg.TexFormat.RGBA8888.value)
        self.assertEqual(parsed.mipmaps[0].data, raw_rgba)
        self.assertLess(len(recompressed), len(fast_tex))
        self.assertEqual(dict(entries)['readme.txt'], b'unchanged')
        self.assertEqual(profile['textures'], 1)
        self.assertGreater(profile['savedBytes'], 0)
        self.assertEqual(profile['level'], 7)

    def test_pack_mpkg_entries_matches_existing_mpkg_layout_and_sorting(self):
        root = Path(tempfile.mkdtemp(prefix='wallhub-mpkg-memory-pack-'))
        try:
            output = root / 'output.mpkg'
            mobile_mpkg.pack_mpkg_entries([
                ('z.txt', b'z'),
                ('materials/b.tex', b'b'),
                ('materials/a.tex', b'a'),
            ], output)
            data = output.read_bytes()
            self.assertEqual(mobile_mpkg.parse_mpkg_header(data)[:2], (mobile_mpkg.MOBILE_MPKG_MAGIC, 3))
            files = mobile_mpkg.parse_mpkg_file_list(data)
            self.assertEqual([file.file_name for file in files], ['z.txt', 'materials/a.tex', 'materials/b.tex'])
            self.assertEqual(
                [data[file.file_start:file.file_stop + 1] for file in files],
                [b'z', b'a', b'b'],
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_convert_workshop_uses_memory_pipeline_and_overwrites_scene_metadata(self):
        root = Path(tempfile.mkdtemp(prefix='wallhub-mpkg-memory-convert-'))
        try:
            (root / 'scene.pkg').write_bytes(b'pkg')
            (root / 'project.json').write_text('{"workshopid":"123456"}', encoding='utf-8')
            (root / 'preview.jpg').write_bytes(b'input-preview')
            output = root / 'output.mpkg'
            package = mobile_mpkg.Package(entries=[
                mobile_mpkg.PackageEntry('scene.txt', 0, 5, b'scene'),
                mobile_mpkg.PackageEntry('project.json', 0, 10, b'pkg-project'),
                mobile_mpkg.PackageEntry('preview.jpg', 0, 11, b'pkg-preview'),
            ])
            with patch.object(mobile_mpkg, 'read_pkg', return_value=package), \
                 patch.object(mobile_mpkg, 'preprocess_dir', side_effect=AssertionError('legacy preprocessing called')), \
                 patch.object(mobile_mpkg, 'include_input_sounds', side_effect=AssertionError('legacy sounds called')), \
                 patch.object(mobile_mpkg, 'pack_mpkg', side_effect=AssertionError('legacy packer called')), \
                 patch.object(mobile_mpkg, 'PIL_AVAILABLE', True), \
                 patch.object(mobile_mpkg, 'LZ4_AVAILABLE', True), \
                 patch.object(mobile_mpkg.logger, 'info'), \
                 patch.object(mobile_mpkg.logger, 'warning'):
                mobile_mpkg.convert_workshop(root, output, overwrite=True, include_report=True)

            data = output.read_bytes()
            files = mobile_mpkg.parse_mpkg_file_list(data)
            payloads = {file.file_name: data[file.file_start:file.file_stop + 1] for file in files}
            self.assertEqual(payloads['scene.txt'], b'scene')
            self.assertEqual(payloads['project.json'], b'{"workshopid":"123456"}')
            self.assertEqual(payloads['preview.jpg'], b'input-preview')
            self.assertNotIn(mobile_mpkg.REPORT_FILE_NAME, payloads)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_convert_video_workshop_keeps_media_bytes_and_matches_official_video_layout(self):
        root = Path(tempfile.mkdtemp(prefix='wallhub-mpkg-video-convert-'))
        try:
            video_name = 'horizon.mp4'
            video_bytes = b'original-video-bytes\x00\x01\x02'
            preview_bytes = b'original-preview-bytes\xff'
            (root / video_name).write_bytes(video_bytes)
            (root / 'preview.jpg').write_bytes(preview_bytes)
            (root / 'project.json').write_text(
                '{"contentrating":"Everyone","file":"horizon.mp4","preview":"preview.jpg",'
                '"tags":["Landscape"],"title":"Horizon","type":"video"}',
                encoding='utf-8',
            )
            output = root / 'output.mpkg'

            # Video packages do not parse scene.pkg or require texture libraries.
            with patch.object(mobile_mpkg, 'PIL_AVAILABLE', False), \
                 patch.object(mobile_mpkg, 'LZ4_AVAILABLE', False), \
                 patch.object(mobile_mpkg.logger, 'info'), \
                 patch.object(mobile_mpkg.logger, 'warning'):
                mobile_mpkg.convert_workshop(root, output, overwrite=True, texture_profile='compact')

            data = output.read_bytes()
            self.assertEqual(mobile_mpkg.parse_mpkg_header(data)[:2], (mobile_mpkg.VIDEO_MPKG_MAGIC, 3))
            files = mobile_mpkg.parse_mpkg_file_list(data)
            self.assertEqual([file.file_name for file in files], [video_name, 'preview.jpg', 'project.json'])
            payloads = {file.file_name: data[file.file_start:file.file_stop + 1] for file in files}
            self.assertEqual(payloads[video_name], video_bytes)
            self.assertEqual(payloads['preview.jpg'], preview_bytes)
            self.assertEqual(
                payloads['project.json'],
                b'{\r\n\t"file" : "horizon.mp4",\r\n\t"preview" : "preview.jpg",\r\n'
                b'\t"title" : "Horizon",\r\n\t"type" : "video"\r\n}',
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_texture_profile_keeps_decoder_totals_and_only_five_slowest_entries(self):
        report = mobile_mpkg.ConvertReport()
        report.add_dxt_decode('texture2ddecoder-bc3', 17)
        report.add_dxt_decode('texture2ddecoder-bc3', 5)
        for index, elapsed in enumerate((11, 2, 41, 7, 23, 31), start=1):
            report.add_texture_timing(f'materials/texture-{index}.tex', elapsed, index * 10, index * 20)

        profile = report.texture_profile()

        self.assertEqual(profile['dxtDecoders']['texture2ddecoder-bc3'], {'count': 2, 'elapsedMs': 22})
        self.assertEqual(profile['textureElapsedMs'], 115)
        self.assertEqual(len(profile['slowestTextures']), 5)
        self.assertEqual(profile['slowestTextures'][0]['file'], 'materials/texture-3.tex')
        self.assertEqual(profile['slowestTextures'][-1]['file'], 'materials/texture-4.tex')


if __name__ == '__main__':
    unittest.main()
