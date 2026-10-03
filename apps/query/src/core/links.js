import { MAX_DEPTH } from './limits.js';
import { FAIL } from './errors.js';
import { quote } from './jql-build.js';
import { sortIds } from './ids.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const anyOf = (typeId) => ({ filter: { typeId, direction: 'any' } });

/** Link type argument (type name or direction description) → filter, null for every link, or `{ error, log }`. */
export function matchLinkType(types, arg) {
  if (arg === undefined) return { filter: null };
  const text = String(arg).trim();
  const want = norm(text);
  const named = types.filter((t) => t.name === text);
  if (named.length === 1) return anyOf(String(named[0].id));
  const outward = types.filter((t) => norm(t.outward) === want);
  const inward = types.filter((t) => norm(t.inward) === want);
  const ids = new Set([...outward, ...inward].map((t) => String(t.id)));
  if (!ids.size) {
    const loose = types.filter((t) => norm(t.name) === want);
    if (loose.length === 1) return anyOf(String(loose[0].id));
    return loose.length ? FAIL.ambiguous('Link type', text, loose.length) : FAIL.notFound('Link type', text);
  }
  if (ids.size > 1) return FAIL.ambiguous('Link type', text, ids.size);
  const [typeId] = ids;
  if (outward.length && inward.length) return anyOf(typeId);
  return { filter: { typeId, direction: outward.length ? 'outward' : 'inward' } };
}

/** Ids at the other end of an issue's links that pass the filter (`outwardIssue`: this issue → it, by type.outward). */
export function linkedIds(issuelinks, filter) {
  const out = [];
  for (const link of issuelinks ?? []) {
    const other = link.outwardIssue ?? link.inwardIssue;
    if (!other) continue;
    const direction = link.outwardIssue ? 'outward' : 'inward';
    if (filter && String(link.type?.id) !== filter.typeId) continue;
    if (filter && filter.direction !== 'any' && filter.direction !== direction) continue;
    out.push(String(other.id));
  }
  return out;
}

const descriptions = (t, direction) => (direction === 'outward' ? [t.outward] : direction === 'inward' ? [t.inward] : [...new Set([t.outward, t.inward])]);

/** hasLinks as Jira's own `issueLinkType` clause: always fresh, no value limit. */
export function hasLinksJql(types, filter) {
  if (!filter) return 'issueLinkType is not EMPTY';
  const t = types.find((x) => String(x.id) === filter.typeId);
  const names = descriptions(t, filter.direction);
  return names.length === 1 ? `issueLinkType = ${quote(names[0])}` : `issueLinkType in (${names.map(quote).join(', ')})`;
}

/** `{ native }` when Jira's `issueLinkType` returns exactly the filtered links, else `{ compute }`: Jira matches a value against type names first and then takes both sides. */
export function linkQuery(types, filter) {
  if (!filter) return { native: hasLinksJql(types, filter) };
  const own = types.find((x) => String(x.id) === filter.typeId);
  const others = types.filter((x) => x !== own);
  const directed = filter.direction !== 'any';
  const clash = (value) => {
    const v = norm(value);
    if (others.some((x) => [x.name, x.outward, x.inward].some((w) => norm(w) === v))) return true;
    return directed && (norm(own.name) === v || norm(own.outward) === norm(own.inward));
  };
  return descriptions(own, filter.direction).some(clash) ? { compute: filter } : { native: hasLinksJql(types, filter) };
}

/** Issues reachable in 1..depth link steps (at most 10) from the starts; cycles are walked once. */
export async function closure(starts, depth, neighboursOf) {
  const expanded = new Set();
  const reached = new Set();
  let frontier = [...new Set(starts.map(String))];
  for (let level = 1; level <= Math.min(depth, MAX_DEPTH) && frontier.length; level += 1) {
    for (const id of frontier) expanded.add(id);
    const map = await neighboursOf(frontier);
    const next = new Set();
    for (const id of frontier) {
      for (const other of map.get(id) ?? []) {
        reached.add(String(other));
        if (!expanded.has(String(other))) next.add(String(other));
      }
    }
    frontier = [...next];
  }
  return sortIds(reached);
}
