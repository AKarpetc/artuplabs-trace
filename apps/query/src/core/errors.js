import { takesSubquery } from './catalog.js';
import { EXPRESSION_SNIPPET } from './limits.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const RATE_NOTE = "Jira's rate limit for apps";
const utcTime = (at) => new Date(at).toISOString().slice(11, 16);
const TOO_EXPENSIVE = / Jira API points; on this site ArtUp Query may spend at most [\d,]+ on one function \(/;

/** Whether a stored precomputation error is the too-expensive error of the Jira points budget. */
export const isTooExpensiveError = (text) => typeof text === 'string' && TOO_EXPENSIVE.test(text);

function tooExpensive(functionName, { n, points, limit, issues, floor = false }) {
  const cap = `on this site ArtUp Query may spend at most ${fmt(limit)} on one function (${RATE_NOTE}).`;
  const need = points === null || points === undefined ? `needs more than ${fmt(limit)} Jira API points` : `needs ${floor ? 'at least' : 'about'} ${fmt(points)} Jira API points`;
  if (n === null || n === undefined) return `${functionName}: the result ${need}; ${cap}${takesSubquery(functionName) ? ' Narrow the subquery.' : ''}`;
  if (!takesSubquery(functionName)) return `${functionName}: the site has about ${fmt(n)} matching issues and ${need}; ${cap}`;
  return `${functionName}: the subquery has about ${fmt(n)} issues and ${need}; ${cap} Narrow the subquery to about ${fmt(issues)} issues.`;
}

const clip = (text) => (text.length > EXPRESSION_SNIPPET ? `${text.slice(0, EXPRESSION_SNIPPET)}…` : text);

/** English messages for the JQL editor; Jira passes no locale to a JQL function. */
export const ERR = {
  unlicensed: () => 'ArtUp Query license is not active',
  computing: () => 'Computing, retry in a minute',
  indexBuilding: (done, total) => `Index is building: ${fmt(done)} of ${fmt(total)} issues`,
  notFound: (what, value) => `${what} "${value}" not found`,
  ambiguous: (what, value, count) => `${what} "${value}" matches ${count} items; use its id`,
  tooMany: (count, capacity) => `The result needs ${fmt(count)} issues; one function returns at most ${fmt(capacity)}. Narrow the subquery.`,
  excluded: (key) => `Project ${key} is excluded from the ArtUp Query index`,
  perUser: (word) => `${word} is not supported: results are shared by all users`,
  subqueryRejected: () => 'Subquery rejected by Jira',
  withFunction: (functionName, message) => `${functionName}: ${message}`,
  expressionEnd: () => 'Unexpected end of expression',
  expressionUnexpected: (text, at) => `Unexpected "${clip(String(text))}" at ${at}`,
  expressionParen: () => 'Missing ")"',
  expressionNotCompared: () => 'The expression must compare values, such as a > b',
  expressionArithmetic: () => 'Cannot do arithmetic on a comparison',
  expressionTooLong: (max) => `The expression is longer than ${fmt(max)} characters`,
  expressionTooDeep: (max) => `The expression is nested deeper than ${fmt(max)} levels`,
  invalidDate: (text) => `Invalid date "${clip(String(text))}"`,
  unclosedQuote: (text) => `Unclosed quote in "${clip(String(text))}"`,
  unknownClause: (word, allowed) => `Unknown clause "${clip(String(word))}"; use ${allowed.join(', ')}`,
  clauseNeedsValue: (name) => `Clause "${name}" needs a value`,
  clauseTwice: (name) => `Clause "${name}" is given twice`,
  clausesTooLong: (max) => `Conditions are longer than ${fmt(max)} characters`,
  clauseNotYet: (name) => `Clause "${name}" is not available yet`,
  extensionDot: (name) => `${name} takes the part after the last dot, such as gz`,
  tooExpensive,
  allowanceUsed: (retryAt) => `ArtUp Query has used this site's Jira API allowance for this hour; retry after ${utcTime(retryAt)} UTC.`,
  needsCommentIndex: (field) => `${field} needs the comment index, which this site does not have`,
};

/** Value-free texts for the error log: the log never stores argument values (board, sprint, link type names, project keys). */
export const LOG = {
  severalLinkTypes: () => 'Several link types',
  notFound: (what) => `${what} not found`,
  ambiguous: (what) => `${what} is ambiguous`,
  excluded: () => 'Project is excluded',
  rejected: () => 'Function call rejected',
  refreshTimedOut: () => 'Refresh ran out of time',
  rateLimited: () => 'Stopped by the Jira rate limit',
  refreshFailed: (status) => (status ? `Refresh failed: Jira answered ${status}` : 'Refresh failed'),
  indexRefreshNotQueued: () => 'Refresh after the index build was not queued',
  indexFailed: (status) => (status ? `Index write failed: Jira answered ${status}` : 'Index write failed'),
  invalidConditions: () => 'Invalid conditions',
  invalidExpression: () => 'Invalid expression',
  commentIndexNotShipped: () => 'Comment index not shipped',
  tooExpensive: () => 'Too expensive for the Jira rate limit',
  allowanceUsed: () => 'Hourly Jira allowance used',
};

/** Errors that quote an argument value: the editor text with the value, the log text without it. */
export const FAIL = {
  notFound: (what, value) => ({ error: ERR.notFound(what, value), log: LOG.notFound(what) }),
  ambiguous: (what, value, count) => ({ error: ERR.ambiguous(what, value, count), log: LOG.ambiguous(what) }),
  excluded: (key) => ({ error: ERR.excluded(key), log: LOG.excluded() }),
};

/** Codes a resolver of the app pages throws; the page maps each to its own message, anything else becomes `internal`. */
export const CODE = {
  unlicensed: 'unlicensed',
  forbidden: 'forbidden',
  badRequest: 'bad-request',
  notFound: 'not-found',
  busy: 'busy',
  internal: 'internal',
};
