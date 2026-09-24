import { describe, it, expect } from 'vitest';
import { coverageSummary } from '../../src/core/coverage';

describe('coverageSummary', () => {
  it('computes percent with one decimal', () => {
    expect(coverageSummary(3, 2)).toEqual({ total: 3, covered: 2, uncovered: 1, percent: 66.7 });
  });

  it('coverage of empty set reports percent null', () => {
    expect(coverageSummary(0, 0)).toEqual({ total: 0, covered: 0, uncovered: 0, percent: null });
  });

  it('full coverage is 100', () => {
    expect(coverageSummary(5, 5).percent).toBe(100);
  });
});
