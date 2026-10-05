import { describe, expect, it } from 'vitest';
import { distinctSubquery, idSlices, loadPlan, progressOf } from '../../scripts/lib/budget.mjs';

describe('distinctSubquery', () => {
  it('gives each index its own text over the same issues', () => {
    expect([distinctSubquery('project = JQLG', 0), distinctSubquery('project = JQLG', 7)]).toEqual([
      'project = JQLG AND updated >= -10000000m',
      'project = JQLG AND updated >= -10000007m',
    ]);
  });
});

describe('idSlices', () => {
  it('cuts sorted ids into id ranges of at most the given size', () => {
    expect(idSlices(['5', '1', '3', '10', '7'], 2)).toEqual([{ from: '1', to: '3' }, { from: '5', to: '7' }, { from: '10', to: '10' }]);
  });
});

describe('loadPlan', () => {
  it('spreads the calls a points target needs evenly over the minutes, by the estimate of each function', () => {
    expect([loadPlan({ fn: 'subtasksOf', n: 1000, points: 52000, minutes: 60 }), loadPlan({ fn: 'expression', n: 500, points: 10200, minutes: 30 })]).toEqual([
      { cost: 1030, calls: 51, intervalMs: 70588 },
      { cost: 1020, calls: 10, intervalMs: 180000 },
    ]);
  });
  it('refuses a function it has no estimate for', () => {
    expect(() => loadPlan({ fn: 'hasLinks', n: 10, points: 100, minutes: 1 })).toThrow('load-hour supports subtasksOf, expression');
  });
});

describe('progressOf', () => {
  it('reads done and total from the index-building error, without thousands separators', () => {
    expect([progressOf('Index is building: 1,584 of 50,384 issues'), progressOf('Computing, retry in a minute'), progressOf(null)]).toEqual([{ done: 1584, total: 50384 }, null, null]);
  });
});
