import {
  BORROW_CAP_SHARE, BORROW_MINUTE, PASS_INTERVAL_MAX_S, PASS_INTERVAL_MIN_S, REFRESH_OVERHEAD_SHARE, CHANGELOG_POINT_FACTOR, COMMENT_POINT_FACTOR, GROUP_POINTS_SHARE, LANE_SHARES, LIGHT_GROUP_SHARE, POINTS_OVERHEAD, POINTS_OVERRUN, SITE_POINTS_TIER1, SITE_POINTS_TIER2, VALUE_LIMIT,
} from './limits.js';
import { quote } from './jql-build.js';

/** One hour in ms: Jira's rate-limit windows reset at the start of each UTC hour. */
export const HOUR_MS = 60 * 60 * 1000;

/** The lane of Jira requests sent outside any points scope, and of a handler that names none. */
export const DEFAULT_LANE = 'fn';

const lengthOf = (value) => (Array.isArray(value) ? value.length : 0);
const holdsComments = (issues) => Array.isArray(issues) && issues.some((i) => i?.fields && 'comment' in i.fields);

const READS = [
  [/\/search\/jql$/, (body) => lengthOf(body?.issues)],
  [/\/issue\/bulkfetch$/, (body) => lengthOf(body?.issues) * (holdsComments(body?.issues) ? COMMENT_POINT_FACTOR : 1)],
  [/\/changelog\/bulkfetch$/, (body) => lengthOf(body?.issueChangeLogs) * CHANGELOG_POINT_FACTOR],
  [/\/user\/search$/, (body) => 2 * lengthOf(body)],
  [/\/group\/member$/, (body) => 2 * lengthOf(body?.values)],
  [/\/project\/\*\/role\/\*$/, (body) => 2 * lengthOf(body?.actors)],
  [/\/issueLinkType$/, (body) => lengthOf(body?.issueLinkTypes)],
  [/\/(field|status)$/, (body) => lengthOf(body)],
  [/\/issue\/\*$/, (body) => (body ? 1 : 0)],
];
const WRITES = [/\/jql\/function\/computation$/, /\/search\/approximate-count$/, /\/jql\/parse$/];

/** Jira rate-limit points one answer costs: 1 for the request, plus 1 per object it returns and 2 per user or group; a write, a count and a parse cost 1. */
export function pointsOf(method, endpoint, body) {
  if (body === null || body === undefined) return 1;
  if (method !== 'GET' && WRITES.some((pattern) => pattern.test(endpoint))) return 1;
  const read = READS.find(([pattern]) => pattern.test(endpoint));
  if (read) return 1 + read[1](body);
  return 1 + lengthOf(body?.values);
}

const FAN_OUT = new Set(['epicsOf', 'childIssuesOf', 'linkedIssuesOfRecursive', 'linkedIssuesOfRecursiveLimited']);
const PER_ISSUE = new Map([
  ['subtasksOf', (n) => (n > VALUE_LIMIT ? 2 : 1)],
  ['hasLinks', () => 1],
  ['hasLinkType', () => 1],
  ['parentsOf', () => 2],
  ['issuesInEpics', () => 2],
  ['linkedIssuesOf', () => 2],
  ['expression', () => 2],
  ['dateCompare', () => 2],
  ['hasSubtasks', () => 2],
  ['addedAfterSprintStart', () => 1],
  ['incompleteInSprint', () => 2],
  ['completeInSprint', () => 2],
  ...[...FAN_OUT].map((name) => [name, () => 2]),
  ...['previousSprint', 'nextSprint', 'removedAfterSprintStart', 'commented', 'lastComment', 'hasComments', 'fileAttached', 'hasAttachments'].map((name) => [name, () => 0]),
]);

/**
 * Points a function is expected to spend on `n` issues (its subquery, or the site's subtasks or links); `floor` marks a lower bound, for a
 * result that fans out, or for a function that reads issues when `n` is unknown (null).
 */
export function estimate(functionName, n) {
  const perIssue = PER_ISSUE.get(functionName);
  if (n === null) return { points: POINTS_OVERHEAD, floor: !perIssue || perIssue(1) > 0 };
  return { points: (perIssue ? perIssue(n) : 2) * n + POINTS_OVERHEAD, floor: !perIssue || FAN_OUT.has(functionName) };
}

/** The most issues a function may read within `points` (by its estimate), so an error can say how far to narrow. */
export function issuesWithin(functionName, points) {
  const room = Math.max(0, points - POINTS_OVERHEAD);
  if (functionName === 'subtasksOf') return Math.max(Math.min(VALUE_LIMIT, room), Math.floor(room / 2) > VALUE_LIMIT ? Math.floor(room / 2) : 0);
  const perIssue = PER_ISSUE.get(functionName)?.(1) ?? 2;
  return perIssue > 0 ? Math.floor(room / perIssue) : null;
}

const SUBQUERY_READERS = new Set(['subtasksOf', 'parentsOf', 'issuesInEpics', 'linkedIssuesOf', 'expression', 'dateCompare', ...FAN_OUT]);

