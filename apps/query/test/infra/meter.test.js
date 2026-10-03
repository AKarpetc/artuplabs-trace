import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { meterKvs, withWriteLog } from '../../src/infra/meter.js';

describe('meterKvs', () => {
  it('counts sets with their key and JSON bytes, and deletes, and passes every call through', async () => {
    const raw = createFakeKvs();
    const meter = meterKvs(raw);
    await meter.kvs.set('ab', { x: 'é' });
    await meter.kvs.delete('ab');
    await meter.kvs.set('c', [1, 2]);
    expect(await meter.kvs.get('c')).toEqual([1, 2]);
    expect((await meter.kvs.query().where('key', { values: ['c'] }).limit(5).getMany()).results).toHaveLength(1);
    expect(meter.take()).toEqual({ sets: 2, bytes: 2 + 10 + 1 + 5, deletes: 1 });
    expect(meter.take()).toEqual({ sets: 0, bytes: 0, deletes: 0 });
  });
});

describe('withWriteLog', () => {
  it('logs the writes of one invocation without keys or values', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await meter.kvs.set('before', 1);
    const handler = withWriteLog('on-event', meter, true, async (x) => {
      await meter.kvs.set('secret-key', 'secret value');
      return x + 1;
    });
    expect(await handler(1)).toBe(2);
    expect(log.mock.calls).toEqual([['kvs writes on-event: 1 sets, 24 bytes, 0 deletes']]);
    log.mockRestore();
  });
  it('takes its label from the handler arguments when given a function', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withWriteLog((event) => `on-refresh:${event.body.kind}`, meter, true, async () => meter.kvs.delete('k'))({ body: { kind: 'heavy' } });
    expect(log.mock.calls).toEqual([['kvs writes on-refresh:heavy: 0 sets, 0 bytes, 1 deletes']]);
    log.mockRestore();
  });
  it('logs nothing when disabled or when nothing was written', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withWriteLog('a', meter, false, async () => meter.kvs.set('k', 1))();
    await withWriteLog('b', meter, true, async () => null)();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('logs the writes of an invocation that throws', async () => {
    const meter = meterKvs(createFakeKvs());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing = withWriteLog('c', meter, true, async () => {
      await meter.kvs.delete('k');
      throw new Error('boom');
    });
    await expect(failing()).rejects.toThrow('boom');
    expect(log.mock.calls).toEqual([['kvs writes c: 0 sets, 0 bytes, 1 deletes']]);
    log.mockRestore();
  });
});
