import { ERR } from './errors.js';

const DURATION = { date: { m: 60000, h: 3600000, d: 86400000, w: 604800000 }, number: { m: 60, h: 3600, d: 28800, w: 144000 } };
const ALIASES = { originalestimate: 'timeoriginalestimate', remainingestimate: 'timeestimate', due: 'duedate', resolved: 'resolutiondate' };
const TOKEN = /\s*(?:(\d+(?:\.\d+)?)([wdhm])?(?![A-Za-z0-9_])|([A-Za-z_][A-Za-z0-9_.]*)|"((?:[^"\\]|\\.)*)"|(<=|>=|!=|==|&&|\|\||=|<|>|\+|-|\*|\/|\(|\)))/y;
const COMPARE = new Set(['<', '<=', '>', '>=', '=', '==', '!=']);
const BOOLEAN = new Set(['cmp', 'and', 'or']);

function classify(m) {
  if (m[1] !== undefined) return m[2] ? { t: 'dur', v: Number(m[1]), unit: m[2] } : { t: 'num', v: Number(m[1]) };
  if (m[3] !== undefined) {
    const word = m[3].toLowerCase();
    if (word === 'and' || word === 'or') return { t: 'op', v: word };
    return { t: 'id', v: ALIASES[word] ?? word };
  }
  if (m[4] !== undefined) return { t: 'id', v: m[4].replace(/\\(.)/g, '$1') };
  return { t: 'op', v: m[5] === '&&' ? 'and' : m[5] === '||' ? 'or' : m[5] };
}

function tokenize(s) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < s.length) {
    const at = TOKEN.lastIndex;
    const rest = s.slice(at);
    if (!rest.trim()) break;
    const m = TOKEN.exec(s);
    if (!m) return { error: ERR.expressionUnexpected(rest.trim(), at + 1 + rest.length - rest.trimStart().length) };
    const raw = m[0].trimStart();
    tokens.push({ ...classify(m), raw, at: TOKEN.lastIndex - raw.length + 1 });
  }
  return { tokens };
}

function parser(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (...ops) => peek()?.t === 'op' && ops.includes(peek().v);
  const fail = (message) => {
    throw new Error(message);
  };
  const arithmetic = (node) => (BOOLEAN.has(node.k) ? fail(ERR.expressionArithmetic()) : node);

  function primary() {
    const tok = tokens[i];
    if (!tok) fail(ERR.expressionEnd());
    i += 1;
    if (tok.t === 'num') return { k: 'num', v: tok.v };
    if (tok.t === 'dur') return { k: 'dur', v: tok.v, unit: tok.unit };
    if (tok.t === 'id') return { k: 'field', name: tok.v };
    if (tok.v === '(') {
      const inner = or();
      if (!isOp(')')) fail(ERR.expressionParen());
      i += 1;
      return inner;
    }
    if (tok.v === '-') return { k: 'neg', e: arithmetic(primary()) };
    return fail(ERR.expressionUnexpected(tok.raw, tok.at));
  }
  function product() {
    let node = primary();
    while (isOp('*', '/')) {
      const op = tokens[i].v;
      i += 1;
      node = { k: 'bin', op, l: arithmetic(node), r: arithmetic(primary()) };
    }
    return node;
  }
  function sum() {
    let node = product();
    while (isOp('+', '-')) {
      const op = tokens[i].v;
      i += 1;
      node = { k: 'bin', op, l: arithmetic(node), r: arithmetic(product()) };
    }
    return node;
  }
  function compare() {
    const left = sum();
    if (peek()?.t === 'op' && COMPARE.has(peek().v)) {
      const op = tokens[i].v;
      i += 1;
      return { k: 'cmp', op, l: arithmetic(left), r: arithmetic(sum()) };
    }
    return left;
  }
  function and() {
    let node = compare();
    while (isOp('and')) {
      i += 1;
      node = { k: 'and', l: node, r: compare() };
    }
    return node;
  }
  function or() {
    let node = and();
    while (isOp('or')) {
      i += 1;
      node = { k: 'or', l: node, r: and() };
    }
    return node;
  }
  return { or, next: () => tokens[i] };
}

function fieldsOf(node, out = new Set()) {
  if (node.k === 'field') out.add(node.name);
  for (const child of [node.l, node.r, node.e]) if (child) fieldsOf(child, out);
  return out;
}

/** Expression text → AST and the fields it reads, or `{ error }`; the top level must be a comparison. */
export function parseExpression(text) {
  const t = tokenize(String(text ?? ''));
  if (t.error) return t;
  try {
    const p = parser(t.tokens);
    const ast = p.or();
    const extra = p.next();
    if (extra) return { error: ERR.expressionUnexpected(extra.raw, extra.at) };
    if (!BOOLEAN.has(ast.k)) return { error: ERR.expressionNotCompared() };
    return { ast, fields: [...fieldsOf(ast)].sort() };
  } catch (error) {
    return { error: error.message };
  }
}

function compareValues(op, a, b) {
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '!=') return a !== b;
  return a === b;
}

/** Value of an AST node: numbers for arithmetic (null when a field is empty), booleans for comparisons. */
export function evaluate(node, valueOf, mode) {
  if (node.k === 'num') return node.v;
  if (node.k === 'dur') return node.v * DURATION[mode][node.unit];
  if (node.k === 'field') return valueOf(node.name) ?? null;
  if (node.k === 'neg') {
    const v = evaluate(node.e, valueOf, mode);
    return v === null ? null : -v;
  }
  if (node.k === 'and') return evaluate(node.l, valueOf, mode) === true && evaluate(node.r, valueOf, mode) === true;
  if (node.k === 'or') return evaluate(node.l, valueOf, mode) === true || evaluate(node.r, valueOf, mode) === true;
  const a = evaluate(node.l, valueOf, mode);
  const b = evaluate(node.r, valueOf, mode);
  if (node.k === 'cmp') return a !== null && b !== null && compareValues(node.op, a, b);
  if (a === null || b === null) return null;
  if (node.op === '+') return a + b;
  if (node.op === '-') return a - b;
  if (node.op === '*') return a * b;
  return b === 0 ? null : a / b;
}

/** A Jira field value as a number: numbers, numeric strings, dates (ms), and objects with value, votes or watchCount. */
export function fieldValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    const text = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const t = /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  for (const key of ['value', 'votes', 'watchCount']) if (typeof raw[key] === 'number') return raw[key];
  return null;
}
