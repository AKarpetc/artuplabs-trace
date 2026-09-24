/** Coverage numbers for display; percent is null when there are no requirements and never 100 while one is uncovered. */
export function coverageSummary(total, covered) {
  const rounded = total === 0 ? null : Math.round((covered / total) * 1000) / 10;
  const percent = rounded !== null && covered < total ? Math.min(rounded, 99.9) : rounded;
  return { total, covered, uncovered: total - covered, percent };
}
