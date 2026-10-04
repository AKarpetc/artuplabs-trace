import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { onLifecycle } from '../../src/handlers/lifecycle.js';

describe('onLifecycle', () => {
  it('migrates and starts only the parts that were never built', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.progress.setPart('comments', { readyAt: 1 });
    const deps = {
      state, migrate: vi.fn(async () => {}), shippedParts: () => ['sprint', 'comments'], now: () => 9,
      jira: { projects: async () => [], approximateCount: async () => 0 },
      indexParts: { sprint: { prepare: async () => {} }, comments: { prepare: async () => {} } },
      backfillQueue: { push: vi.fn(async () => {}) },
    };
    expect(await onLifecycle(deps)).toEqual({ started: ['sprint'] });
    expect(deps.migrate).toHaveBeenCalled();
    expect(deps.backfillQueue.push.mock.calls).toEqual([[{ kind: 'backfill', part: 'sprint', generation: 9 }]]);
  });
  it('only migrates while no index part is shipped', async () => {
    const deps = { migrate: vi.fn(async () => {}), shippedParts: () => [] };
    expect(await onLifecycle(deps)).toEqual({ started: [] });
    expect(deps.migrate).toHaveBeenCalledTimes(1);
  });
});
