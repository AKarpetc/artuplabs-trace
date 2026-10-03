import { describe, expect, it } from 'vitest';
import { pool } from '../../src/infra/pool.js';

describe('pool', () => {
  it('keeps the input order and never exceeds the concurrency', async () => {
    let running = 0;
    let peak = 0;
    const task = async (x) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => { setTimeout(resolve, 5 - x); });
      running -= 1;
      return x * 10;
    };
    expect(await pool([1, 2, 3, 4, 5], 2, task)).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
