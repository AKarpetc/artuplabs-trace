import { describe, expect, it, vi } from 'vitest';
import { createIndexing } from '../../src/handlers/indexing.js';

vi.mock('../../src/core/catalog.js', async (orig) => ({ ...(await orig()), SHIPPED_GROUPS: ['query', 'site', 'board'] }));

describe('indexing without a shipped index part', () => {
  it('writes nothing, reads nothing and ships no tables', async () => {
    const touched = [];
    const spy = new Proxy({}, { get: (_, name) => async () => { touched.push(name); } });
    const indexing = createIndexing({ repo: spy, jira: spy, state: spy, migrate: async () => touched.push('migrate'), now: () => 1 });
    await indexing.indexEvent({ eventType: 'avi:jira:updated:issue', issue: { id: '7' }, changelog: { id: '1', items: [{ field: 'Sprint', from: '', to: '5' }] } });
    await indexing.indexEvent({ eventType: 'avi:jira-software:started:sprint', sprint: { id: 5 } });
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '7' } });
    expect(await indexing.reconcileIndex()).toEqual({ started: [], reindexed: 0 });
    expect([indexing.shippedParts(), indexing.shippedTables(), touched]).toEqual([[], [], []]);
  });
});
