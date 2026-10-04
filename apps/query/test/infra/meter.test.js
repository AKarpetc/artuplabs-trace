import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { keyFamily, meterKvs, withKvsLog } from '../../src/infra/meter.js';

describe('meterKvs', () => {
  it('counts sets with their key and JSON bytes, and deletes, and passes every call through', async () => {
    const raw = createFakeKvs();
    const meter = meterKvs(raw);
    await meter.kvs.set('ab', { x: 'é' });
    await meter.kvs.delete('ab');
    await meter.kvs.set('c', [1, 2]);
    expect(await meter.kvs.get('c')).toEqual([1, 2]);
    expect((await meter.kvs.query().where('key', { values: ['c'] }).limit(5).getMany()).results).toHaveLength(1);
    expect(meter.take()).toEqual({ sets: 2, bytes: 2 + 10 + 1 + 5, deletes: 1, families: { ab: { sets: 1, bytes: 12 }, c: { sets: 1, bytes: 6 } }, reads: { gets: 1, queries: 1, bytes: 12 } });
    expect(meter.take()).toEqual({ sets: 0, bytes: 0, deletes: 0, families: {}, reads: { gets: 0, queries: 0, bytes: 0 } });
  });
  it('counts gets, query pages and the key and JSON bytes they return', async () => {
    const raw = createFakeKvs({ pageSize: 2 });
    await raw.set('p:1', { a: 1 });
    await raw.set('p:2', 'xy');
    await raw.set('p:3', 7);
    const meter = meterKvs(raw);
    expect(await meter.kvs.get('p:1')).toEqual({ a: 1 });
    expect(await meter.kvs.get('missing')).toBeUndefined();
    const query = meter.kvs.query().where('key', { values: ['p:'] }).limit(5);
    const first = await query.getMany();
    const second = await query.cursor(first.nextCursor).getMany();
    expect([...first.results, ...second.results].map((r) => r.key)).toEqual(['p:1', 'p:2', 'p:3']);
    expect(meter.take().reads).toEqual({ gets: 2, queries: 2, bytes: (3 + 7) + (3 + 7) + (3 + 4) + (3 + 1) });
  });
  it('counts reads without their bytes when read bytes are off', async () => {
    const raw = createFakeKvs();
    await raw.set('p:1', { a: 1 });
    const meter = meterKvs(raw, { readBytes: false });
    await meter.kvs.get('p:1');
    await meter.kvs.query().where('key', { values: ['p:'] }).getMany();
    expect(meter.take().reads).toEqual({ gets: 1, queries: 1, bytes: 0 });
  });
  it('counts a query page without results as a read of no bytes', async () => {
    const meter = meterKvs(createFakeKvs());
    expect((await meter.kvs.query().where('key', { values: ['none'] }).getMany()).results).toEqual([]);
    expect(meter.take().reads).toEqual({ gets: 0, queries: 1, bytes: 0 });
  });
});

describe('keyFamily', () => {
  it('names the record a key belongs to without its hashes, timestamps or tags', () => {
    const h = 'a'.repeat(40);
    expect([
      keyFamily(`v:${h}:m`), keyFamily(`v:${h}:k${'b'.repeat(40)}`), keyFamily('t:000001759500000:k3j9x'),
      keyFamily(`q:job:${h}`), keyFamily(`q:hq:${h}`), keyFamily(`q:gw:${h}`), keyFamily('q:running'), keyFamily('log:errors'),
    ]).toEqual(['cache-meta', 'cache-chunk', 'journal', 'job', 'heavy', 'group-write', 'q:running', 'log:errors']);
  });
});

describe('withKvsLog', () => {
  it('logs the writes of one invocation by record family, never values', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await meter.kvs.set('before', 1);
    const handler = withKvsLog('on-event', meter, { writes: true }, async (x) => {
      await meter.kvs.set('secret-key', 'secret value');
      return x + 1;
    });
    expect(await handler(1)).toBe(2);
    expect(log.mock.calls).toEqual([['kvs writes on-event: 1 sets, 24 bytes, 0 deletes [secret-key 1/24]']]);
    log.mockRestore();
  });
  it('takes its label from the handler arguments when given a function', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withKvsLog((event) => `on-refresh:${event.body.kind}`, meter, { writes: true }, async () => meter.kvs.delete('k'))({ body: { kind: 'heavy' } });
    expect(log.mock.calls).toEqual([['kvs writes on-refresh:heavy: 0 sets, 0 bytes, 1 deletes']]);
    log.mockRestore();
  });
  it('logs nothing when disabled or when nothing was written', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withKvsLog('a', meter, { writes: false, reads: false }, async () => meter.kvs.set('k', 1))();
    await withKvsLog('b', meter, { writes: true, reads: true }, async () => null)();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('logs the writes of an invocation that throws', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing = withKvsLog('c', meter, { writes: true }, async () => {
      await meter.kvs.delete('k');
      throw new Error('boom');
    });
    await expect(failing()).rejects.toThrow('boom');
    expect(log.mock.calls).toEqual([['kvs writes c: 0 sets, 0 bytes, 1 deletes']]);
    log.mockRestore();
  });
  it('logs the reads of one invocation as counts when reads are enabled, never values', async () => {
    const raw = createFakeKvs();
    await raw.set('secret-key', 'secret value');
    const meter = meterKvs(raw);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await meter.kvs.get('secret-key');
    await withKvsLog('lastComment', meter, { writes: true, reads: true }, async () => {
      await meter.kvs.get('secret-key');
      await meter.kvs.query().where('key', { values: ['secret'] }).getMany();
    })();
    expect(log.mock.calls).toEqual([['kvs reads lastComment: 1 gets, 1 query pages, 48 bytes']]);
    log.mockRestore();
  });
  it('logs no reads when only writes are enabled', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withKvsLog('d', meter, { writes: true }, async () => meter.kvs.get('k'))();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('logs the Jira requests of one invocation by endpoint when requests are enabled', async () => {
    const taken = [{ old: { requests: 9, limited: 0, rate: null } }, { 'GET /rest/api/3/field': { requests: 2, limited: 1, rate: 'x-ratelimit-remaining=40' }, 'POST /rest/api/3/search/jql': { requests: 3, limited: 0, rate: null } }];
    const meter = { ...meterKvs(createFakeKvs()), takeRequests: () => taken.shift() };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withKvsLog('expression', meter, { requests: true }, async () => null)();
    expect(log.mock.calls).toEqual([['jira requests expression: GET /rest/api/3/field 2 (429: 1) [x-ratelimit-remaining=40], POST /rest/api/3/search/jql 3']]);
    log.mockRestore();
  });
});