/** The JQL whose approximate count is the `n` of a function's estimate, or null when its cost does not follow a query Jira can count. */
export function countQueryOf(functionName, args) {
  if (SUBQUERY_READERS.has(functionName)) return args.subquery;
  if ((functionName === 'hasLinks' || functionName === 'hasLinkType') && args.linkType) return `issueLinkType = ${quote(args.linkType)}`;
  if (functionName === 'hasSubtasks') return 'issuetype in subTaskIssueTypes()';
  return null;
}

/** Points one group may cost on a site with this hourly cap. */
export function groupLimit(cap) {
  return Math.floor(GROUP_POINTS_SHARE * cap);
}

/** Points a group may cost and still be recomputed on every event. */
export function lightLimit(cap) {
  return Math.floor(LIGHT_GROUP_SHARE * cap);
}

/**
 * Class of a group by its cost `{ points, floor, measured }`: light (every event), medium (heavy lane), over (an error with its numbers) or
 * unknown without a cost; a finished computation (`measured`) may pass the group limit by one request round (POINTS_OVERRUN) before it is
 * over, a lower bound (`floor`) is over once it reaches the group limit.
 */
export function groupClass(cost, cap) {
  if (!cost || cost.points === null || cost.points === undefined) return 'unknown';
  const slack = cost.measured ? POINTS_OVERRUN : 0;
  if (cost.points > groupLimit(cap) + slack || (cost.floor && cost.points >= groupLimit(cap))) return 'over';
  return cost.points > lightLimit(cap) ? 'medium' : 'light';
}

const spentOn = (spentByLane, lane) => spentByLane[lane] ?? 0;
/** The sum of the points of every lane. */
export const totalOf = (byLane) => Object.values(byLane).reduce((sum, n) => sum + n, 0);
const minuteOf = (at) => new Date(at).getUTCMinutes();

const reserveOf = (lane, cap) => Math.floor((LANE_SHARES[lane] ?? 0) * cap);

/**
 * Points a lane may still spend this hour as of `at` (the start of its step): what is left of its own reserve, and from half past also what
 * the hour has left, other lanes than function answers only up to BORROW_CAP_SHARE of the cap; never more than the cap leaves, and for other
 * lanes than function answers never what the function reserve has left.
 */
export function laneRoom(lane, spentByLane, at, cap) {
  const own = reserveOf(lane, cap) - spentOn(spentByLane, lane);
  const total = totalOf(spentByLane);
  const fnLeft = lane === DEFAULT_LANE ? 0 : Math.max(0, reserveOf(DEFAULT_LANE, cap) - spentOn(spentByLane, DEFAULT_LANE));
  const ceiling = cap - total - (minuteOf(at) < BORROW_MINUTE ? 0 : fnLeft);
  if (minuteOf(at) < BORROW_MINUTE) return Math.max(0, Math.min(own, ceiling));
  const borrow = lane === DEFAULT_LANE ? cap - total : Math.floor(BORROW_CAP_SHARE * cap) - total;
  return Math.max(0, Math.min(Math.max(own, borrow), ceiling));
}

/** When a lane refused at `at` may try again: half past the hour before it, else the next hour. */
export function retryAfter(at) {
  return minuteOf(at) < BORROW_MINUTE ? nextHour(at) - HOUR_MS + BORROW_MINUTE * 60 * 1000 : nextHour(at);
}

/** Whether a step of a lane that should cost `cost` may start at `at`: `{ ok: true }`, or `{ waitUntil }`, the instant to try again (half past, or the next hour). */
export function admit(lane, cost, spentByLane, at, cap) {
  if (cost <= laneRoom(lane, spentByLane, at, cap)) return { ok: true };
  return { waitUntil: retryAfter(at) };
}

/** The UTC hour of an instant as `YYYYMMDDHH`. */
export function hourKey(at) {
  return new Date(at).toISOString().slice(0, 13).replace(/[-T]/g, '');
}

/** The start of the UTC hour after an instant (epoch ms). */
export function nextHour(at) {
  return (Math.floor(at / HOUR_MS) + 1) * HOUR_MS;
}

/** Points per hour the app may spend on this site: a positive override, else the cap of the tier (Tier 1 unless 2). */
export function capOf(tier, override) {
  if (Number.isFinite(override) && override > 0) return override;
  return tier === 2 ? SITE_POINTS_TIER2 : SITE_POINTS_TIER1;
}

/** The kinds of work the site's points are split between. */
export const LANES = ['fn', 'index-event', 'refresh', 'heavy', 'reconcile', 'backfill'];

/** The lane a refresh queue message spends from: a deferred function computation the function lane, a heavy run the heavy lane, the rest refresh. */
export function laneOfRefresh(body) {
  if (body?.kind === 'compute') return 'fn';
  if (body?.kind === 'heavy') return 'heavy';
  return 'refresh';
}

/** Seconds between journal passes so that their fixed cost `overhead` (points per pass) takes at most REFRESH_OVERHEAD_SHARE of the hour's refresh reserve. */
export function passInterval(overhead, cap) {
  const seconds = Math.round((3600 * overhead) / (REFRESH_OVERHEAD_SHARE * reserveOf('refresh', cap)));
  return Math.min(PASS_INTERVAL_MAX_S, Math.max(PASS_INTERVAL_MIN_S, seconds));
}
