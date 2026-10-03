import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, pool, stats, UnsafeRetryError, write } from '../../scripts/lib/http.mjs';

const ok = (body, status = 200) => ({ ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(body) });
const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
const reset = () => Object.assign(stats, { requests: 0, retries: 0, timeouts: 0 });

beforeEach(reset);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api', () => {
  it('passes a timeout signal to every request', async () => {
    const fetch = vi.fn(async () => ok({ a: 1 }));
    vi.stubGlobal('fetch', fetch);
    expect(await api('GET', '/x')).toEqual({ a: 1 });
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('retries a read after a network error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(ok({ a: 2 })));
    const pending = api('GET', '/x');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ a: 2 });
    expect(stats).toEqual({ requests: 2, retries: 1, timeouts: 1 });
  });
  it('throws UnsafeRetryError instead of resending an unsafe write', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    await expect(api('POST', '/x', {}, { unsafe: true })).rejects.toBeInstanceOf(UnsafeRetryError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('write', () => {
  it('returns what the check found when a broken write was already applied', async () => {
    const fetch = vi.fn().mockRejectedValue(timeout());
    vi.stubGlobal('fetch', fetch);
    expect(await write('POST', '/x', {}, async () => ({ id: '7' }), { settleMs: 0 })).toEqual({ id: '7' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('sends again when the check finds nothing', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(ok({ id: '8' }, 201));
    vi.stubGlobal('fetch', fetch);
    expect(await write('POST', '/x', {}, async () => null, { settleMs: 0 })).toEqual({ id: '8' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('gives up after the allowed attempts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout()));
    await expect(write('POST', '/x', {}, async () => null, { settleMs: 0, attempts: 2 })).rejects.toThrow('not applied after 2 attempts');
  });
});

describe('pool', () => {
  it('keeps the order of results with at most n tasks in flight', async () => {
    let running = 0;
    let peak = 0;
    const out = await pool([3, 1, 2, 4], 2, async (x) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => { setTimeout(r, x); });
      running -= 1;
      return x * 10;
    });
    expect([out, peak]).toEqual([[30, 10, 20, 40], 2]);
  });
});
