import { describe, expect, it, vi } from 'vitest';
import { BUDGET_AT, makeDeps, spend, withBudget } from './makeDeps.js';
import { onRefresh } from '../../src/handlers/refresh.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { ERR } from '../../src/core/errors.js';
import { HEAVY_MIN_INTERVAL_MS, HEAVY_WAIT_MAX_MS } from '../../src/core/limits.js';

const USED = new Date(BUDGET_AT - 1000).toISOString();
const HALF = Date.parse('2026-10-05T07:30:00Z');
const key = (q) => `childIssuesOf[${JSON.stringify(q)}]`;
const pcOf = (q) => ({ id: q, functionName: 'childIssuesOf', arguments: [q], operator: 'in', value: 'parent in (1)', used: USED });
const entry = (q, at, extra = {}) => ({ key: key(q), functionName: 'childIssuesOf', userArgs: [q], at, since: at, ...extra });
const spending = (list) => vi.fn(async () => {
  for (const n of list) await spend(n);
  return { ids: ['3'], field: 'parent', watch: ['9'] };
});
const quietly = async (task) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await task();
  } finally {
    error.mockRestore();
  }
};
const rateLimit = (retryAt) => Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429, retryAt });

function laneDeps({ queries = ['a', 'b'], compute, at, cap } = {}) {
  return withBudget(makeDeps({ pcs: queries.map(pcOf), compute: { childIssuesOf: compute } }), { at, cap });
}

describe('heavy lane under the points budget', () => {
  it('takes the first waiting group whose cost fits what the heavy reserve has left', async () => {
    const compute = spending([50]);
    const deps = laneDeps({ compute });
    await deps.points.add('heavy', 2400);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { pts: 1500 }));
    await deps.state.heavy.put(entry('b', BUDGET_AT - 1000, { pts: 90 }));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toMatchObject({ computed: key('b') });
    expect([(await deps.state.heavy.get(key('a')))?.key, await deps.state.heavy.get(key('b'))]).toEqual([key('a'), null]);
  });
  it('waits for half past, without computing, when no waiting group fits', async () => {
    const compute = spending([50]);
    const deps = laneDeps({ compute });
    await deps.points.add('heavy', 2400);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { pts: 1500 }));
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ heavy: { waiting: HALF } });
    expect([compute.mock.calls.length, deps.pushed]).toEqual([0, [[{ kind: 'wake' }, 300]]]);
  });
  it('leaves a group its last write left within the hour and runs the next', async () => {
    const compute = spending([50]);
    const deps = laneDeps({ compute });
    await deps.state.groupWrite.set(key('a'), BUDGET_AT - 10 * 60000);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await deps.state.heavy.put(entry('b', BUDGET_AT - 1000));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toMatchObject({ computed: key('b') });
  });
  it('waits until the hour after the last write when that is the only group', async () => {
    const deps = laneDeps({ compute: spending([50]) });
    await deps.state.groupWrite.set(key('a'), BUDGET_AT - 50 * 60000);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ heavy: { waiting: BUDGET_AT - 50 * 60000 + HEAVY_MIN_INTERVAL_MS } });
  });
  it('puts a group the heavy reserve stopped back as it was, without counting a try', async () => {
    const deps = laneDeps({ compute: spending([1900, 1]) });
    await deps.points.add('heavy', 600);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { tries: 1 }));
    expect((await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }))).heavy).toMatchObject({ computed: key('a'), stopped: 'lane' });
    expect(await deps.state.heavy.get(key('a'))).toEqual(entry('a', BUDGET_AT - 2000, { tries: 1, stops: 1 }));
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, 300]]);
  });
  it('writes the error with its numbers and drops the group when it passes the group limit', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([2000, 1]), at: Date.parse('2026-10-05T07:40:00Z') });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
    expect(deps.written).toEqual([{ id: 'a', error: ERR.tooExpensive('childIssuesOf', { n: null, points: null, limit: 2000 }) }]);
    expect(await deps.state.heavy.get(key('a'))).toBe(null);
  });
  it('gives a group that waited too long the error with its numbers and drops it without computing', async () => {
    const compute = spending([50]);
    const deps = laneDeps({ queries: ['a'], compute });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 1000, { since: BUDGET_AT - HEAVY_WAIT_MAX_MS, pts: 1700 }));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(compute).not.toHaveBeenCalled();
    expect(deps.written).toEqual([{ id: 'a', error: ERR.waited('childIssuesOf', { hours: 6, points: 1700, perFunction: 2000, perHour: 10000, issues: 240 }) }]);
    expect(await deps.state.heavy.get(key('a'))).toBe(null);
  });
  it('reads the precomputation list once per run', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([50]) });
    deps.pcList = null;
    const list = deps.jira.precomputations;
    deps.jira.precomputations = vi.fn(list);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(deps.jira.precomputations).toHaveBeenCalledTimes(1);
  });
  it('clears the skip mark of a group it wrote', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([50]) });
    await deps.state.skip.set(key('a'), BUDGET_AT - 5000);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(await deps.state.skip.get(key('a'))).toBe(null);
  });
});

describe('heavy lane and the rate limit', () => {
  it('puts a group a 429 stopped back as it was, without counting a try', async () => {
    const deps = makeDeps({ pcs: [pcOf('a')], compute: { childIssuesOf: async () => { throw rateLimit(null); } } });
    await deps.state.heavy.put(entry('a', 990000, { tries: 2 }));
    await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
    expect(await deps.state.heavy.get(key('a'))).toEqual(entry('a', 990000, { tries: 2, stops: 1 }));
  });
});

describe('reconcile and the heavy lane', () => {
  it('hands a group whose precomputation waited too long to the lane, so it gets its value', async () => {
    const waited = ERR.waited('childIssuesOf', { hours: 6, points: 1700, perFunction: 2000, perHour: 10000, issues: 240 });
    const pcs = [{ ...pcOf('a'), value: undefined, error: waited, used: new Date(999000).toISOString(), updated: new Date(990000).toISOString() }];
    const deps = makeDeps({ pcs, compute: { childIssuesOf: spending([1]) } });
    await deps.cache.write(key('a'), { values: ['1'], watch: [], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: 60000 });
    await onReconcile(deps);
    expect((await deps.state.heavy.get(key('a')))?.key).toEqual(key('a'));
  });
  it('does not hand a heavy group the lane stopped twice again within a day', async () => {
    const pcs = [{ ...pcOf('a'), value: 'parent in (1)', error: 'Computing, retry in a minute', used: new Date(999000).toISOString(), updated: new Date(990000).toISOString() }];
    const deps = makeDeps({ pcs, compute: { childIssuesOf: spending([1]) } });
    await deps.cache.write(key('a'), { values: ['1'], watch: [], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: 60000 });
    const stopped = { ...entry('a', 1000000 - 40 * 60000), stops: 2 };
    await deps.state.heavy.put(stopped);
    await onReconcile(deps);
    expect(await deps.state.heavy.get(key('a'))).toEqual(stopped);
  });
});
