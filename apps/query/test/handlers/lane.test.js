import { describe, expect, it, vi } from 'vitest';
import { BUDGET_AT, makeDeps, spend, withBudget } from './makeDeps.js';
import { onRefresh, refreshOnce } from '../../src/handlers/refresh.js';
import { handleFunction } from '../../src/handlers/functions.js';
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
    expect(await deps.state.heavy.get(key('a'))).toEqual(entry('a', BUDGET_AT - 2000, { tries: 1, stops: 1, pts: 1900, floor: true, floorAt: BUDGET_AT }));
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, 300]]);
  });
  it('writes the error with its numbers and drops the group when it passes the group limit', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([2000, 1]), at: Date.parse('2026-10-05T07:40:00Z') });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
    expect(deps.written).toEqual([{ id: 'a', error: ERR.tooExpensive('childIssuesOf', { n: null, points: null, limit: 2000 }) }]);
    expect(await deps.state.heavy.get(key('a'))).toBe(null);
  });
  it('warns with the points spent, the limit and the cost it was admitted by when a group passes the group limit', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([2000, 1]), at: Date.parse('2026-10-05T07:40:00Z') });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
    expect(warn.mock.calls).toEqual([['childIssuesOf passed the group limit in the heavy lane: spent 2000 of 2000, admitted at 500 (no known cost)']]);
    warn.mockRestore();
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
});

describe('heavy lane fixes', () => {
  it('keeps what a run the heavy reserve stopped spent as a lower bound and leaves the group while the reserve cannot hold it', async () => {
    const compute = spending([1900, 1]);
    const deps = laneDeps({ queries: ['a'], compute });
    await deps.points.add('heavy', 600);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
    expect(await deps.state.heavy.get(key('a'))).toMatchObject({ pts: 1900, floor: true });
    await deps.points.add('heavy', 1000);
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(compute).toHaveBeenCalledTimes(1);
  });
  it('marks a group it drops for nobody using it, so the reconcile rewrites it once it is used again', async () => {
    const longAgo = new Date(BUDGET_AT - 2 * 24 * 3600000).toISOString();
    const deps = withBudget(makeDeps({ pcs: [{ ...pcOf('a'), used: longAgo }] }));
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(await deps.state.skip.get(key('a'))).toEqual(BUDGET_AT - 2000);
  });
  it('runs a group a failure handed over within a minute, however recently it was written', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([10]) });
    await deps.state.groupWrite.set(key('a'), BUDGET_AT - 5 * 60000);
    await deps.state.heavy.put(entry('a', BUDGET_AT, { retry: true, notBefore: BUDGET_AT + 60000 }));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toEqual({ waiting: BUDGET_AT + 60000 });
    deps.advance(60000);
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toMatchObject({ computed: key('a') });
  });
  it('waits a minute before it runs a failed group again', async () => {
    const deps = laneDeps({ queries: ['a'], compute: vi.fn(async () => { throw Object.assign(new Error('down'), { name: 'JiraError', status: 503 }); }) });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await expect(quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }))).rejects.toThrow('down');
    expect(await deps.state.heavy.get(key('a'))).toMatchObject({ tries: 1, retry: true, notBefore: BUDGET_AT + 60000 });
  });
  it('rewrites without comparing with the meta a group the reconcile handed over', async () => {
    const deps = laneDeps({ queries: ['a'], compute: spending([10]) });
    await deps.cache.write(key('a'), { values: ['3'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'job', lv: 1, posted: true });
    await deps.jira.precomputations().then(() => null);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { force: true }));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(deps.written.map((u) => u.id)).toEqual(['a']);
  });
  it('keeps the skip mark set after the run started', async () => {
    let deps;
    const compute = vi.fn(async () => { await deps.state.skip.set(key('a'), deps.now() + 1); return { ids: ['3'], field: 'parent', watch: ['9'] }; });
    deps = laneDeps({ queries: ['a'], compute });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(await deps.state.skip.get(key('a'))).toEqual(BUDGET_AT + 1);
  });
});

