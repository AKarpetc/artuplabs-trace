import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createValueCache } from '../../src/infra/cache.js';
import { REFRESH_GROUP_BUDGET_MS } from '../../src/core/limits.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
const make = (kvs = createFakeKvs({ pageSize: 100 }), hash = (s) => s) => ({ kvs, cache: createValueCache({ kvs, hash, chunkHash: sha }) });
const entry = (values, extra = {}) => ({ values, watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh', ...extra });
const sets = (kvs) => kvs.calls.ops.filter((op) => op.startsWith('set '));
const chunkKeys = (kvs, group = 'g') => [...kvs.data.keys()].filter((k) => k.startsWith(`v:${group}:k`));

describe('value cache', () => {
  it('stores values and watched ids in chunks of 5 000 and reads any range', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(12000), { watch: ids(3), at: 7 }));
    const meta = await cache.meta('g');
    expect(meta).toMatchObject({ at: 7, n: 12000, nw: 3, field: 'id', rootFilter: null, source: 'refresh' });
    expect([meta.c.length, meta.w.length]).toEqual([3, 1]);
    expect(await cache.values('g', meta, 4999, 5001)).toEqual(['5000', '5001']);
    expect(await cache.values('g', meta, 11000, 13000)).toEqual(ids(1000, 11001));
    expect(await cache.watch('g')).toEqual(new Set(['1', '2', '3']));
    expect(chunkKeys(kvs)).toHaveLength(4);
  });
  it('tells whether any given id is watched, reading only the watch chunks whose id range covers one', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10), { watch: ids(12000) }));
    const read = [];
    const get = kvs.get;
    kvs.get = async (key) => { read.push(key); return get(key); };
    expect(await cache.watchHit('g', ['5001', '999999'])).toBe(true);
    expect(read.filter((k) => k.startsWith('v:g:k'))).toHaveLength(1);
    read.length = 0;
    expect(await cache.watchHit('g', ['999999', '0'])).toBe(false);
    expect(read.filter((k) => k.startsWith('v:g:k'))).toHaveLength(0);
  });
  it('finds a watched id in a watch list stored out of id order', async () => {
    const { cache } = make();
    await cache.write('g', entry(ids(1), { watch: [...ids(6000, 10).reverse(), '3'] }));
    expect([await cache.watchHit('g', ['3']), await cache.watchHit('g', ['6009']), await cache.watchHit('g', ['5'])]).toEqual([true, true, false]);
  });
  it('answers an unknown watch for a group without a watch list or without a cache', async () => {
    const { cache } = make();
    await cache.write('g', entry(ids(3)));
    expect([await cache.watchHit('g', ['1']), await cache.watchHit('none', ['1'])]).toEqual([null, null]);
  });
  it('adds the id ranges of the watch chunks to a meta written before they were kept', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(3), { watch: ids(3) }));
    const meta = await cache.meta('g');
    delete meta.wr;
    await kvs.set('v:g:m', meta);
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(3), { watch: ids(3), at: 2 }));
    expect([sets(kvs), (await cache.meta('g')).wr]).toEqual([['set v:g:m'], [['1', '3']]]);
  });
  it('writes nothing when a refresh computes the same values again', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(12000), { watch: ids(7000) }));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(12000), { watch: ids(7000), at: 2 }));
    expect(kvs.calls.ops).toEqual([]);
  });
  it('writes only the chunks that changed and deletes the ones no longer used', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(12000)));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry([...ids(11999), '99999'], { at: 2 }));
    expect([sets(kvs).length, kvs.calls.ops.filter((op) => op.startsWith('delete ')).length]).toEqual([2, 1]);
    const meta = await cache.meta('g');
    expect(await cache.values('g', meta, 11990, 12000)).toEqual([...ids(9, 11991), '99999']);
    expect(chunkKeys(kvs)).toHaveLength(3);
  });
  it('refreshes the meta of a job result with the same values, so the function serves it', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10)));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(10), { at: 5, source: 'job' }));
    expect(sets(kvs)).toEqual(['set v:g:m']);
    expect((await cache.meta('g'))).toMatchObject({ at: 5, source: 'job' });
  });
  it('keeps how long the group took to compute and rewrites the meta when the group turns heavy', async () => {
    const { cache } = make();
    await cache.write('g', entry(['1'], { ms: 1234 }));
    expect((await cache.meta('g')).ms).toBe(1234);
    await cache.write('g', entry(['1'], { ms: REFRESH_GROUP_BUDGET_MS }));
    expect((await cache.meta('g')).ms).toBe(REFRESH_GROUP_BUDGET_MS);
  });
  it('keeps the points the group cost and the levels of its stored tree', async () => {
    const { cache } = make();
    await cache.write('g', entry(['1'], { pts: 420, lv: 2 }));
    expect(await cache.meta('g')).toMatchObject({ pts: 420, lv: 2 });
  });
  it('stores no points and no levels when none were given', async () => {
    const { cache } = make();
    await cache.write('g', entry(['1']));
    expect(Object.keys(await cache.meta('g'))).not.toContain('pts');
    expect(Object.keys(await cache.meta('g'))).not.toContain('lv');
  });
  it('rewrites the meta of the same values when the points the group cost changed', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10), { pts: 30 }));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(10), { pts: 900, at: 2 }));
    expect([sets(kvs), (await cache.meta('g')).pts]).toEqual([['set v:g:m'], 900]);
  });
  it('rewrites the meta of the same values when the levels of the tree changed', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10), { lv: 1 }));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(10), { lv: 2, at: 2 }));
    expect([sets(kvs), (await cache.meta('g')).lv]).toEqual([['set v:g:m'], 2]);
  });
  it('writes nothing for the same values, points and levels', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10), { pts: 30, lv: 1 }));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(10), { pts: 30, lv: 1, at: 2 }));
    expect(kvs.calls.ops).toEqual([]);
  });
  it('matches a result to the meta of the same values, field, filter and tree levels', async () => {
    const { cache } = make();
    await cache.write('g', entry(ids(12000), { lv: 1 }));
    const meta = await cache.meta('g');
    expect([
      cache.matches(meta, entry(ids(12000), { lv: 1 })),
      cache.matches(meta, entry(ids(11999), { lv: 1 })),
      cache.matches(meta, entry(ids(12000), { lv: 2 })),
      cache.matches(meta, entry(ids(12000), { lv: 1, field: 'parent' })),
      cache.matches(meta, entry(ids(12000), { lv: 1, rootFilter: 'x' })),
      cache.matches(null, entry(ids(12000), { lv: 1 })),
    ]).toEqual([true, false, false, false, false, false]);
  });
  it('keeps the meta when the cost stays in the same class', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s, chunkHash: sha, costClass: (pts) => (pts > 100 ? 'dear' : 'cheap') });
    await cache.write('g', entry(ids(10), { pts: 30 }));
    kvs.calls.ops.length = 0;
    await cache.write('g', entry(ids(10), { pts: 60, at: 2 }));
    expect(kvs.calls.ops).toEqual([]);
    await cache.write('g', entry(ids(10), { pts: 200, at: 3 }));
    expect((await cache.meta('g')).pts).toEqual(200);
  });
  it('knows nothing about a group never written', async () => {
    const { cache } = make();
    expect([await cache.meta('x'), await cache.watch('x')]).toEqual([null, null]);
  });
  it('reads no values past the end of the result and no watch list when none was given', async () => {
    const { cache } = make();
    await cache.write('g', entry(ids(3), { watch: [], field: 'key', rootFilter: 'project = A', source: 'job' }));
    const meta = await cache.meta('g');
    expect([await cache.values('g', meta, 2, 10), await cache.values('g', meta, 5, 10), await cache.watch('g')]).toEqual([['3'], [], new Set()]);
    await cache.write('g', entry(ids(3)));
    expect(await cache.watch('g')).toBeNull();
  });
  it('keeps the groups apart by their hashed key', async () => {
    const { kvs, cache } = make(createFakeKvs(), (s) => `h${s}`);
    await cache.write('a', entry(['1'], { source: 'function' }));
    expect([...kvs.data.keys()].sort()).toEqual([`v:ha:k${sha(JSON.stringify(['1']))}`, 'v:ha:m']);
  });
  it('reads exactly one of two parallel writers of a group, never a mix', async () => {
    const { cache } = make();
    await cache.write('g', entry(ids(7000), { watch: ids(6000), at: 0 }));
    const big = entry(ids(12000, 100), { watch: ids(7000, 100), at: 1 });
    const small = entry(ids(3, 900), { watch: ids(2, 900), field: 'key', at: 2, source: 'job' });
    await Promise.all([cache.write('g', big), cache.write('g', small)]);
    const meta = await cache.meta('g');
    const written = meta.at === 1 ? big : small;
    expect(await cache.values('g', meta, 0, meta.n)).toEqual(written.values);
    expect(await cache.watch('g')).toEqual(new Set(written.watch));
  });
  it('refuses a write from a computation that started before the stored one', async () => {
    const { cache } = make();
    await cache.write('g', entry(ids(3), { watch: ['7'], startedAt: 20 }));
    await cache.write('g', entry(ids(3), { watch: ['8'], startedAt: 10 }));
    expect([await cache.watch('g'), (await cache.meta('g')).startedAt]).toEqual([new Set(['7']), 20]);
  });
  const pausedAfterMetaRead = (kvs) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let paused = false;
    const view = { ...kvs, query: () => kvs.query(), set: (k, v) => kvs.set(k, v), delete: (k) => kvs.delete(k), async get(key) {
      const value = await kvs.get(key);
      if (!paused && key.endsWith(':m')) {
        paused = true;
        await gate;
      }
      return value;
    } };
    return { view, release: () => release() };
  };
  for (const [name, slow, fast] of [['an older', 10, 20], ['a newer', 20, 10]]) {
    it(`keeps every chunk readable when ${name} writer with the same values finishes last`, async () => {
      const kvs = createFakeKvs({ pageSize: 100 });
      const shared = createValueCache({ kvs, hash: (x) => x, chunkHash: sha });
      await shared.write('g', entry(ids(10), { watch: ['1'], startedAt: 1 }));
      const { view, release } = pausedAfterMetaRead(kvs);
      const late = createValueCache({ kvs: view, hash: (x) => x, chunkHash: sha });
      const lateWrite = late.write('g', entry(ids(10), { watch: ['2'], startedAt: slow }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      await shared.write('g', entry(ids(10), { watch: ['3'], startedAt: fast }));
      release();
      await lateWrite;
      const meta = await shared.meta('g');
      expect(await shared.values('g', meta, 0, 10)).toEqual(ids(10));
      expect(await shared.watch('g')).toEqual(new Set([slow > fast ? '2' : '3']));
    });
  }
  it('drops a meta whose chunk is gone, so the next write of the same content stores the chunk again', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10), { watch: ids(2) }));
    const meta = await cache.meta('g');
    kvs.data.delete(`v:g:k${meta.c[0]}`);
    expect(await cache.values('g', meta, 0, 10)).toBeNull();
    expect(await cache.meta('g')).toBeNull();
    await cache.write('g', entry(ids(10), { watch: ids(2) }));
    expect(await cache.values('g', await cache.meta('g'), 0, 10)).toEqual(ids(10));
  });
  it('keeps a newer meta when a reader of the replaced one meets a deleted chunk', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(10)));
    const before = await cache.meta('g');
    await cache.write('g', entry(ids(10, 50)));
    expect(await cache.values('g', before, 0, 10)).toBeNull();
    expect((await cache.meta('g')).c).not.toEqual(before.c);
    expect(kvs.data.has('v:g:m')).toBe(true);
  });
  it('reads no list when a chunk of the range is gone, so the caller rereads or recomputes', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(12000), { watch: ids(6000, 50000) }));
    const meta = await cache.meta('g');
    kvs.data.delete(`v:g:k${meta.c[1]}`);
    kvs.data.delete(`v:g:k${meta.w[1]}`);
    expect([await cache.values('g', meta, 4000, 6000), await cache.values('g', meta, 0, 10), await cache.watch('g')]).toEqual([null, ids(10), null]);
  });
});
