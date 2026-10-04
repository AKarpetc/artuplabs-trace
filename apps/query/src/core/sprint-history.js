import { sortIds } from './ids.js';

const NUMERIC = /^\d+$/;
const JIRA_OFFSET = /([+-]\d{2})(\d{2})$/;
const byTime = (a, b) => a.at - b.at || Number(a.changeId) - Number(b.changeId);

/** Epoch ms from a number, a numeric string, an ISO string or Jira's `+0000` form; null when absent or unreadable. */
export function toMs(value) {
  const text = String(value ?? '').trim();
  const t = typeof value === 'number' ? value : NUMERIC.test(text) ? Number(text) : Date.parse(text.replace(JIRA_OFFSET, '$1:$2'));
  return Number.isFinite(t) ? t : null;
}

/** Sprint ids of a changelog value such as "12, 13". */
export function sprintIdsOf(value) {
  return new Set(String(value ?? '').split(',').map((s) => s.trim()).filter((s) => NUMERIC.test(s)));
}

/** Added and removed events of one issue from its Sprint field changes; changes without a readable time are skipped. */
export function sprintEvents(issueId, histories, sprintFieldIds) {
  const out = [];
  for (const h of histories ?? []) {
    const at = toMs(h.created);
    if (at === null) continue;
    for (const item of h.items ?? []) {
      if (!(sprintFieldIds.has(item.fieldId) || item.field === 'Sprint')) continue;
      const from = sprintIdsOf(item.from);
      const to = sprintIdsOf(item.to);
      for (const s of to) if (!from.has(s)) out.push({ issueId: String(issueId), sprintId: s, kind: 'added', at, changeId: String(h.id) });
      for (const s of from) if (!to.has(s)) out.push({ issueId: String(issueId), sprintId: s, kind: 'removed', at, changeId: String(h.id) });
    }
  }
  return out;
}

/** Status changes of one issue that move it between categories (new, indeterminate, done); untimed changes are skipped. */
export function statusEvents(issueId, histories, categoryOf) {
  const out = [];
  for (const h of histories ?? []) {
    const at = toMs(h.created);
    if (at === null) continue;
    for (const item of h.items ?? []) {
      if (item.fieldId !== 'status' && item.field !== 'status') continue;
      const from = categoryOf.get(String(item.from)) ?? 'new';
      const to = categoryOf.get(String(item.to)) ?? 'new';
      if (from !== to) out.push({ issueId: String(issueId), at, from, to, changeId: String(h.id) });
    }
  }
  return out;
}

const inWindow = (at, { startAt, completeAt }) => startAt !== null && at > startAt && (completeAt === null || at <= completeAt);

/** Issues added to the sprint after it started and up to its close, even if removed later. */
export function addedAfterStart(events, sprintId, window) {
  return sortIds(events.filter((e) => e.sprintId === String(sprintId) && e.kind === 'added' && inWindow(e.at, window)).map((e) => e.issueId));
}

/** Issues removed after the start and not back in the sprint at its close (or now, while it runs). */
export function removedAfterStart(events, sprintId, window) {
  const mine = events.filter((e) => e.sprintId === String(sprintId)).sort(byTime);
  const removed = new Set(mine.filter((e) => e.kind === 'removed' && inWindow(e.at, window)).map((e) => e.issueId));
  const out = [];
  for (const id of removed) {
    const last = mine.filter((e) => e.issueId === id && (window.completeAt === null || e.at <= window.completeAt)).at(-1);
    if (last?.kind === 'removed') out.push(id);
  }
  return sortIds(out);
}

/** Issues that were in the sprint when they were created: today's members without any event of it, and issues whose first event of it removes them. */
export function createdInSprint(currentIds, events, sprintId) {
  const first = new Map();
  for (const e of events.filter((x) => x.sprintId === String(sprintId)).sort(byTime)) if (!first.has(e.issueId)) first.set(e.issueId, e.kind);
  const out = currentIds.map(String).filter((id) => !first.has(id));
  for (const [id, kind] of first) if (kind === 'removed') out.push(id);
  return sortIds(out);
}

/** Members of a sprint at time t: today's members with every later event undone. */
export function membersAt(currentIds, events, sprintId, t) {
  const members = new Set(currentIds.map(String));
  const later = events.filter((e) => e.sprintId === String(sprintId) && e.at > t).sort(byTime).reverse();
  for (const e of later) {
    if (e.kind === 'added') members.delete(e.issueId);
    else members.add(e.issueId);
  }
  return members;
}

/** Status category in force at time t, from category changes and today's category. */
export function categoryAt(changes, t, current) {
  const sorted = [...changes].sort(byTime);
  const before = sorted.filter((c) => c.at <= t);
  if (before.length) return before.at(-1).to;
  if (sorted.length) return sorted[0].from;
  return current;
}

/** Members at the close (or now, while running) split by whether their category was done then. */
export function sprintOutcome({ sprintId, window, now, currentIds, events, statusByIssue, currentCategory }) {
  const t = window.completeAt ?? now;
  const complete = [];
  const incomplete = [];
  for (const id of membersAt(currentIds, events, sprintId, t)) {
    const category = categoryAt(statusByIssue.get(id) ?? [], t, currentCategory.get(id) ?? 'new');
    if (category === 'done') complete.push(id);
    else incomplete.push(id);
  }
  return { complete: sortIds(complete), incomplete: sortIds(incomplete) };
}
