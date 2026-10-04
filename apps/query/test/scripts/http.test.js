import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, pool, settledIds, stats, UnsafeRetryError, write } from '../../scripts/lib/http.mjs';

const ok = (body, status = 200) => ({ ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body });
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

describe('api after a gateway error', () => {
  it('throws UnsafeRetryError instead of resending an unsafe write after a 503', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({}, 503));
    vi.stubGlobal('fetch', fetch);
    await expect(api('POST', '/x', {}, { unsafe: true })).rejects.toBeInstanceOf(UnsafeRetryError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries a read whose body broke off', async () => {
    vi.useFakeTimers();
    const broken = { ok: true, status: 200, headers: new Headers(), text: async () => { throw timeout(); } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(ok({ a: 3 })));
    const pending = api('GET', '/x');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ a: 3 });
    expect(stats).toEqual({ requests: 2, retries: 1, timeouts: 1 });
  });
});

describe('write', () => {
  it('checks whether a write answered with a 502 was applied before sending again', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({}, 502));
    vi.stubGlobal('fetch', fetch);
    const applied = vi.fn(async () => ({ id: '9' }));
    expect(await write('POST', '/x', {}, applied, { settleMs: 0 })).toEqual({ id: '9' });
    expect([fetch.mock.calls.length, applied.mock.calls.length]).toEqual([1, 1]);
  });
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

describe('settledIds', () => {
  const clockOf = (steps) => {
    let t = 0;
    let i = 0;
    return { now: () => t, search: async () => { t += steps[i] * 1000; i += 1; return { ids: i === steps.length ? ['1'] : [] }; } };
  };
  it('accepts a quick answer at once', async () => {
    const { now, search } = clockOf([2]);
    expect(await settledIds('j', { now, search, sleep: async () => {} })).toEqual({ ids: ['1'], seconds: 2, attempts: 1 });
  });
  it('searches again after a minute while answers are slow enough to be the Computing answer Jira returns as no issues', async () => {
    const { now, search } = clockOf([12, 11, 1]);
    const slept = [];
    expect(await settledIds('j', { now, search, sleep: async (ms) => { slept.push(ms); } })).toEqual({ ids: ['1'], seconds: 1, attempts: 3 });
    expect(slept).toEqual([60000, 60000]);
  });
  it('passes an error through at once', async () => {
    expect(await settledIds('j', { now: () => 0, search: async () => ({ error: '400 x' }), sleep: async () => {} })).toEqual({ error: '400 x', seconds: 0, attempts: 1 });
  });
  it('gives up after six slow answers', async () => {
    const { now, search } = clockOf([20, 20, 20, 20, 20, 20, 20]);
    expect(await settledIds('j', { now, search, sleep: async () => {} })).toEqual({ error: 'still slow after 6 attempts' });
  });
});

describe('upload', () => {
  it('posts one file as multipart form data once, with the XSRF bypass header', async () => {
    const fetch = vi.fn(async () => ok([{ id: '9' }]));
    vi.stubGlobal('fetch', fetch);
    const { upload } = await import('../../scripts/lib/http.mjs');
    expect(await upload('7', 'probe.aq1', 'aq probe')).toEqual([{ id: '9' }]);
    const [url, init] = fetch.mock.calls[0];
    expect([url, init.method, init.headers['X-Atlassian-Token'], init.body.get('file').name]).toEqual(['https://artuplabs-dev.atlassian.net/rest/api/3/issue/7/attachments', 'POST', 'no-check', 'probe.aq1']);
  });
  it('throws on a refused upload without sending it again', async () => {
    const fetch = vi.fn(async () => ({ ...ok({ errorMessages: ['no'] }, 403), json: async () => ({}) }));
    vi.stubGlobal('fetch', fetch);
    const { upload } = await import('../../scripts/lib/http.mjs');
    await expect(upload('7', 'a.txt', 'x')).rejects.toThrow('upload 7 → 403');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
