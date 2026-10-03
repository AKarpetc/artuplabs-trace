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
