import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createValueCache } from '../../src/infra/cache.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

describe('value cache', () => {
  it('stores values and watched ids in chunks of 5 000 and reads any range', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s, random: () => 'a' });
    await cache.write('g', { values: ids(12000), watch: ids(3), field: 'id', rootFilter: null, at: 7, source: 'refresh' });
    const meta = await cache.meta('g');
    expect(meta).toEqual({ at: 7, n: 12000, nw: 3, field: 'id', rootFilter: null, source: 'refresh', gen: 'a' });
    expect(await cache.values('g', meta, 4999, 5001)).toEqual(['5000', '5001']);
    expect(await cache.values('g', meta, 11000, 13000)).toEqual(ids(1000, 11001));
    expect(await cache.watch('g')).toEqual(new Set(['1', '2', '3']));
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:c'))).toEqual(['v:g:ca_0', 'v:g:ca_1', 'v:g:ca_2']);
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:w'))).toEqual(['v:g:wa_0']);
  });
  it('deletes the previous generation once the new one is switched in', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    let n = 0;
    const cache = createValueCache({ kvs, hash: (s) => s, random: () => `g${(n += 1)}` });
    await cache.write('g', { values: ids(12000), watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await cache.write('g', { values: ids(10), watch: null, field: 'id', rootFilter: null, at: 2, source: 'refresh' });
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:c'))).toEqual(['v:g:cg2_0']);
    expect(await cache.watch('g')).toBeNull();
  });
  it('knows nothing about a group never written', async () => {
    const cache = createValueCache({ kvs: createFakeKvs(), hash: (s) => s });
    expect([await cache.meta('x'), await cache.watch('x')]).toEqual([null, null]);
  });
  it('reads no values past the end of the result', async () => {
    const cache = createValueCache({ kvs: createFakeKvs(), hash: (s) => s });
    await cache.write('g', { values: ids(3), watch: [], field: 'key', rootFilter: 'project = A', at: 1, source: 'job' });
    const meta = await cache.meta('g');
    expect([await cache.values('g', meta, 2, 10), await cache.values('g', meta, 5, 10)]).toEqual([['3'], []]);
  });
  it('keeps the groups apart by their hashed key', async () => {
    const kvs = createFakeKvs();
    const cache = createValueCache({ kvs, hash: (s) => `h${s}`, random: () => 'z' });
    await cache.write('a', { values: ['1'], watch: null, field: 'id', rootFilter: null, at: 1, source: 'function' });
    expect([...kvs.data.keys()].sort()).toEqual(['v:ha:cz_0', 'v:ha:m']);
  });
  it('reads exactly one of two parallel writers of a group, never a mix', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    let n = 0;
    const cache = createValueCache({ kvs, hash: (s) => s, random: () => `p${(n += 1)}` });
    await cache.write('g', { values: ids(7000), watch: ids(6000), field: 'id', rootFilter: null, at: 0, source: 'refresh' });
    const big = { values: ids(12000, 100), watch: ids(7000, 100), field: 'id', rootFilter: null, at: 1, source: 'refresh' };
    const small = { values: ids(3, 900), watch: ids(2, 900), field: 'key', rootFilter: null, at: 2, source: 'job' };
    await Promise.all([cache.write('g', big), cache.write('g', small)]);
    const meta = await cache.meta('g');
    const written = meta.at === 1 ? big : small;
    expect(await cache.values('g', meta, 0, meta.n)).toEqual(written.values);
    expect(await cache.watch('g')).toEqual(new Set(written.watch));
  });
  it('rewrites a group under the same generation without losing the new chunks', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s, random: () => 'same' });
    await cache.write('g', { values: ids(12000), watch: ids(2), field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await cache.write('g', { values: ids(6000), watch: null, field: 'id', rootFilter: null, at: 2, source: 'refresh' });
    const meta = await cache.meta('g');
    expect(await cache.values('g', meta, 0, meta.n)).toEqual(ids(6000));
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:') && k !== 'v:g:m')).toEqual(['v:g:csame_0', 'v:g:csame_1']);
  });
  it('reads no list when a chunk of the range is gone, so the caller rereads or recomputes', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s, random: () => 'a' });
    await cache.write('g', { values: ids(12000), watch: ids(6000), field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    const meta = await cache.meta('g');
    kvs.data.delete('v:g:ca_1');
    kvs.data.delete('v:g:wa_1');
    expect([await cache.values('g', meta, 4000, 6000), await cache.values('g', meta, 0, 10), await cache.watch('g')]).toEqual([null, ids(10), null]);
  });
});
