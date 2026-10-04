import { EXPRESSION_SNIPPET } from './limits.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
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
  refreshFailed: (status) => (status ? `Refresh failed: Jira answered ${status}` : 'Refresh failed'),
  indexRefreshNotQueued: () => 'Refresh after the index build was not queued',
  indexFailed: (status) => (status ? `Index write failed: Jira answered ${status}` : 'Index write failed'),
  invalidConditions: () => 'Invalid conditions',
  invalidExpression: () => 'Invalid expression',
  commentIndexNotShipped: () => 'Comment index not shipped',
};

/** Errors that quote an argument value: the editor text with the value, the log text without it. */
export const FAIL = {
  notFound: (what, value) => ({ error: ERR.notFound(what, value), log: LOG.notFound(what) }),
  ambiguous: (what, value, count) => ({ error: ERR.ambiguous(what, value, count), log: LOG.ambiguous(what) }),
  excluded: (key) => ({ error: ERR.excluded(key), log: LOG.excluded() }),
};
