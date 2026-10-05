import { describe, expect, it, vi } from 'vitest';
import { makeDeps, RECENT } from './makeDeps.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { HEAVY_RECONCILE_MS, REFRESH_GROUP_BUDGET_MS } from '../../src/core/limits.js';

const old = new Date(1000000 - 2 * 3600000).toISOString();

describe('onReconcile', () => {
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
