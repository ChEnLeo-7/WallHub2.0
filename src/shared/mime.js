'use strict';

const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.htm': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.m3u8': 'application/vnd.apple.mpegurl; charset=utf-8',
  '.mpd': 'application/dash+xml; charset=utf-8',
  '.m4s': 'video/iso.segment',
  '.ts': 'video/mp2t',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
};

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.wmv', '.avi', '.mkv', '.mov', '.m4v', '.m4s', '.ts']);

function mimeFromExt(ext) {
  return MIME_TYPES[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

function mimeType(filePath) {
  return mimeFromExt(path.extname(filePath));
}

function getVideoMime(filePath) {
  return mimeFromExt(path.extname(String(filePath || '')).toLowerCase());
}

function isVideoExt(ext) {
  return VIDEO_EXTS.has(String(ext || '').toLowerCase());
}

function contentTypeFromUrl(url) {
  try {
    return mimeFromExt(path.extname(new URL(url).pathname).toLowerCase());
  } catch {
    return 'application/octet-stream';
  }
}

module.exports = {
  MIME_TYPES,
  VIDEO_EXTS,
  mimeFromExt,
  mimeType,
  getVideoMime,
  isVideoExt,
  contentTypeFromUrl,
};
