import { describe, expect, it, vi } from 'vitest';
import { makeDeps, RECENT } from './makeDeps.js';
import { onReconcile } from '../../src/handlers/reconcile.js';

const old = new Date(1000000 - 2 * 3600000).toISOString();

describe('onReconcile', () => {
  it('rewrites used groups that were not rewritten for an hour', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    expect(await onReconcile(deps)).toEqual({ groups: 1, changed: 1, index: null });
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
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
  it('reports the index pass', async () => {
    const deps = makeDeps({ indexReconcile: async () => ({ started: ['sprint'] }) });
    expect(await onReconcile(deps)).toEqual({ groups: 0, changed: 0, index: { started: ['sprint'] } });
  });
});
