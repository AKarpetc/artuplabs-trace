import { describe, it, expect } from 'vitest';
import { takePoints } from '../../src/core/budget';

const limits = { windowMs: 1000, maxPoints: 10 };

describe('takePoints', () => {
  it('starts a window on empty state', () => {
    expect(takePoints(undefined, 4, 5000, limits)).toEqual({ ok: true, state: { windowStart: 5000, used: 4 }, waitSeconds: 0 });
  });

  it('accumulates inside the window', () => {
    const r = takePoints({ windowStart: 5000, used: 4 }, 5, 5500, limits);
    expect(r).toEqual({ ok: true, state: { windowStart: 5000, used: 9 }, waitSeconds: 0 });
  });

  it('refuses when the window would overflow and reports wait until reset', () => {
    const r = takePoints({ windowStart: 5000, used: 9 }, 5, 5500, limits);
    expect(r).toEqual({ ok: false, state: { windowStart: 5000, used: 9 }, waitSeconds: 1 });
  });

  it('opens a new window after expiry', () => {
    const r = takePoints({ windowStart: 5000, used: 10 }, 5, 6001, limits);
    expect(r).toEqual({ ok: true, state: { windowStart: 6001, used: 5 }, waitSeconds: 0 });
  });
});
