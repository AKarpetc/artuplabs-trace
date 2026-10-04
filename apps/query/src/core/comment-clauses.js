import { DAY_MS, parseDate, startOfDayMs } from './dates.js';
import { ERR } from './errors.js';
import { sortIds } from './ids.js';
import { CLAUSES_MAX_LENGTH } from './limits.js';

const KEYWORDS = {
  comment: ['by', 'after', 'before', 'on', 'inrole', 'ingroup', 'rolelevel', 'grouplevel'],
  attachment: ['by', 'after', 'before', 'on', 'ext'],
};
const CANONICAL = { inrole: 'inRole', ingroup: 'inGroup', rolelevel: 'roleLevel', grouplevel: 'groupLevel' };
const DATES = new Set(['after', 'before', 'on']);
const WORD = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const canonical = (key) => CANONICAL[key] ?? key;

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
    clauses.ext = value.replace(/^\.+/, '').toLowerCase();
    return null;
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

/** Whether one comment or attachment passes every clause; people holds account ids resolved for by, inGroup and inRole. */
export function metaMatches(meta, clauses, people) {
  if (clauses.by !== undefined && !people?.by?.has(meta.author)) return false;
  if (clauses.inGroup !== undefined && !people?.inGroup?.has(meta.author)) return false;
  if (clauses.inRole !== undefined && !people?.inRole?.get(String(meta.projectId))?.has(meta.author)) return false;
  if (clauses.roleLevel !== undefined && !(meta.visType === 'role' && eq(meta.visValue, clauses.roleLevel))) return false;
  if (clauses.groupLevel !== undefined && !(meta.visType === 'group' && eq(meta.visValue, clauses.groupLevel))) return false;
  if (clauses.after !== undefined && !(meta.createdAt > clauses.after)) return false;
  if (clauses.before !== undefined && !(meta.createdAt < clauses.before)) return false;
  if (clauses.onStart !== undefined && !(meta.createdAt >= clauses.onStart && meta.createdAt < clauses.onEnd)) return false;
  if (clauses.ext !== undefined && meta.ext !== clauses.ext) return false;
  return true;
}

function lastPerIssue(metas) {
  const latest = new Map();
  for (const m of metas) {
    const cur = latest.get(m.issueId);
    if (!cur || m.createdAt > cur.createdAt || (m.createdAt === cur.createdAt && Number(m.id) > Number(cur.id))) latest.set(m.issueId, m);
  }
  return [...latest.values()];
}

/** Issues with a matching comment or attachment; with `last`, only each issue's latest comment is checked. */
export function issuesWith(metas, clauses, { last = false, people = {} } = {}) {
  const pool = last ? lastPerIssue(metas) : metas;
  return sortIds(pool.filter((m) => metaMatches(m, clauses, people)).map((m) => m.issueId));
}
