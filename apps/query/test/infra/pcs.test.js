import { describe, expect, it, vi } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createPcsCache } from '../../src/infra/pcs.js';
import { ERR } from '../../src/core/errors.js';
import { KVS_VALUE_MAX_BYTES, PCS_CACHE_MS, PCS_CHUNK_MAX_BYTES, PCS_RECENT_PAGES, PCS_RECENT_SKEW_MS } from '../../src/core/limits.js';

const pc = (i, extra = {}) => ({ id: `p${i}`, functionName: 'parentsOf', arguments: ['q'], operator: 'in', used: '2026-10-05T07:00:00Z', updated: '2026-10-05T06:00:00Z', value: 'id in (1)', ...extra });

function setup(list, recent = async () => [], { log = false } = {}) {
  let now = 1000;
  const kvs = createFakeKvs({ pageSize: 100, maxBytes: KVS_VALUE_MAX_BYTES });
  const asked = [];
  const askedRecent = [];
  const jira = { precomputations: async () => { asked.push(now); return list; } };
  jira.recentPrecomputations = async (since) => {
    askedRecent.push(since);
    const got = await recent();
    return Array.isArray(got) ? { records: got, end: 'done' } : got;
  };
  const cache = createPcsCache({ kvs, jira, beginsWith, clock: () => now, log });
  return { kvs, asked, askedRecent, cache, advance: (ms) => { now += ms; } };
}

describe('precomputation list cache', () => {
  it('lays the use times Jira reports since the cached list was read over that list', async () => {
    const { cache, advance } = setup([pc(1), pc(2)], async () => [pc(2, { used: '2026-10-07T03:14:15.000+0000' })]);
    await cache.list();
    advance(10);
    expect((await cache.list()).map((p) => [p.id, p.used])).toEqual([['p1', '2026-10-05T07:00:00Z'], ['p2', '2026-10-07T03:14:15.000+0000']]);
  });
  it('asks for the recently used precomputations since the cached list was read, less PCS_RECENT_SKEW_MS', async () => {
    const { cache, askedRecent, advance } = setup([pc(1)], async () => []);
    await cache.list();
    advance(10);
    await cache.list();
    expect(askedRecent).toEqual([1000 - PCS_RECENT_SKEW_MS]);
  });
  it('adds a recently used precomputation the cached list lacks', async () => {
    const { cache, advance } = setup([pc(1)], async () => [pc(9, { used: '2026-10-07T03:14:15.000+0000' })]);
    await cache.list();
    advance(10);
    expect((await cache.list()).map((p) => p.id)).toEqual(['p1', 'p9']);
  });
  it('keeps the cached use times when Jira refuses the recently used read', async () => {
    const { cache, advance } = setup([pc(1)], async () => { throw Object.assign(new Error('bad'), { name: 'JiraError', status: 400 }); });
    await cache.list();
    advance(10);
    expect((await cache.list()).map((p) => p.used)).toEqual(['2026-10-05T07:00:00Z']);
  });
  it('reads the full list through the given wrapper and the recently used ones outside it', async () => {
    const { cache, advance } = setup([pc(1)], async () => []);
    const wrapped = [];
    const full = async (task) => { wrapped.push('full'); return task(); };
    await cache.list({ full });
    advance(10);
    await cache.list({ full });
    expect(wrapped).toEqual(['full']);
  });
  it('logs a recently used read cut by its page limit or the points budget when asked to', async () => {
    const lines = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => lines.push(line));
    const { cache, advance } = setup([pc(1)], async () => ({ records: [], end: 'pages' }), { log: true });
    await cache.list();
    advance(10);
    await cache.list();
    spy.mockRestore();
    expect(lines).toEqual([`recently used precomputations cut at ${PCS_RECENT_PAGES} pages: 0 read`]);
  });
  it('passes on a rate limit met while reading the recently used precomputations', async () => {
    const { cache, advance } = setup([pc(1)], async () => { throw Object.assign(new Error('429'), { name: 'RateLimitError', status: 429 }); });
    await cache.list();
    advance(10);
    await expect(cache.list()).rejects.toMatchObject({ name: 'RateLimitError' });
  });
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