describe('reconcile and failing groups', () => {
  it('logs a failing group, hands it to the lane and still restarts the lane and checks the index', async () => {
    const old = new Date(1000000 - 2 * 3600000).toISOString();
    const pcs = [{ id: 's', functionName: 'previousSprint', arguments: ['B'], value: 'sprint = 1', used: new Date(999000).toISOString(), updated: old }];
    const indexReconcile = vi.fn(async () => 'checked');
    const deps = makeDeps({ pcs, indexReconcile, compute: { previousSprint: async () => { throw Object.assign(new Error('no'), { name: 'JiraError', status: 403 }); } } });
    const result = await quietly(() => onReconcile(deps));
    expect([result.index, (await deps.state.errors())[0].message, (await deps.state.heavy.get('previousSprint["B"]'))?.key]).toEqual(['checked', 'Refresh failed: Jira answered 403', 'previousSprint["B"]']);
  });
  it('hands heavy groups over to be written without comparing with the meta', async () => {
    const old = new Date(1000000 - 25 * 3600000).toISOString();
    const pcs = [{ ...pcOf('a'), used: new Date(999000).toISOString(), updated: old }];
    const deps = makeDeps({ pcs });
    await deps.cache.write(key('a'), { values: ['1'], watch: [], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: 60000 });
    await onReconcile(deps);
    expect(await deps.state.heavy.get(key('a'))).toMatchObject({ force: true });
  });
});

describe('a failure in a pass', () => {
  it('marks the group for the reconcile and hands it to the lane for a retry after a minute', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: new Date(999000).toISOString() }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => { throw Object.assign(new Error('down'), { name: 'JiraError', status: 503 }); } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await quietly(() => refreshOnce(deps));
    expect([await deps.state.skip.get('hasSubtasks[]'), await deps.state.heavy.get('hasSubtasks[]')]).toEqual([1000000, expect.objectContaining({ retry: true, notBefore: 1060000 })]);
  });
});

describe('a function answer and the group meta', () => {
  it('takes the posted mark off the meta of the group whose precomputation Jira creates', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['3'], watch: [], field: 'id', rootFilter: null, at: 1000000, source: 'job', lv: 1, posted: true });
    await handleFunction(deps, 'parentsOf', { precomputationId: 'n1', clause: { field: 'issue', operator: 'not in', arguments: ['q'] } }, { environmentType: 'DEVELOPMENT' });
    expect((await deps.cache.meta('parentsOf["q"]')).posted).toBeUndefined();
  });
});

describe('heavy lane, second round', () => {
  it('marks a group three failures dropped from the lane and wakes the lane for each retry', async () => {
    const deps = laneDeps({ queries: ['a'], compute: vi.fn(async () => { throw Object.assign(new Error('down'), { name: 'JiraError', status: 503 }); }) });
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000));
    for (let i = 0; i < 3; i += 1) {
      await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }).catch(() => null));
      deps.advance(61000);
    }
    expect([await deps.state.heavy.get(key('a')), await deps.state.skip.get(key('a'))]).toEqual([null, BUDGET_AT - 2000]);
    expect(deps.pushed.filter(([body]) => body.kind === 'wake').length).toBeGreaterThan(0);
  });
  it('takes the lower bound a stop left over the cost of the last finished run', async () => {
    const compute = spending([10]);
    const deps = laneDeps({ queries: ['a'], compute });
    await deps.cache.write(key('a'), { values: ['3'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'job', pts: 300 });
    await deps.points.add('heavy', 2000);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { pts: 700, floor: true, stops: 1 }));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toEqual({ waiting: Date.parse('2026-10-05T07:30:00Z') });
    expect(compute).not.toHaveBeenCalled();
  });
  it('leaves a failed light group waiting while the heavy reserve is spent, instead of a run stopped at once', async () => {
    const compute = spending([10]);
    const deps = laneDeps({ queries: ['a'], compute });
    await deps.cache.write(key('a'), { values: ['3'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'job', pts: 100 });
    await deps.points.add('heavy', 2500);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { retry: true }));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toEqual({ waiting: Date.parse('2026-10-05T07:30:00Z') });
    expect(compute).not.toHaveBeenCalled();
  });
  it('trusts a finished run over a lower bound that a stop left before it', async () => {
    const compute = spending([10]);
    const deps = laneDeps({ queries: ['a'], compute });
    await deps.cache.write(key('a'), { values: ['3'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'job', pts: 300, startedAt: BUDGET_AT - 1000 });
    await deps.points.add('heavy', 2000);
    await deps.state.heavy.put(entry('a', BUDGET_AT - 2000, { pts: 700, floor: true, floorAt: BUDGET_AT - 5000 }));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy).toMatchObject({ computed: key('a') });
  });
});
