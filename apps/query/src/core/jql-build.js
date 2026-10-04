import { pageToken } from './args.js';

/** JQL that matches no issue. */
export const EMPTY = 'id = -1';

/** A JQL string literal. */
export function quote(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `issue in fn("arg", …, "__aq:l2")`: the call of one tree page with the user's arguments repeated. */
export function pageCall(functionName, userArgs, page) {
  return `issue in ${functionName}(${[...userArgs, pageToken(page)].map(quote).join(', ')})`;
}

/** Whether a clause or precomputation operator is `not in`, whatever its case or separator. */
export function isNotIn(operator) {
  return String(operator ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'notin';
}

/**
 * Stored JQL of a clause with its operator: `not in` gets the complement of the function's result, so an empty result means every issue.
 * It never names a project: excluded projects are left out of the result before, by the app.
 */
export function forOperator(jql, operator) {
  return isNotIn(operator) ? `NOT (${jql})` : jql;
}
