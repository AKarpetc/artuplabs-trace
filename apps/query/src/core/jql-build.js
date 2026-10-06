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

/** The query without the ORDER BY clause that ends it (one inside a quoted text stays), so it can be wrapped or ordered anew. */
export function withoutOrder(jql) {
  const text = String(jql);
  let quoted = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i += 1;
      else if (c === quoted) quoted = null;
    } else if (c === '"' || c === "'") quoted = c;
    else if ((i === 0 || /\s/.test(c)) && /^\s*order\s+by\s/i.test(text.slice(i))) return text.slice(0, i);
  }
  return text;
}
