import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createPcsCache } from '../../src/infra/pcs.js';
import { ERR } from '../../src/core/errors.js';
import { PCS_CACHE_MS, PCS_CHUNK } from '../../src/core/limits.js';

const pc = (i, extra = {}) => ({ id: `p${i}`, functionName: 'parentsOf', arguments: ['q'], operator: 'in', used: '2026-10-05T07:00:00Z', updated: '2026-10-05T06:00:00Z', value: 'id in (1)', ...extra });

function setup(list) {
  let now = 1000;
  const kvs = createFakeKvs({ pageSize: 100 });
  const asked = [];
  const jira = { precomputations: async () => { asked.push(now); return list; } };
  const cache = createPcsCache({ kvs, jira, clock: () => now });
  return { kvs, asked, cache, advance: (ms) => { now += ms; } };
}

describe('precomputation list cache', () => {
  it('keeps each precomputation without its value or error text', async () => {
    const tooDear = ERR.tooExpensive('parentsOf', { n: null, points: null, limit: 9 });
    const { cache } = setup([pc(1), pc(2, { value: undefined, error: tooDear }), pc(3, { error: 'Computing' })]);
    expect(await cache.list()).toEqual([
      { id: 'p1', functionName: 'parentsOf', arguments: ['q'], operator: 'in', used: '2026-10-05T07:00:00Z', updated: '2026-10-05T06:00:00Z', created: null, hasValue: true, errorKind: null },
      { id: 'p2', functionName: 'parentsOf', arguments: ['q'], operator: 'in', used: '2026-10-05T07:00:00Z', updated: '2026-10-05T06:00:00Z', created: null, hasValue: false, errorKind: 'tooExpensive' },
      { id: 'p3', functionName: 'parentsOf', arguments: ['q'], operator: 'in', used: '2026-10-05T07:00:00Z', updated: '2026-10-05T06:00:00Z', created: null, hasValue: true, errorKind: 'other' },
    ]);
  });
  it('asks Jira once within the cache time and reads the stored list after', async () => {
    const { cache, asked } = setup([pc(1)]);
    const first = await cache.list();
    expect([await cache.list(), asked]).toEqual([first, [1000]]);
  });
  it('asks Jira again once the cache time has passed', async () => {
    const { cache, asked, advance } = setup([pc(1)]);
    await cache.list();
    advance(PCS_CACHE_MS);
    await cache.list();
    expect(asked).toEqual([1000, 1000 + PCS_CACHE_MS]);
  });
  it('asks Jira again after a function call marked the list stale', async () => {
    const { cache, asked, advance } = setup([pc(1)]);
    await cache.list();
    advance(10);
    await cache.markDirty();
    await cache.list();
    expect(asked).toEqual([1000, 1010]);
  });
  it('stores a long list in chunks and reads it back whole', async () => {
    const list = Array.from({ length: PCS_CHUNK * 2 + 5 }, (_, i) => pc(i));
    const { cache, kvs } = setup(list);
    await cache.list();
    expect([...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:')).sort()).toEqual(['q:pcs:0', 'q:pcs:1', 'q:pcs:2', 'q:pcs:m']);
    expect((await cache.list()).map((p) => p.id)).toEqual(list.map((p) => p.id));
  });
  it('asks Jira when a chunk of the stored list is missing', async () => {
    const { cache, kvs, asked } = setup([pc(1)]);
    await cache.list();
    await kvs.delete('q:pcs:0');
    await cache.list();
    expect(asked).toHaveLength(2);
  });
});
