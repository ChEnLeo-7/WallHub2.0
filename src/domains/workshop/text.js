'use strict';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function fmtStat(n, fallback) {
  const parsed = parseInt(n, 10) || 0;
  if (parsed > 0) {
    if (parsed >= 1e6) return `${(parsed / 1e6).toFixed(1)}M`;
    if (parsed >= 1e3) return `${(parsed / 1e3).toFixed(1)}K`;
    return parsed.toLocaleString();
  }
  return fallback || '0';
}

function fmtBytes(bytes) {
  const parsed = parseInt(bytes, 10);
  if (!parsed || parsed <= 0) return null;
  if (parsed >= 1073741824) return `${(parsed / 1073741824).toFixed(1)} GB`;
  if (parsed >= 1048576) return `${(parsed / 1048576).toFixed(1)} MB`;
  if (parsed >= 1024) return `${(parsed / 1024).toFixed(1)} KB`;
  return `${parsed} B`;
}

function fmtTime(ts) {
  const parsed = parseInt(ts, 10);
  if (!parsed) return null;
  const date = new Date(parsed * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const pad2 = (value) => String(value).padStart(2, '0');
  const hour = date.getHours();
  const period = hour < 12 ? '上午' : '下午';
  const displayHour = hour % 12 || 12;
  return `${date.getFullYear()} 年 ${pad2(date.getMonth() + 1)} 月 ${pad2(date.getDate())} 日 ${period} ${pad2(displayHour)}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function looksLikeSteamId(value) {
  return /^\d{17}$/.test(String(value || '').trim());
}

module.exports = {
  decodeHtml,
  cleanText,
  fmtStat,
  fmtBytes,
  fmtTime,
  looksLikeSteamId,
};
