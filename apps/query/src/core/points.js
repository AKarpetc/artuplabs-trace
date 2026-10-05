import { CHANGELOG_POINT_FACTOR, COMMENT_POINT_FACTOR, POINTS_OVERHEAD, SITE_POINTS_TIER1, SITE_POINTS_TIER2, VALUE_LIMIT } from './limits.js';

const HOUR_MS = 60 * 60 * 1000;

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
  ['addedAfterSprintStart', () => 2],
  ['incompleteInSprint', () => 2],
  ['completeInSprint', () => 2],
  ...[...FAN_OUT].map((name) => [name, () => 2]),
  ...['previousSprint', 'nextSprint', 'removedAfterSprintStart', 'commented', 'lastComment', 'hasComments', 'fileAttached', 'hasAttachments'].map((name) => [name, () => 0]),
]);

/** Points a function is expected to spend on `n` issues (its subquery, or the site's subtasks or links); `floor` marks a lower bound, for a result that fans out. */
export function estimate(functionName, n) {
  const perIssue = PER_ISSUE.get(functionName);
  return { points: (perIssue ? perIssue(n) : 2) * n + POINTS_OVERHEAD, floor: !perIssue || FAN_OUT.has(functionName) };
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
