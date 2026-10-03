import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createValueCache } from '../../src/infra/cache.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

describe('value cache', () => {
  it('stores values and watched ids in chunks of 5 000 and reads any range', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s });
    await cache.write('g', { values: ids(12000), watch: ids(3), field: 'id', rootFilter: null, at: 7, source: 'refresh' });
    const meta = await cache.meta('g');
    expect(meta).toEqual({ at: 7, n: 12000, nw: 3, field: 'id', rootFilter: null, source: 'refresh' });
    expect(await cache.values('g', meta, 4999, 5001)).toEqual(['5000', '5001']);
    expect(await cache.values('g', meta, 11000, 13000)).toEqual(ids(1000, 11001));
    expect(await cache.watch('g')).toEqual(new Set(['1', '2', '3']));
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:c'))).toEqual(['v:g:c0', 'v:g:c1', 'v:g:c2']);
  });
  it('deletes chunks a smaller result no longer needs', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s });
    await cache.write('g', { values: ids(12000), watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await cache.write('g', { values: ids(10), watch: null, field: 'id', rootFilter: null, at: 2, source: 'refresh' });
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:c'))).toEqual(['v:g:c0']);
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
    const cache = createValueCache({ kvs, hash: (s) => `h${s}` });
    await cache.write('a', { values: ['1'], watch: null, field: 'id', rootFilter: null, at: 1, source: 'function' });
    expect([...kvs.data.keys()].sort()).toEqual(['v:ha:c0', 'v:ha:m']);
  });
});
