const WINDOW_MINUTES = 10000000;
const COST = { subtasksOf: (n) => n + 20, expression: (n) => 2 * n + 20 };

/** The same issues as `base` under a text of its own for index `i` (an `updated` window wider than any site's history). */
export const distinctSubquery = (base, i) => `${base} AND updated >= -${WINDOW_MINUTES + i}m`;

/** Sorted ids cut into id ranges of at most `size` issues. */
export function idSlices(ids, size) {
  const sorted = [...ids].map(Number).sort((a, b) => a - b).map(String);
  const out = [];
  for (let i = 0; i < sorted.length; i += size) {
    const part = sorted.slice(i, i + size);
    out.push({ from: part[0], to: part[part.length - 1] });
  }
  return out;
}

/** Calls of `fn` over `n` issues that spend `points` (by the app's estimate) spread evenly over `minutes`. */
export function loadPlan({ fn, n, points, minutes }) {
  if (!COST[fn]) throw new Error(`load-hour supports ${Object.keys(COST).join(', ')}`);
  const cost = COST[fn](n);
  const calls = Math.ceil(points / cost);
  return { cost, calls, intervalMs: Math.floor((minutes * 60000) / calls) };
}

/** Done and total issues of an "Index is building" error, or null for any other text. */
export function progressOf(message) {
  const m = /Index is building: ([\d,]+) of ([\d,]+) issues/.exec(String(message ?? ''));
  return m ? { done: Number(m[1].replace(/,/g, '')), total: Number(m[2].replace(/,/g, '')) } : null;
}
