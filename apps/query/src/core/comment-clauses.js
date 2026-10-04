import { DAY_MS, parseDate, startOfDayMs } from './dates.js';
import { ERR } from './errors.js';
import { CLAUSES_MAX_LENGTH, EXT_MAX_LENGTH } from './limits.js';

const KEYWORDS = {
  comment: ['by', 'after', 'before', 'on', 'inrole', 'ingroup'],
  attachment: ['by', 'after', 'before', 'on', 'ext'],
};
const LATER = { comment: ['rolelevel', 'grouplevel'] };
const CANONICAL = { inrole: 'inRole', ingroup: 'inGroup', rolelevel: 'roleLevel', grouplevel: 'groupLevel' };
const DATES = new Set(['after', 'before', 'on']);
const WORD = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
const canonical = (key) => CANONICAL[key] ?? key;

/** A file extension as the index stores it and a condition compares it: no leading dots, lower case, at most EXT_MAX_LENGTH characters. */
export function normalizeExt(text) {
  return String(text ?? '').replace(/^\.+/, '').toLowerCase().slice(0, EXT_MAX_LENGTH);
}

/** Extension of a file name (after its last dot), normalised; empty when the name has none. */
export function extOf(name) {
  const s = String(name ?? '');
  return s.includes('.') ? normalizeExt(s.slice(s.lastIndexOf('.') + 1)) : '';
}

/** Clause text → words; a double-quoted part keeps its spaces and `\"` inside it stands for a quote. */
export function tokenize(text) {
  const s = String(text ?? '');
  if (s.length > CLAUSES_MAX_LENGTH) return { error: ERR.clausesTooLong(CLAUSES_MAX_LENGTH) };
  const words = [];
  for (const m of s.matchAll(WORD)) {
    if (m[1] !== undefined) words.push(m[1].replace(/\\(.)/g, '$1'));
    else if (m[2].startsWith('"')) return { error: ERR.unclosedQuote(s) };
    else words.push(m[2]);
  }
  return { words };
}

function readValue(clauses, name, value, now) {
  if (name === 'ext') {
    clauses.ext = normalizeExt(value);
    if (!clauses.ext) return { error: ERR.clauseNeedsValue(name) };
    return clauses.ext.includes('.') ? { error: ERR.extensionDot(name) } : null;
  }
  if (!DATES.has(name)) {
    clauses[name] = value;
    return null;
  }
  const d = parseDate(value, now);
  if (d.error) return d;
  if (name === 'on') {
    clauses.onStart = startOfDayMs(d.ms);
    clauses.onEnd = clauses.onStart + DAY_MS;
  } else clauses[name] = d.ms;
  return null;
}

/** Clauses of commented/lastComment (`comment`) or fileAttached (`attachment`), dates resolved against now. */
export function parseClauses(text, kind, now) {
  const t = tokenize(text);
  if (t.error) return t;
  const allowed = KEYWORDS[kind] ?? [];
  const clauses = {};
  const seen = new Set();
  for (let i = 0; i < t.words.length; i += 2) {
    const key = t.words[i].toLowerCase();
    if (LATER[kind]?.includes(key)) return { error: ERR.clauseNotYet(canonical(key)) };
    if (!allowed.includes(key)) return { error: ERR.unknownClause(t.words[i], allowed.map(canonical)) };
    const name = canonical(key);
    if (i + 1 >= t.words.length || t.words[i + 1] === '') return { error: ERR.clauseNeedsValue(name) };
    if (seen.has(name)) return { error: ERR.clauseTwice(name) };
    seen.add(name);
    const failed = readValue(clauses, name, t.words[i + 1], now);
    if (failed) return failed;
  }
  return { clauses };
}
