import { ERR } from './errors.js';
import { DATE_MAX_ABS_MS } from './limits.js';

/** One day in ms. */
export const DAY_MS = 86400000;

const UNIT_MS = { m: 60000, h: 3600000, d: DAY_MS, w: 7 * DAY_MS };
const ABSOLUTE = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const RELATIVE = /^([-+]?)(\d+)([mhdw])$/;
const CALL = /^(start|end)Of(Day|Week|Month|Year)\(\s*"?(?:([-+]?\d+)([mhdw])?)?"?\s*\)$/i;

/** Midnight UTC of the day that contains ms. */
export function startOfDayMs(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function startOf(unit, ms) {
  const d = new Date(ms);
  if (unit === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (unit === 'week') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

function shift(unit, ms, n) {
  const d = new Date(ms);
  if (unit === 'day') return ms + n * DAY_MS;
  if (unit === 'week') return ms + n * 7 * DAY_MS;
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
  return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate());
}

function absolute([, y, mo, d, h = '0', mi = '0']) {
  const parts = [y, mo, d, h, mi].map(Number);
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(parts[3], parts[4], 0, 0);
  const back = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()];
  return back.every((v, i) => v === parts[i]) ? date.getTime() : NaN;
}

function call(m, now) {
  const unit = m[2].toLowerCase();
  const n = m[3] === undefined ? 0 : Number(m[3]);
  const start = m[4] ? startOf(unit, now) : shift(unit, startOf(unit, now), n);
  const base = m[1].toLowerCase() === 'end' ? shift(unit, start, 1) - 1 : start;
  return m[4] ? base + n * UNIT_MS[m[4]] : base;
}

function resolve(s, now) {
  const abs = ABSOLUTE.exec(s);
  if (abs) return absolute(abs);
  const rel = RELATIVE.exec(s);
  if (rel) return now + (rel[1] === '-' ? -1 : 1) * Number(rel[2]) * UNIT_MS[rel[3]];
  const m = CALL.exec(s);
  return m ? call(m, now) : NaN;
}

/** A date argument in UTC: absolute, relative to now (`-7d`) or a start/end function (`startOfWeek(-1)`); weeks start on Monday. */
export function parseDate(text, now) {
  const s = String(text ?? '').trim();
  const ms = resolve(s, now);
  return Number.isFinite(ms) && Math.abs(ms) <= DATE_MAX_ABS_MS ? { ms } : { error: ERR.invalidDate(s) };
}
