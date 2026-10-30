// All date/time logic for the app runs in Singapore time (UTC+8, no DST).
// Timestamps are stored as ISO 8601 strings with an explicit +08:00 offset so
// `new Date(value)` parses them identically on the server and in the browser.

export const SINGAPORE_TZ = 'Asia/Singapore';
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Current instant. Use this instead of `new Date()` everywhere. */
export function getSingaporeNow(): Date {
  return new Date();
}

/** Wall-clock parts of an instant as seen in Singapore. */
export function getSingaporeParts(date: Date) {
  const sg = new Date(date.getTime() + SG_OFFSET_MS);
  return {
    year: sg.getUTCFullYear(),
    month: sg.getUTCMonth() + 1, // 1-12
    day: sg.getUTCDate(),
    hour: sg.getUTCHours(),
    minute: sg.getUTCMinutes(),
    second: sg.getUTCSeconds(),
    weekday: sg.getUTCDay(), // 0 = Sunday
  };
}

/** Builds an instant from Singapore wall-clock parts (month is 1-12; overflow rolls over). */
export function fromSingaporeParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - SG_OFFSET_MS);
}

/** Serializes an instant as `YYYY-MM-DDTHH:mm:ss+08:00`. */
export function toSingaporeISO(date: Date): string {
  const p = getSingaporeParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+08:00`;
}

/** `YYYY-MM-DD` of the instant in Singapore. */
export function toSingaporeDateKey(date: Date): string {
  const p = getSingaporeParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Converts an `<input type="datetime-local">` value (Singapore wall clock) to a stored ISO string. */
export function datetimeLocalToISO(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return toSingaporeISO(fromSingaporeParts(+m[1], +m[2], +m[3], +m[4], +m[5]));
}

/** Converts a stored ISO string to an `<input type="datetime-local">` value in Singapore time. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = getSingaporeParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parses a date string; returns null for missing or invalid input. */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Human-readable Singapore date/time, e.g. "Thu, 30 Oct 2026, 3:00 pm". */
export function formatSingaporeDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...opts,
  }).format(new Date(iso));
}

/** Relative description of a due date, e.g. "in 2 hours" or "3 days ago". */
export function formatRelative(iso: string, now: Date = getSingaporeNow()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [7 * 86_400_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      const label = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff >= 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return diff >= 0 ? 'in under a minute' : 'just now';
}
