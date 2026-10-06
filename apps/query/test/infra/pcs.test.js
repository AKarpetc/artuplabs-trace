import { describe, expect, it } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createPcsCache } from '../../src/infra/pcs.js';
import { ERR } from '../../src/core/errors.js';
import { KVS_VALUE_MAX_BYTES, PCS_CACHE_MS, PCS_CHUNK_MAX_BYTES } from '../../src/core/limits.js';

const pc = (i, extra = {}) => ({ id: `p${i}`, functionName: 'parentsOf', arguments: ['q'], operator: 'in', used: '2026-10-05T07:00:00Z', updated: '2026-10-05T06:00:00Z', value: 'id in (1)', ...extra });

function setup(list) {
  let now = 1000;
  const kvs = createFakeKvs({ pageSize: 100, maxBytes: KVS_VALUE_MAX_BYTES });
  const asked = [];
  const jira = { precomputations: async () => { asked.push(now); return list; } };
  const cache = createPcsCache({ kvs, jira, beginsWith, clock: () => now });
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
  it('stores a long list in chunks of one generation and reads it back whole', async () => {
    const list = Array.from({ length: 100 }, (_, i) => pc(i, { arguments: [`key in (${'ABC-1234, '.repeat(300)})`] }));
    const { cache, kvs } = setup(list);
    await cache.list();
    const chunks = [...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:1000:'));
    expect([chunks.length > 1, chunks.every((k) => Buffer.byteLength(JSON.stringify(kvs.data.get(k))) <= PCS_CHUNK_MAX_BYTES)]).toEqual([true, true]);
    expect((await cache.list()).map((p) => p.id)).toEqual(list.map((p) => p.id));
  });
  it('answers without storing the list when one record alone is longer than a chunk', async () => {
    const { cache, kvs, asked } = setup([pc(1), pc(2, { arguments: ['x'.repeat(PCS_CHUNK_MAX_BYTES)] })]);
    expect((await cache.list()).map((p) => p.id)).toEqual(['p1', 'p2']);
    await cache.list();
    expect([[...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:')), asked]).toEqual([[], [1000, 1000]]);
  });
  it('drops the chunks of a list stored in the old format of 100 records a chunk', async () => {
    const { cache, kvs } = setup([pc(1)]);
    await kvs.set('q:pcs:m', { at: 500, n: 150, gen: 500 });
    await kvs.set('q:pcs:500:0', []);
    await kvs.set('q:pcs:500:1', []);
    await cache.list();
    expect([...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:500:'))).toEqual([]);
  });
  it('drops the added records Jira lists and the older generation when the list cannot be stored', async () => {
    const list = [pc(1)];
    const { cache, kvs, advance } = setup(list);
    await cache.list();
    await cache.add({ id: 'p2', functionName: 'parentsOf', arguments: ['q'], operator: 'in', hasValue: true, errorKind: null });
    list.push(pc(2), pc(3, { arguments: ['x'.repeat(PCS_CHUNK_MAX_BYTES)] }));
    advance(PCS_CACHE_MS);
    await cache.list();
    expect([...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:'))).toEqual([]);
  });
  it('drops the chunks of the older generation once a new one is written', async () => {
    const { cache, kvs, advance } = setup([pc(1)]);
    await cache.list();
    advance(PCS_CACHE_MS);
    await cache.list();
    expect([...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:')).sort()).toEqual([`q:pcs:${1000 + PCS_CACHE_MS}:0`, 'q:pcs:m']);
  });
  it('asks Jira when a chunk of the stored list is missing', async () => {
    const { cache, kvs, asked } = setup([pc(1)]);
    await cache.list();
    await kvs.delete('q:pcs:1000:0');
    await cache.list();
    expect(asked).toHaveLength(2);
  });
  it('lists a precomputation a function call added without asking Jira again', async () => {
    const { cache, asked } = setup([pc(1)]);
    await cache.list();
    await cache.add({ id: 'p9', functionName: 'parentsOf', arguments: ['r'], operator: 'not in', hasValue: true, errorKind: null });
    expect([(await cache.list()).map((p) => p.id), asked]).toEqual([['p1', 'p9'], [1000]]);
  });
  it('takes an added record over the stored one of the same precomputation', async () => {
    const { cache } = setup([pc(1, { value: undefined, error: 'Computing' })]);
    await cache.list();
    await cache.add({ id: 'p1', functionName: 'parentsOf', arguments: ['q'], operator: 'in', hasValue: true, errorKind: null });
    expect((await cache.list()).map((p) => [p.id, p.hasValue, p.errorKind])).toEqual([['p1', true, null]]);
  });
  it('drops the added records Jira lists once it is read again', async () => {
    const list = [pc(1)];
    const { cache, kvs, advance } = setup(list);
    await cache.list();
    await cache.add({ id: 'p2', functionName: 'parentsOf', arguments: ['q'], operator: 'in', hasValue: true, errorKind: null });
    list.push(pc(2));
    advance(PCS_CACHE_MS);
    await cache.list();
    expect([...kvs.data.keys()].some((k) => k.startsWith('q:pcs:add:'))).toBe(false);
  });
  it('drops its own chunks when another reader wrote the meta last', async () => {
    const { cache, kvs } = setup([pc(1)]);
    const set = kvs.set;
    kvs.set = async (key, value) => {
      await set(key, value);
      if (key === 'q:pcs:m') await set('q:pcs:m', { at: 999, n: 1, gen: 999, chunks: 1 });
    };
    await cache.list();
    expect([...kvs.data.keys()].filter((k) => k.startsWith('q:pcs:1000:'))).toEqual([]);
  });
});
