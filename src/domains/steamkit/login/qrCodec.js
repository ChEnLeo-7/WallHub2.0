'use strict';

function createQrCodec(options) {
  const getQrCodeModule = options.getQrCodeModule;
  const getJsQrModule = options.getJsQrModule;
  const logger = options.logger;

  function sanitizeQrOutput(text) {
    return String(text || '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .filter(line => !/RefreshToken|AccessToken|LoginTokens|account\.config/i.test(line))
      .join('\n')
      .slice(-14000);
  }

  function extractQrAsciiLines(text) {
    const source = sanitizeQrOutput(text || '');
    const markerMatches = Array.from(source.matchAll(/Use the Steam Mobile App to sign in with this QR code:|The QR code has changed:/gi));
    if (!markerMatches.length) return [];
    const start = markerMatches[markerMatches.length - 1].index + markerMatches[markerMatches.length - 1][0].length;
    const lines = source.slice(start).split(/\r?\n/);
    const qrLines = [];
    let started = false;
    for (const line of lines) {
      const raw = String(line || '').replace(/\r/g, '');
      const trimmed = raw.trim();
      if (!trimmed) {
        if (started && qrLines.length > 10) break;
        continue;
      }
      const hasText = /[A-Za-z0-9:;,.!?'"`/\\()[\]{}<>]/.test(trimmed);
      const nonSpace = raw.replace(/\s/g, '').length;
      const looksLikeQr = raw.length >= 20 && nonSpace >= 6 && !hasText;
      if (!looksLikeQr) {
        if (started && qrLines.length > 10) break;
        continue;
      }
      started = true;
      qrLines.push(raw);
    }
    return qrLines;
  }

  function asciiQrToMatrix(text) {
    const lines = extractQrAsciiLines(text);
    if (lines.length < 10) return null;

    const gcd = (a, b) => {
      a = Math.abs(a); b = Math.abs(b);
      while (b) [a, b] = [b, a % b];
      return a || 0;
    };
    let darkTokenWidth = 0;
    for (const line of lines) {
      const runs = String(line || '').match(/\S+/g) || [];
      for (const run of runs) {
        darkTokenWidth = gcd(darkTokenWidth, Array.from(run).length);
      }
    }
    if (!darkTokenWidth || darkTokenWidth > 8) darkTokenWidth = 2;

    const decodeLine = (line) => {
      const chars = Array.from(String(line || '').replace(/\r/g, ''));
      const row = [];
      for (let i = 0; i < chars.length;) {
        const current = chars[i] || '';
        if (/\s/.test(current)) {
          let j = i;
          while (j < chars.length && /\s/.test(chars[j] || '')) j += 1;
          const modules = Math.max(1, Math.round((j - i) / 2));
          for (let k = 0; k < modules; k++) row.push(false);
          i = j;
          continue;
        }
        let j = i;
        while (j < chars.length && !/\s/.test(chars[j] || '')) j += 1;
        const modules = Math.max(1, Math.round((j - i) / darkTokenWidth));
        for (let k = 0; k < modules; k++) row.push(true);
        i = j;
      }
      return row;
    };

    const rows = lines.map(decodeLine);
    const maxWidth = Math.max(...rows.map(row => row.length));
    for (const row of rows) {
      while (row.length < maxWidth) row.push(false);
    }

    while (rows.length && rows[0].every(v => !v)) rows.shift();
    while (rows.length && rows[rows.length - 1].every(v => !v)) rows.pop();
    if (!rows.length) return null;

    let left = Infinity;
    let right = -1;
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        if (!row[i]) continue;
        left = Math.min(left, i);
        right = Math.max(right, i);
      }
    }
    if (!Number.isFinite(left) || right < left) return null;
    return rows.map(row => row.slice(left, right + 1));
  }

  function asciiQrToSvgDataUrl(text) {
    const trimmedRows = asciiQrToMatrix(text);
    if (!trimmedRows || trimmedRows.length < 10) return '';
    const quiet = 4;
    const width = Math.max(...trimmedRows.map(row => row.length)) + quiet * 2;
    const height = trimmedRows.length + quiet * 2;
    const rects = [];
    for (let y = 0; y < trimmedRows.length; y++) {
      for (let x = 0; x < trimmedRows[y].length; x++) {
        if (trimmedRows[y][x]) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }

  function decodeAsciiQrChallengeUrl(text) {
    const matrix = asciiQrToMatrix(text);
    if (!matrix || matrix.length < 10) return '';
    const moduleSize = 8;
    const quiet = 4;
    const modulesW = Math.max(...matrix.map(row => row.length));
    const modulesH = matrix.length;
    const width = (modulesW + quiet * 2) * moduleSize;
    const height = (modulesH + quiet * 2) * moduleSize;
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(255);
    for (let y = 0; y < modulesH; y++) {
      const row = matrix[y] || [];
      for (let x = 0; x < modulesW; x++) {
        if (!row[x]) continue;
        const startX = (x + quiet) * moduleSize;
        const startY = (y + quiet) * moduleSize;
        for (let py = 0; py < moduleSize; py++) {
          for (let px = 0; px < moduleSize; px++) {
            const idx = ((startY + py) * width + startX + px) * 4;
            data[idx] = 0;
            data[idx + 1] = 0;
            data[idx + 2] = 0;
            data[idx + 3] = 255;
          }
        }
      }
    }
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    try {
      const jsQR = getJsQrModule();
      const decoded = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
      return decoded && decoded.data ? String(decoded.data) : '';
    } catch {
      return '';
    }
  }

  async function refreshQrImage(session) {
    if (!session || session.qrImageKind === 'standard') return;
    const challengeUrl = decodeAsciiQrChallengeUrl(session.output || '');
    if (challengeUrl) {
      session.qrChallengeUrl = challengeUrl;
      try {
        const QRCode = getQrCodeModule();
        session.qrImage = await QRCode.toDataURL(challengeUrl, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 180,
          color: { dark: '#000000', light: '#ffffff' },
        });
        session.qrImageKind = 'standard';
        session.updatedAt = Date.now();
        return;
      } catch (error) {
        logger.warn('[SteamKit QR] Failed to render QR challenge URL:', error.message);
      }
    }
    const fallback = process.env.WALLHUB_QR_ASCII_FALLBACK === '1' ? asciiQrToSvgDataUrl(session.output || '') : '';
    if (fallback) {
      session.qrImage = fallback;
      session.qrImageKind = 'fallback';
      session.updatedAt = Date.now();
    }
  }

  function parseQrUsername(text) {
    const source = String(text || '');
    const cmLogin = source.match(/WALLHUB_STEAM_CM_LOGIN:(\{[^\r\n]+\})/i);
    if (cmLogin) {
      try {
        const parsed = JSON.parse(cmLogin[1]);
        if (parsed && parsed.account) return String(parsed.account).trim();
      } catch {}
    }
    const match = source.match(/Next time you can login with -username\s+([^\s]+)\s+-remember-password/i) ||
      source.match(/Logging\s+['"]([^'"]+)['"]\s+into Steam3/i);
    return match ? String(match[1] || '').trim() : '';
  }

  return {
    sanitizeQrOutput,
    extractQrAsciiLines,
    asciiQrToMatrix,
    asciiQrToSvgDataUrl,
    decodeAsciiQrChallengeUrl,
    refreshQrImage,
    parseQrUsername,
  };
}

module.exports = {
  createQrCodec,
};
