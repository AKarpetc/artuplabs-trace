import { FUNCTION_BY_NAME, usage } from './catalog.js';
import { ERR, LOG } from './errors.js';

const PAGE = /^__aq:([lm])([1-9]\d{0,2})$/;
const WHOLE = /^\d{1,6}$/;
const SIGNED = /^([+-]?)(\d{1,6})$/;
const COUNT_OPS = { '': 'exactly', '+': 'more', '-': 'fewer' };
const PER_USER = /\bcurrentUser\s*\(/i;

/** Hidden trailing argument of a tree page call: `__aq:l3` (leaf 3) or `__aq:m1` (middle node 1). */
export function pageToken(page) {
  return `__aq:${page.kind === 'leaf' ? 'l' : 'm'}${page.index}`;
}

/** The page a token addresses, or null when the string is not a page token. */
export function pageOf(token) {
  const m = PAGE.exec(String(token ?? ''));
  return m ? { kind: m[1] === 'l' ? 'leaf' : 'mid', index: Number(m[2]) } : null;
}

/** Splits clause arguments into the user's arguments and a trailing page token. */
export function splitPage(raw) {
  const list = Array.isArray(raw) ? raw.map((a) => String(a ?? '')) : [];
  const page = list.length ? pageOf(list[list.length - 1]) : null;
  return { userArgs: page ? list.slice(0, -1) : list, page };
}

/** Identity of a precomputation group: the function and the user's arguments without the page token. */
export function groupKey(functionName, userArgs) {
  return `${functionName}${JSON.stringify(userArgs)}`;
}

function inRange(spec, n) {
  return n >= spec.min && n <= spec.max ? null : `${spec.name} must be between ${spec.min} and ${spec.max}`;
}

function parseNumber(spec, value) {
  if (spec.type === 'int') {
    if (!WHOLE.test(value)) return { error: `${spec.name} must be a whole number` };
    const n = Number(value);
    return { error: inRange(spec, n), value: n };
  }
  const m = SIGNED.exec(value);
  if (!m) return { error: `${spec.name} must be a whole number, optionally with + or -` };
  const n = Number(m[2]);
  return { error: inRange(spec, n), value: { op: COUNT_OPS[m[1]], n } };
}

function parseOne(spec, raw) {
  const value = raw.trim();
  if (spec.type === 'int' || spec.type === 'count') return parseNumber(spec, value);
  if (!value) return { error: `${spec.name} must not be empty` };
  if (PER_USER.test(value)) return { error: ERR.perUser('currentUser()') };
  if (spec.type === 'ext') return { value: value.replace(/^\.+/, '').toLowerCase() };
  return { value };
}

function severalLinkTypes(f, userArgs) {
  const last = f.args.length - 1;
  if (f.args[0]?.type !== 'jql' || f.args[last].name !== 'linkType' || userArgs.length <= f.args.length) return null;
  const call = (type) => `issue in ${f.name}(…, ${JSON.stringify(type.trim())})`;
  return `takes one link type; call it once per link type and join the calls with OR, e.g. ${call(userArgs[last])} OR ${call(userArgs[last + 1])}`;
}

/** Clause arguments → `{ args, userArgs, page }`, or `{ error }` (value-free) / `{ error, log }` (the error quotes argument values, the log does not). */
export function parseArgs(functionName, raw) {
  const f = FUNCTION_BY_NAME.get(functionName);
  if (!f) return { error: `Unknown function ${functionName}` };
  const { userArgs, page } = splitPage(raw);
  const several = severalLinkTypes(f, userArgs);
  if (several) return { error: ERR.withFunction(f.name, several), log: LOG.severalLinkTypes() };
  const required = f.args.filter((a) => a.required).length;
  if (userArgs.length < required || userArgs.length > f.args.length) return { error: `Usage: ${usage(f)}` };
  const args = {};
  for (let i = 0; i < userArgs.length; i += 1) {
    const r = parseOne(f.args[i], userArgs[i]);
    if (r.error) return { error: ERR.withFunction(f.name, r.error) };
    args[f.args[i].name] = r.value;
  }
  return { args, userArgs, page };
}
