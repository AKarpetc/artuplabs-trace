/** Comparator of numeric id strings. */
export const byNumber = (a, b) => Number(a) - Number(b);

/** Distinct ids as strings, in ascending numeric order. */
export function sortIds(ids) {
  return [...new Set([...ids].map(String))].sort(byNumber);
}
