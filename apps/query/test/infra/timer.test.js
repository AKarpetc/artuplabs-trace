import { afterEach, describe, expect, it, vi } from 'vitest';
import { sleep } from '../../src/infra/timer.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('sleep', () => {
  it('resolves after the given time', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    sleep(1000).then(done);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('clears its timer when its signal aborts', () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    sleep(1000, { signal: stop.signal });
    stop.abort();
    expect(vi.getTimerCount()).toEqual(0);
  });
});
