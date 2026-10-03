import { describe, expect, it } from 'vitest';
import { compare, pct, summary } from '../../scripts/lib/report.mjs';

describe('report', () => {
  it('takes nearest-rank percentiles', () => {
    expect([pct([5, 1, 3, 2, 4], 50), pct([5, 1, 3, 2, 4], 90), pct([], 90)]).toEqual([3, 5, null]);
    expect(summary([1, 2, 3])).toEqual({ n: 3, p50: 2, p90: 3, max: 3 });
  });
  it('counts missing and extra ids against the reference', () => {
    expect(compare(['1', '2', '4'], ['1', '2', '3'])).toEqual({ count: 3, reference: 3, missing: 1, extra: 1, complete: false });
    expect(compare(['2', '1'], ['1', '2'])).toEqual({ count: 2, reference: 2, missing: 0, extra: 0, complete: true });
  });
});
