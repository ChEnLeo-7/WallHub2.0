'use strict';

const fs = require('fs');
const path = require('path');

function psQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = crc32Table();

function crc32Update(crc, chunk) {
  let value = crc >>> 0;
  for (let index = 0; index < chunk.length; index++) {
    value = CRC32_TABLE[(value ^ chunk[index]) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function dosDateTime(date) {
  const value = date instanceof Date ? date : new Date();
  const year = Math.max(1980, value.getFullYear());
  const dosTime = (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate();
  return { dosTime, dosDate };
}

function writeBufferAsync(stream, buffer) {
  return new Promise((resolve, reject) => {
    stream.write(buffer, error => error ? reject(error) : resolve());
  });
}

function pipeFileToStream(filePath, stream) {
  return new Promise((resolve, reject) => {
    const reader = fs.createReadStream(filePath);
    const cleanup = () => {
      reader.removeListener('error', onError);
      stream.removeListener('error', onError);
      reader.removeListener('end', onEnd);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      resolve();
    };
    reader.on('error', onError);
    stream.on('error', onError);
    reader.on('end', onEnd);
    reader.pipe(stream, { end: false });
  });
}

async function fileZipInfo(filePath) {
  const stat = fs.statSync(filePath);
  let crc = 0xffffffff;
  await new Promise((resolve, reject) => {
    const reader = fs.createReadStream(filePath);
    reader.on('data', chunk => { crc = crc32Update(crc, chunk); });
    reader.on('end', resolve);
    reader.on('error', reject);
  });
  return { size: stat.size, crc: (crc ^ 0xffffffff) >>> 0, mtime: stat.mtime };
}

async function createStoredZipWithNode(dirPath, zipPath, options = {}) {
  const listFilesRecursive = options.listFilesRecursive;
  if (typeof listFilesRecursive !== 'function') throw new Error('listFilesRecursive is required');

  const files = listFilesRecursive(dirPath)
    .filter(filePath => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error('ZIP 打包失败，目录为空');

  const out = fs.createWriteStream(zipPath);
  const central = [];
  let offset = 0;
  try {
    for (const filePath of files) {
      const info = await fileZipInfo(filePath);
      if (info.size > 0xffffffff || offset > 0xffffffff) {
        throw new Error('ZIP fallback 暂不支持超过 4GB 的文件，请在 Termux 安装 zip: pkg install zip');
      }
      const rel = path.relative(dirPath, filePath).split(path.sep).join('/');
      const nameBuf = Buffer.from(rel, 'utf8');
      const { dosTime, dosDate } = dosDateTime(info.mtime);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(dosTime, 10);
      local.writeUInt16LE(dosDate, 12);
      local.writeUInt32LE(info.crc, 14);
      local.writeUInt32LE(info.size, 18);
      local.writeUInt32LE(info.size, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      const localOffset = offset;
      await writeBufferAsync(out, local);
      await writeBufferAsync(out, nameBuf);
      await pipeFileToStream(filePath, out);
      offset += local.length + nameBuf.length + info.size;
      central.push({ nameBuf, info, dosTime, dosDate, localOffset });
    }

    const centralStart = offset;
    for (const entry of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(entry.dosTime, 12);
      header.writeUInt16LE(entry.dosDate, 14);
      header.writeUInt32LE(entry.info.crc, 16);
      header.writeUInt32LE(entry.info.size, 20);
      header.writeUInt32LE(entry.info.size, 24);
      header.writeUInt16LE(entry.nameBuf.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(entry.localOffset, 42);
      await writeBufferAsync(out, header);
      await writeBufferAsync(out, entry.nameBuf);
      offset += header.length + entry.nameBuf.length;
    }

    const centralSize = offset - centralStart;
    if (central.length > 0xffff || centralStart > 0xffffffff || centralSize > 0xffffffff) {
      throw new Error('ZIP fallback 暂不支持超大目录，请在 Termux 安装 zip: pkg install zip');
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    end.writeUInt16LE(0, 20);
    await writeBufferAsync(out, end);
  } catch (error) {
    out.destroy();
    try {
      fs.rmSync(zipPath, { force: true });
    } catch {}
    throw error;
  } finally {
    await new Promise(resolve => {
      if (out.destroyed) return resolve();
      out.end(resolve);
    });
  }
}

async function zipDir(dirPath, zipPath, options = {}) {
  const ensureDir = options.ensureDir;
  const commandExists = options.commandExists;
  const runProcess = options.runProcess;
  const listFilesRecursive = options.listFilesRecursive;
  const logger = options.logger || console;
  if (typeof ensureDir !== 'function') throw new Error('ensureDir is required');
  if (typeof commandExists !== 'function') throw new Error('commandExists is required');
  if (typeof runProcess !== 'function') throw new Error('runProcess is required');

  ensureDir(path.dirname(zipPath));
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  if (process.platform === 'win32') {
    const cmd = `Compress-Archive -Path '${psQuote(path.join(dirPath, '*'))}' -DestinationPath '${psQuote(zipPath)}' -Force`;
    await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], 180000);
  } else {
    const zipBin = commandExists('zip');
    if (zipBin) {
      await runProcess(zipBin, ['-r', zipPath, '.'], 180000, { cwd: dirPath });
    } else {
      logger.warn('[ZIP] zip command not found, using Node stored-zip fallback');
      await createStoredZipWithNode(dirPath, zipPath, { listFilesRecursive });
    }
  }

  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP 打包失败，未生成文件: ${zipPath}`);
  }
}

module.exports = {
  psQuote,
  crc32Update,
  dosDateTime,
  writeBufferAsync,
  pipeFileToStream,
  fileZipInfo,
  createStoredZipWithNode,
  zipDir,
};
