import { TREE_FANOUT, TREE_LEVELS, VALUE_LIMIT } from './limits.js';
import { ERR } from './errors.js';
import { EMPTY, pageCall } from './jql-build.js';

/** Sorted ids as a value source. */
export function valuesOf(ids) {
  return { n: ids.length, range: (from, to) => ids.slice(from, to) };
}

/** How n values are stored: one list, pages under the root (1 or 2 levels), or over capacity. */
export function treeShape(n, levels = TREE_LEVELS) {
  const leaves = Math.ceil(n / VALUE_LIMIT);
  if (n <= VALUE_LIMIT) return { kind: 'list', leaves };
  if (leaves <= TREE_FANOUT) return { kind: 'tree', levels: 1, leaves };
  if (levels >= 2 && leaves <= TREE_FANOUT * TREE_FANOUT) return { kind: 'tree', levels: 2, leaves, mids: Math.ceil(leaves / TREE_FANOUT) };
  return { kind: 'over', capacity: (levels >= 2 ? TREE_FANOUT * TREE_FANOUT : TREE_FANOUT) * VALUE_LIMIT };
}

const anyOf = (clauses) => (clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
const span = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

/**
 * Stored JQL of one precomputation: the root (page null), a middle node or a leaf. `field` is `id` or `parent`;
 * `rootFilter` is ANDed on the root only; a leaf nested under the filter returns no issues.
 */
export function buildFragment({ functionName, userArgs, page, values, field, rootFilter, levels = TREE_LEVELS }) {
  const list = (from, to) => {
    const ids = values.range(from, to);
    return ids.length ? `${field} in (${ids.join(',')})` : EMPTY;
  };
  const shape = treeShape(values.n, levels);
  const leafCall = (index) => pageCall(functionName, userArgs, { kind: 'leaf', index });
  if (page?.kind === 'leaf') return { jql: list((page.index - 1) * VALUE_LIMIT, page.index * VALUE_LIMIT) };
  if (page?.kind === 'mid') {
    if (shape.kind === 'over') return { error: ERR.tooMany(values.n, shape.capacity) };
    const first = (page.index - 1) * TREE_FANOUT + 1;
    const last = Math.min(shape.leaves, first + TREE_FANOUT - 1);
    return { jql: first > last ? EMPTY : anyOf(span(first, last).map(leafCall)) };
  }
  if (!values.n) return { jql: EMPTY };
  if (shape.kind === 'over') return { error: ERR.tooMany(values.n, shape.capacity) };
  let body = list(0, values.n);
  if (shape.kind === 'tree' && shape.levels === 1) body = anyOf(span(1, shape.leaves).map(leafCall));
  if (shape.kind === 'tree' && shape.levels === 2) body = anyOf(span(1, shape.mids).map((index) => pageCall(functionName, userArgs, { kind: 'mid', index })));
  if (!rootFilter) return { jql: body };
  return { jql: `(${rootFilter}) AND ${body.startsWith('(') ? body : `(${body})`}` };
}
