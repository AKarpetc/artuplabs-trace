export const BUDGET = { windowMs: 15 * 60 * 1000, maxPoints: 5000 };

/** Reserves Jira points in a fixed window; when refused, waitSeconds says when the window resets. */
export function takePoints(state, points, nowMs, limits = BUDGET) {
  const expired = !state || nowMs - state.windowStart >= limits.windowMs;
  const current = expired ? { windowStart: nowMs, used: 0 } : state;
  if (current.used + points > limits.maxPoints) {
    const waitMs = current.windowStart + limits.windowMs - nowMs;
    return { ok: false, state: current, waitSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
  return { ok: true, state: { windowStart: current.windowStart, used: current.used + points }, waitSeconds: 0 };
}
