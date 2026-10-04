import { QUEUE_DELAY_MAX_S, RATE_BRAKE_MAX_MS, RATE_BRAKE_MIN_MS } from '../core/limits.js';

/** Whether an error is Jira rate-limiting the app. */
export const isRateLimit = (error) => error?.name === 'RateLimitError';

/** Until when the app's background work waits for Jira's rate limit to reset, or null when it may run. */
export async function brakedUntil(deps) {
  const until = await deps.state.brake.get();
  return until && until > deps.now() ? until : null;
}

/** Seconds from now until `until`, within the delays a queued event may have. */
export function delayUntil(deps, until) {
  return Math.min(Math.max(Math.ceil((until - deps.now()) / 1000), 1), QUEUE_DELAY_MAX_S);
}

/** Pushes one wake event for `until` (no later than the queue allows; the wake waits again when it comes early); none while one is scheduled. */
export async function scheduleWake(deps, until) {
  if (((await deps.state.wake.get()) ?? 0) > deps.now()) return false;
  const delay = delayUntil(deps, until);
  await deps.state.wake.set(deps.now() + delay * 1000);
  try {
    await deps.queue.push({ kind: 'wake' }, delay);
    return true;
  } catch (error) {
    await deps.state.wake.clear();
    console.error(`wake push failed: ${error?.message}`);
    return false;
  }
}

/** Pauses the app's background work until `retryAt` (from RATE_BRAKE_MIN_MS to RATE_BRAKE_MAX_MS ahead; a later pause stays) and schedules one wake for its end. */
export async function brake(deps, retryAt) {
  const now = deps.now();
  const wanted = Math.min(Math.max(retryAt ?? 0, now + RATE_BRAKE_MIN_MS), now + RATE_BRAKE_MAX_MS);
  const current = (await deps.state.brake.get()) ?? 0;
  const until = Math.max(wanted, current);
  if (until > current) await deps.state.brake.set(until);
  await scheduleWake(deps, until);
  return until;
}
