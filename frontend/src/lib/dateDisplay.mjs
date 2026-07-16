const UNKNOWN_DATE = '未知';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseChineseDate(value) {
  const match = String(value ?? '').trim().match(
    /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(上午|下午|中午|AM|PM)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i,
  );
  if (!match) return null;
  const [, yearText, monthText, dayText, period = '', hourText = '0', minuteText = '0', secondText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (period && /^(下午|中午|PM)$/i.test(period) && hour < 12) hour += 12;
  if (period && /^(上午|AM)$/i.test(period) && hour === 12) hour = 0;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, hasTime: Boolean(period) };
}

function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? { date: value, hasTime: true } : null;
  }
  const raw = String(value ?? '').trim();
  if (!raw || raw === '0' || raw === UNKNOWN_DATE) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 86_400) return null;
    const millis = numeric > 100_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? { date, hasTime: true } : null;
  }
  const chinese = parseChineseDate(raw);
  if (chinese) return chinese;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  return { date, hasTime: /(?:T|\d{1,2}:\d{2})/.test(raw) };
}

export function formatLocalizedDate(value, now = new Date()) {
  const parsed = parseDateValue(value);
  if (!parsed) return UNKNOWN_DATE;
  const { date } = parsed;
  const prefix = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()} 年 `;
  return `${prefix}${pad2(date.getMonth() + 1)} 月 ${pad2(date.getDate())} 日`;
}

export function shouldCompactDateOnlyText(value) {
  return /\d{4}\s*年/.test(String(value ?? ''));
}

export function formatLocalizedDateTime(value, now = new Date()) {
  const parsed = parseDateValue(value);
  if (!parsed) return UNKNOWN_DATE;
  const { date, hasTime } = parsed;
  const dateText = formatLocalizedDate(date, now);
  if (!hasTime) return dateText;
  const hour = date.getHours();
  const period = hour < 12 ? '上午' : '下午';
  const displayHour = hour % 12 || 12;
  return `${dateText} ${period} ${pad2(displayHour)}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatLocalizedCommentTime(comment, now = new Date()) {
  const raw = String(comment?.date ?? '').trim();
  const timestamp = String(comment?.timestamp ?? '').trim();
  const fallback = () => {
    if (!raw) return UNKNOWN_DATE;
    const formatted = formatLocalizedDateTime(raw, now);
    return formatted === UNKNOWN_DATE ? raw : formatted;
  };
  if (!timestamp || timestamp === '0' || timestamp === UNKNOWN_DATE) return fallback();

  let millis = 0;
  if (/^\d+$/.test(timestamp)) {
    const numeric = Number(timestamp);
    millis = numeric > 100_000_000_000 ? numeric : numeric * 1000;
  } else {
    const parsed = Date.parse(timestamp);
    millis = Number.isFinite(parsed) ? parsed : 0;
  }
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 2000) return fallback();

  const diff = now.getTime() - millis;
  if (diff >= 0 && diff < 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(diff / (60 * 1000)))} 分钟以前`;
  }
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))} 小时以前`;
  }
  return formatLocalizedDateTime(date, now);
}
