import { JOURNAL_PAGE, TOUCHED_CHECK_MAX } from './limits.js';
import { FUNCTION_BY_NAME } from './catalog.js';
import { groupKey, splitPage } from './args.js';
import { sortIds } from './ids.js';

const FAMILY_KINDS = {
  query: [],
  links: ['link', 'issue-deleted'],
  subtasks: ['issue-created', 'issue-deleted', 'parent'],
  board: ['sprint'],
  sprint: ['sprint', 'sprint-field', 'status', 'issue-created', 'issue-deleted', 'index-sprint'],
  comment: ['comment', 'issue-created', 'issue-deleted', 'index-comments'],
  attachment: ['attachment', 'issue-created', 'issue-deleted', 'index-comments'],
};
const RELATIVE = /(^|[\s"(])[-+]\d+[mhdw]\b|\b(start|end)Of(Day|Week|Month|Year)\s*\(/i;

/** A journal page → touched ids, change kinds, the oldest event time and whether everything must be recomputed. */
export function summarizeJournal(rows, { page = JOURNAL_PAGE, maxTouched = TOUCHED_CHECK_MAX } = {}) {
  const ids = new Set();
  const kinds = new Set();
  let firstAt = null;
  for (const row of rows) {
    const at = Number(String(row.key).split(':')[1]);
    if (Number.isFinite(at) && (firstAt === null || at < firstAt)) firstAt = at;
    for (const id of row.value?.ids ?? []) ids.add(String(id));
    for (const kind of row.value?.kinds ?? ['unknown']) kinds.add(kind);
  }
  const touched = sortIds(ids);
  const all = rows.length >= page || kinds.has('unknown') || touched.length > maxTouched;
  return { touched, kinds: [...kinds].sort(), all, firstAt };
}

/** Active precomputations of known functions, grouped by function and user arguments (pages join their root). */
export function groupPrecomputations(pcs, { now, activeMs }) {
  const groups = new Map();
  for (const pc of pcs) {
    const f = FUNCTION_BY_NAME.get(pc.functionName);
    if (!f) continue;
    if (pc.used && now - Date.parse(pc.used) > activeMs) continue;
    const { userArgs } = splitPage(pc.arguments);
    const key = groupKey(f.name, userArgs);
    if (!groups.has(key)) groups.set(key, { key, functionName: f.name, family: f.family, userArgs, items: [] });
    groups.get(key).items.push(pc);
  }
  return [...groups.values()];
}

/** Whether changes of these kinds can make a result of this family stale; the query family is decided by overlap. */
export function familyWants(family, kinds) {
  return (FAMILY_KINDS[family] ?? []).some((k) => kinds.includes(k));
}

/** Query family: stale when a touched issue is watched or now matches the subquery; unknown inputs (null) mean stale. */
export function queryOverlap({ watched, liveHits }) {
  if (liveHits === null || watched === null) return true;
  return liveHits.length > 0 || watched;
}

/** Whether arguments mention the clock (`-7d`, `startOfWeek()`), so the result changes without any event. */
export function isTimeRelative(userArgs) {
  return userArgs.some((a) => RELATIVE.test(a));
}

/** A stored precomputation Jira cannot answer from: a value that still carries an error (Jira keeps the error and returns no issues), or neither. */
export function needsRepair(pc) {
  const hasError = pc.error !== undefined && pc.error !== null;
  return Boolean(pc.value) === hasError;
}

const lastWrite = (g) => Math.min(...g.items.map((pc) => Date.parse(pc.updated ?? pc.created ?? '') || 0));

/** Groups the hourly reconcile recomputes: used within usedMs and not rewritten for staleMs, tied to the clock, or needing repair. */
export function reconcileTargets(groups, { now, usedMs, staleMs, max }) {
  return groups
    .filter((g) => g.items.some((pc) => pc.used && now - Date.parse(pc.used) <= usedMs))
    .filter((g) => now - lastWrite(g) >= staleMs || isTimeRelative(g.userArgs) || g.items.some(needsRepair))
    .sort((a, b) => lastWrite(a) - lastWrite(b))
    .slice(0, max);
}
