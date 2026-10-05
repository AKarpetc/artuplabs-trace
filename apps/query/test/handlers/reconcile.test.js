import { describe, expect, it, vi } from 'vitest';
import { BUDGET_AT, makeDeps, RECENT, spend, withBudget } from './makeDeps.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { HEAVY_RECONCILE_MS, INDEX_CHECK_MIN_POINTS, REFRESH_GROUP_BUDGET_MS } from '../../src/core/limits.js';

const old = new Date(1000000 - 2 * 3600000).toISOString();

describe('onReconcile', () => {
  it('goes on when deleting the past points ledger keys fails, and logs it without values', async () => {
    const deps = makeDeps({ points: { prune: async () => { throw new Error('kvs down'); } } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await onReconcile(deps)).toEqual({ groups: 0, changed: 0, index: null });
    expect(error.mock.calls).toEqual([['points ledger prune failed: Error']]);
    error.mockRestore();
  });
  it('deletes the points ledger keys of past hours, also while the background waits for the rate limit', async () => {
    const prune = vi.fn(async () => 0);
    const deps = makeDeps({ points: { prune } });
    await deps.state.brake.set(2000000);
    expect(await onReconcile(deps)).toEqual({ braked: 2000000 });
    expect(prune).toHaveBeenCalledTimes(1);
  });
  it('rewrites used groups that were not rewritten for an hour', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    expect(await onReconcile(deps)).toEqual({ groups: 1, changed: 1, index: null });
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
  });
  it('rewrites a not in precomputation with the complement', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], operator: 'not in', value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await onReconcile(deps);
    expect(deps.written).toEqual([{ id: 'h', value: 'NOT (id in (2))' }]);
  });
  it('does not overwrite a refresh that started after it', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.lastWrittenStart.set(2000000);
    expect((await onReconcile(deps)).changed).toBe(0);
  });
  it('leaves a precomputation Jira has not used yet', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', updated: old }];
    const compute = { hasSubtasks: vi.fn() };
    const deps = makeDeps({ pcs, compute });
    expect(await onReconcile(deps)).toEqual({ groups: 0, changed: 0, index: null });
    expect(compute.hasSubtasks).not.toHaveBeenCalled();
  });
  it('hands a group that runs out of time to the heavy lane', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => { throw Object.assign(new Error('late'), { name: 'DeadlineError' }); } } });
    expect(await onReconcile(deps)).toEqual({ groups: 1, changed: 0, index: null });
    expect([(await deps.state.heavy.get('hasSubtasks[]')).functionName, deps.pushed]).toEqual(['hasSubtasks', [[{ kind: 'heavy' }, null]]]);
  });
  it('pushes the heavy runner once for several slow groups', async () => {
    const pcs = [
      { id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old },
      { id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', used: RECENT, updated: old },
    ];
    const late = async () => { throw Object.assign(new Error('late'), { name: 'DeadlineError' }); };
    const deps = makeDeps({ pcs, compute: { hasSubtasks: late, childIssuesOf: late } });
    await onReconcile(deps);
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
  });
  it('restarts the heavy lane when groups wait in it', async () => {
    const deps = makeDeps();
    await deps.state.heavy.put({ key: 'hasSubtasks[]', functionName: 'hasSubtasks', userArgs: [], at: 1 });
    await onReconcile(deps);
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
  });
  it('reports the index pass', async () => {
    const deps = makeDeps({ indexReconcile: async () => ({ started: ['sprint'] }) });
    expect(await onReconcile(deps)).toEqual({ groups: 0, changed: 0, index: { started: ['sprint'] } });
  });
  it('hands a group known to be slow to the heavy lane only once it was not rewritten for the heavy reconcile period', async () => {
    const slow = { values: ['1'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'refresh', ms: REFRESH_GROUP_BUDGET_MS };
    const handed = async (updated) => {
      const pcs = [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', used: RECENT, updated }];
      const childIssuesOf = vi.fn();
      const deps = makeDeps({ pcs, compute: { childIssuesOf } });
      await deps.cache.write('childIssuesOf["q"]', slow);
      await onReconcile(deps);
      return [childIssuesOf.mock.calls.length, Boolean(await deps.state.heavy.get('childIssuesOf["q"]'))];
    };
    expect(await handed(old)).toEqual([0, false]);
    expect(await handed(new Date(1000000 - HEAVY_RECONCILE_MS).toISOString())).toEqual([0, true]);
  });
  it('pushes a refresh for journal rows no refresh is pending for, so a lost wake delays them an hour at most', async () => {
    const deps = makeDeps();
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await onReconcile(deps);
    expect(deps.pushed).toEqual([[{ kind: 'refresh', ts: 1000000 }, null]]);
  });
  it('leaves a pending refresh to run the journal', async () => {
    const deps = makeDeps();
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await deps.state.pending.set(999900);
    await onReconcile(deps);
    expect(deps.pushed).toEqual([]);
  });
});

describe('onReconcile with skipped groups, the journal and its points', () => {
  const recent = new Date(1000000 - 10 * 60000).toISOString();
  const usedNow = new Date(1000000 - 60000).toISOString();
  const rateLimit = Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429, retryAt: null });
  it('rewrites a group used after a pass skipped it, however recently it was rewritten, and clears the mark', async () => {
    const pcs = [{ id: 'p', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: usedNow, updated: recent }];
    const deps = makeDeps({ pcs, compute: { parentsOf: async () => ({ ids: ['2'], field: 'id', watch: [] }) } });
    await deps.state.skip.set('parentsOf["q"]', 1000000 - 5 * 60000);
    await onReconcile(deps);
    expect([deps.written, await deps.state.skip.get('parentsOf["q"]')]).toEqual([[{ id: 'p', value: 'id in (2)' }], null]);
  });
  it('hands a heavy group used after a pass skipped it to the lane at once', async () => {
    const pcs = [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'id in (1)', used: usedNow, updated: recent }];
    const deps = makeDeps({ pcs });
    await deps.cache.write('childIssuesOf["q"]', { values: ['1'], watch: [], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: 60000 });
    await deps.state.skip.set('childIssuesOf["q"]', 1000000 - 5 * 60000);
    await onReconcile(deps);
    expect((await deps.state.heavy.get('childIssuesOf["q"]'))?.key).toEqual('childIssuesOf["q"]');
  });
  it('restarts an idle journal before it rewrites any group', async () => {
    const old = new Date(1000000 - 2 * 3600000).toISOString();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: usedNow, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => { throw rateLimit; } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 1000);
    expect(await onReconcile(deps)).toEqual({ braked: true });
    expect(deps.pushed[0]).toEqual([{ kind: 'refresh', ts: 1000000 }, null]);
  });
  it('rewrites nothing, yet restarts the lane and the journal, once its points are spent', async () => {
    const old = new Date(BUDGET_AT - 2 * 3600000).toISOString();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: new Date(BUDGET_AT - 60000).toISOString(), updated: old }];
    const hasSubtasks = vi.fn();
    const deps = withBudget(makeDeps({ pcs, compute: { hasSubtasks } }));
    deps.jira.precomputations = vi.fn(deps.jira.precomputations);
    await deps.points.add('reconcile', 1000);
    await deps.state.heavy.put({ key: 'x', functionName: 'childIssuesOf', userArgs: ['x'], at: 1 });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 1000);
    const result = await onReconcile(deps);
    expect([hasSubtasks.mock.calls.length, deps.jira.precomputations.mock.calls.length, result.groups]).toEqual([0, 0, 0]);
    expect(deps.pushed.map(([body]) => body.kind).sort()).toEqual(['heavy', 'refresh']);
  });
  it('hands a group that passes the light limit to the lane with what it spent as a lower bound', async () => {
    const old = new Date(BUDGET_AT - 2 * 3600000).toISOString();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: new Date(BUDGET_AT - 60000).toISOString(), updated: old }];
    const deps = withBudget(makeDeps({ pcs, compute: { hasSubtasks: async () => { await spend(499); await spend(2); await spend(1); return { ids: ['2'], field: 'id', watch: null }; } } }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onReconcile(deps);
    error.mockRestore();
    expect(await deps.state.heavy.get('hasSubtasks[]')).toMatchObject({ pts: 501, floor: true });
  });
  it('checks the index within what the reconcile points have left', async () => {
    const deps = withBudget(makeDeps({ pcs: [] }));
    deps.indexReconcile = async () => deps.currentPoints();
    await deps.points.add('reconcile', 400);
    expect((await onReconcile(deps)).index).toMatchObject({ scope: 'pass', limit: 600 });
  });
  it('keeps a skip mark set after it started', async () => {
    const recent2 = new Date(1000000 - 10 * 60000).toISOString();
    const pcs = [{ id: 'p', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: new Date(1000000 - 60000).toISOString(), updated: recent2 }];
    let deps;
    deps = makeDeps({ pcs, compute: { parentsOf: async () => { await deps.state.skip.set('parentsOf["q"]', 1000001); return { ids: ['2'], field: 'id', watch: [] }; } } });
    await deps.state.skip.set('parentsOf["q"]', 1000000 - 5 * 60000);
    await onReconcile(deps);
    expect(await deps.state.skip.get('parentsOf["q"]')).toEqual(1000001);
  });
  it('leaves the index check its minimum however much the groups spend', async () => {
    const old = new Date(BUDGET_AT - 2 * 3600000).toISOString();
    const used = new Date(BUDGET_AT - 60000).toISOString();
    const pcs = ['a', 'b', 'c'].map((q) => ({ id: q, functionName: 'parentsOf', arguments: [q], value: 'id in (1)', used, updated: old }));
    const deps = withBudget(makeDeps({ pcs, compute: { parentsOf: async () => { await spend(400); return { ids: ['2'], field: 'id', watch: [] }; } } }), { cap: 9000 });
    deps.indexReconcile = async () => deps.currentPoints();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { index } = await onReconcile(deps);
    error.mockRestore();
    expect(index.limit).toBeGreaterThanOrEqual(INDEX_CHECK_MIN_POINTS);
  });
});
