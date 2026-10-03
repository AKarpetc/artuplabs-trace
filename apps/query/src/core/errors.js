const fmt = (n) => Number(n).toLocaleString('en-US');

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
};
