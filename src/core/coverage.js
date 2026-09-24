/** Coverage numbers for display; percent is null when there are no requirements. */
export function coverageSummary(total, covered) {
  const percent = total === 0 ? null : Math.round((covered / total) * 1000) / 10;
  return { total, covered, uncovered: total - covered, percent };
}
