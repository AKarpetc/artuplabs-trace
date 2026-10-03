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
  it('reads no list when a chunk of the range is gone, so the caller rereads or recomputes', async () => {
    const { kvs, cache } = make();
    await cache.write('g', entry(ids(12000), { watch: ids(6000, 50000) }));
    const meta = await cache.meta('g');
    kvs.data.delete(`v:g:k${meta.c[1]}`);
    kvs.data.delete(`v:g:k${meta.w[1]}`);
    expect([await cache.values('g', meta, 4000, 6000), await cache.values('g', meta, 0, 10), await cache.watch('g')]).toEqual([null, ids(10), null]);
  });
});
