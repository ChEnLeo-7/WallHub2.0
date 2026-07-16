import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatLocalizedDate, formatLocalizedDateTime, shouldCompactDateOnlyText } from './dateDisplay.mjs';

export { shouldCompactDateOnlyText };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCount(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '0';
  if (/^\d+(?:\.\d+)?\s*[KMB]$/i.test(raw) || /万|亿/.test(raw)) return raw;
  const n = Number.parseFloat(raw.replace(/,/g, '')) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatBytes(value: unknown) {
  const raw = String(value || '').trim();
  if (/\b(?:B|KB|MB|GB|TB)\b/i.test(raw)) return raw;
  const n = Number.parseInt(raw, 10) || 0;
  if (!n) return '未知';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function formatSpeed(value: unknown) {
  return `${formatBytes(value)}/s`;
}

export function formatDate(ts: unknown) {
  return formatLocalizedDateTime(ts);
}

export function formatDateOnly(ts: unknown) {
  return formatLocalizedDate(ts);
}

export function safeName(value: string) {
  return String(value || 'Wallpaper').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Wallpaper';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export type AppText = {
  unknown: string;
  [key: string]: string | Record<string, string>;
};

export function formatBytesText(value: unknown, text: AppText) {
  const result = formatBytes(value);
  return result === '未知' ? text.unknown : result;
}

export function formatDateText(value: unknown, text: AppText) {
  const result = formatDate(value);
  return result === '未知' ? text.unknown : result;
}

export function formatDateOnlyText(value: unknown, text: AppText) {
  const result = formatDateOnly(value);
  return result === '未知' ? text.unknown : result;
}

export function formatSpeedText(value: unknown, text: AppText) {
  const result = formatBytesText(value, text);
  return `${result}/s`;
}
