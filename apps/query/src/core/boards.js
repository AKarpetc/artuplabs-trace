import { ERR } from './errors.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const ms = (v) => (v ? Date.parse(v) : null);

function pick(list, arg, what) {
  const text = String(arg).trim();
  if (/^\d+$/.test(text)) {
    const byId = list.find((x) => String(x.id) === text);
    if (byId) return { item: byId };
  }
  const named = list.filter((x) => norm(x.name) === norm(text));
  if (named.length === 1) return { item: named[0] };
  if (named.length > 1) return { error: ERR.ambiguous(what, text, named.length) };
  return { error: ERR.notFound(what, text) };
}

/** Board by id (a numeric argument is tried as an id first) or by unique name. */
export const matchBoard = (boards, arg) => pick(boards, arg, 'Board');

/** Sprint of a board by id or unique name. */
export const matchSprint = (sprints, arg) => pick(sprints, arg, 'Sprint');

/** Start (`startDate`: the Agile API gives no activation time) and completion time of a sprint, in ms. */
export function sprintWindow(sprint) {
  return { startAt: ms(sprint.startDate), completeAt: ms(sprint.completeDate) };
}

/** The active sprint with the lowest id, or null. */
export function activeSprint(sprints) {
  return sprints.filter((s) => s.state === 'active').sort((a, b) => a.id - b.id)[0] ?? null;
}

/** The closed sprint completed last, or null. */
export function lastClosed(sprints) {
  return sprints.filter((s) => s.state === 'closed').sort((a, b) => (ms(b.completeDate) ?? 0) - (ms(a.completeDate) ?? 0) || b.id - a.id)[0] ?? null;
}

/** The future sprint planned first (by start date, then id), or null. */
export function nextFuture(sprints) {
  return sprints.filter((s) => s.state === 'future').sort((a, b) => (ms(a.startDate) ?? Infinity) - (ms(b.startDate) ?? Infinity) || a.id - b.id)[0] ?? null;
}
