import { describe, expect, it } from 'vitest';
import { latencyResult } from '../../scripts/lib/latency.mjs';

describe('latencyResult', () => {
  it('counts a change not seen within the limit as a timeout, apart from the seconds', () => {
    const result = latencyResult({ a: [1, null, 3], b: [2] }, Date.now());
    expect([result.summary, result.overall]).toEqual([
      { a: { n: 2, p50: 1, p90: 3, max: 3, timeouts: 1 }, b: { n: 1, p50: 2, p90: 2, max: 2, timeouts: 0 } },
      { n: 3, p50: 2, p90: 3, max: 3, timeouts: 1 },
    ]);
  });
});
