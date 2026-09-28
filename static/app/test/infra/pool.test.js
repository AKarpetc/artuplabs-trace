import { describe, expect, it } from 'vitest';
import { createPool } from '../../src/infra/pool.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createPool', () => {
  it('never runs more than the given concurrency at once', async () => {
    const run = createPool(2);
    let active = 0;
    let maxActive = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const tasks = gates.map((gate, i) => run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return i;
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(maxActive).toBe(2);
    gates.forEach((gate) => gate.resolve());
    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('resolves results in the order tasks complete, matching each call', async () => {
    const run = createPool(3);
    const results = await Promise.all([
      run(async () => 'a'),
      run(async () => 'b'),
      run(async () => 'c'),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('rejects only the failing task, leaving the others to settle normally', async () => {
    const run = createPool(2);
    const ok1 = run(async () => 'ok1');
    const bad = run(async () => {
      throw new Error('boom');
    });
    const ok2 = run(async () => 'ok2');
    await expect(bad).rejects.toThrow('boom');
    await expect(ok1).resolves.toBe('ok1');
    await expect(ok2).resolves.toBe('ok2');
  });

  it('keeps queued work running after an earlier slot frees up', async () => {
    const run = createPool(1);
    const order = [];
    const tasks = [1, 2, 3].map((n) => run(async () => {
      order.push(n);
      return n;
    }));
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
  });
});
