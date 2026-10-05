import { JOURNAL_PAGE, TOUCHED_CHECK_MAX } from './limits.js';
import { FUNCTION_BY_NAME } from './catalog.js';
import { groupKey, splitPage } from './args.js';
import { sortIds } from './ids.js';
import { isTooExpensiveError, isWaitedError } from './errors.js';

const FAMILY_KINDS = {
  query: [],
  links: ['link', 'issue-deleted'],
  subtasks: ['issue-created', 'issue-deleted', 'parent'],
  board: ['sprint'],
  sprint: ['sprint', 'sprint-field', 'status', 'issue-created', 'issue-deleted', 'index-sprint'],
  comment: ['comment', 'issue-created', 'issue-deleted', 'index-comments'],
  attachment: ['attachment', 'issue-created', 'issue-deleted', 'index-comments'],
};
/** Journal change kind that rewrites every stored precomputation, used or not: written when the excluded projects change and when a fill of chosen projects ends. */
export const REWRITE_ALL_KIND = 'rewrite-all';
const RELATIVE = /(^|[\s"(])[-+]\d+[mhdw]\b|\b(start|end)Of(Day|Week|Month|Year)\s*\(/i;

/** A journal page → touched ids, change kinds, the oldest event time and whether everything must be recomputed (a full page, an unknown event, too many issues or a rewrite of all). */
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
  const all = rows.length >= page || kinds.has('unknown') || kinds.has(REWRITE_ALL_KIND) || touched.length > maxTouched;
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

/** Whether Jira used a precomputation of the group within `ms` before `now`; a group without precomputations (a background job) counts as used. */
export function usedWithin(group, now, ms) {
  return !group.items.length || group.items.some((pc) => pc.used && now - Date.parse(pc.used) <= ms);
}

/** Whether changes of these kinds can make a result of this family stale; the query family is decided by overlap. */
export function familyWants(family, kinds) {
  return (FAMILY_KINDS[family] ?? []).some((k) => kinds.includes(k));
}

const COMMENT_TIME_KINDS = ['comment', 'index-comments'];
const COMMENT_TIME_FIELD = /(first|last)commented/i;

/** Whether a query-family group reads comment times (firstCommented, lastCommented) and the changes touch comments, which may name no issue. */
export function commentTimesWanted(group, kinds) {
  if (FUNCTION_BY_NAME.get(group.functionName)?.group !== 'fields') return false;
  return COMMENT_TIME_FIELD.test(String(group.userArgs?.[1] ?? '')) && COMMENT_TIME_KINDS.some((k) => kinds.includes(k));
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

const kindOf = (pc) => (pc.errorKind !== undefined ? pc.errorKind : errorKindOf(pc.error));

/** A stored precomputation Jira cannot answer from: a value that still carries an error (Jira keeps the error and returns no issues), or neither. */
export function needsRepair(pc) {
  if (kindOf(pc) === 'waited') return true;
  const hasError = pc.errorKind !== undefined ? pc.errorKind !== null : pc.error !== undefined && pc.error !== null;
  const hasValue = pc.hasValue !== undefined ? pc.hasValue : Boolean(pc.value);
  return hasValue === hasError;
}

/** The kind of a stored precomputation error: null without one, 'tooExpensive' for the error of the Jira points budget, else 'other'. */
export function errorKindOf(error) {
  if (error === undefined || error === null) return null;
  if (isWaitedError(error)) return 'waited';
  return isTooExpensiveError(error) ? 'tooExpensive' : 'other';
}

/** Whether every precomputation of a group stores the too-expensive error: the background leaves it until the user narrows the query. */
export function pricedOut(group) {
  return group.items.length > 0 && group.items.every((pc) => kindOf(pc) === 'tooExpensive');
}

const lastWrite = (g) => Math.min(...g.items.map((pc) => Date.parse(pc.updated ?? pc.created ?? '') || 0));

/** Whether the reconcile rewrites a group: not rewritten for staleMs, tied to the clock, or needing repair. */
export function rewriteDue(group, { now, staleMs }) {
  return now - lastWrite(group) >= staleMs || isTimeRelative(group.userArgs) || group.items.some(needsRepair);
}

/**
 * Groups the reconcile rewrites, at most `max`: used within `usedMs` and due by `rewriteDue` (a heavy one, in `heavy`, only after `heavyMs`),
 * or used after a pass skipped them (`skips`: key → when), those first, then the oldest rewrites; groups that store the too-expensive error never.
 */
export function reconcileTargets(groups, { now, usedMs, staleMs, max, skips = new Map(), heavy = new Set(), heavyMs = staleMs }) {
  const usedAfterSkip = (g) => skips.has(g.key) && g.items.some((pc) => pc.used && Date.parse(pc.used) > skips.get(g.key));
  return groups
    .filter((g) => !pricedOut(g))
    .filter((g) => g.items.some((pc) => pc.used && now - Date.parse(pc.used) <= usedMs))
    .filter((g) => usedAfterSkip(g) || rewriteDue(g, { now, staleMs: heavy.has(g.key) ? heavyMs : staleMs }))
    .sort((a, b) => Number(usedAfterSkip(b)) - Number(usedAfterSkip(a)) || lastWrite(a) - lastWrite(b))
    .slice(0, max);
}
