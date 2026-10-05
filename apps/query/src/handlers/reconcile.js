import { groupPrecomputations, reconcileTargets, rewriteDue } from '../core/affected.js';
import { ACTIVE_MS, HEAVY_RECONCILE_MS, LEASE_MS, PENDING_STALE_MS, RECONCILE_MAX_GROUPS, RECONCILE_STALE_MS, RECONCILE_USED_MS, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { handOff, isDeadline, isHeavy, pushQuietly, rewrite, writeGroups } from './groups.js';
import { brake, brakedUntil, isRateLimit, scheduleWake } from './brake.js';
import { pushRefresh } from './refresh.js';

async function prunePoints(deps) {
  try {
    await deps.points?.prune();
  } catch (error) {
    console.error(`points ledger prune failed: ${error?.name}`);
  }
}

/**
 * Hourly safety net: recompute used groups that missed an event, depend on the clock or need repair (slow ones go to the heavy lane once a day unless they need repair or follow the clock), restart
 * a stalled heavy lane and a journal no refresh is pending for, then fill index gaps; it first deletes the points ledger keys of past hours; it waits while the background is paused for Jira's rate limit, and a 429 pauses it.
 */
export async function onReconcile(deps) {
  await prunePoints(deps);
  const until = await brakedUntil(deps);
  if (until) {
    await scheduleWake(deps, until);
    return { braked: until };
  }
  try {
    return await reconcileOnce(deps);
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    console.error('reconcile stopped by the Jira rate limit');
    await brake(deps, error.retryAt);
    return { braked: true };
  }
}

async function reconcileOnce(deps) {
  const startedAt = deps.now();
  const groups = reconcileTargets(groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: ACTIVE_MS }), {
    now: startedAt, usedMs: RECONCILE_USED_MS, staleMs: RECONCILE_STALE_MS, max: RECONCILE_MAX_GROUPS,
  });
  const byGroup = [];
  let queued = false;
  const handOver = async (group) => {
    if (await handOff(deps, group)) queued = true;
  };
  let limited = null;
  await pool(groups, REFRESH_CONCURRENCY, async (group) => {
    if (limited) return;
    try {
      if (await isHeavy(deps, group)) {
        if (rewriteDue(group, { now: startedAt, staleMs: HEAVY_RECONCILE_MS })) await handOver(group);
        return;
      }
      byGroup.push([group.key, await deps.withDeadline(deps.now() + REFRESH_GROUP_BUDGET_MS, () => rewrite(deps, group, []))]);
    } catch (error) {
      if (isRateLimit(error)) {
        limited = error;
        return;
      }
      if (!isDeadline(error)) throw error;
      await handOver(group);
    }
  });
  if (limited) throw limited;
  let changed = 0;
  if (byGroup.length && ((await deps.state.lastWrittenStart.get()) ?? 0) <= startedAt) {
    if (byGroup.some(([, r]) => r.updates.length)) await deps.state.lastWrittenStart.set(startedAt);
    changed = await writeGroups(deps, startedAt, byGroup);
  }
  if (queued || (await deps.state.heavy.oldest())) await pushQuietly(deps, { kind: 'heavy' });
  const [pending, running] = await Promise.all([deps.state.pending.get(), deps.state.lease.get()]);
  const idle = startedAt - (pending ?? 0) > PENDING_STALE_MS && startedAt - (running ?? 0) > LEASE_MS;
  if (idle && (await deps.journal.read(1)).length) await pushRefresh(deps, startedAt);
  return { groups: groups.length, changed, index: await deps.indexReconcile() };
}
