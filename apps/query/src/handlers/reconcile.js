import { groupPrecomputations, reconcileTargets, rewriteDue } from '../core/affected.js';
import { admit, groupClass, hourKey, laneRoom, lightLimit } from '../core/points.js';
import { ACTIVE_MS, HEAVY_RECONCILE_MS, HEAVY_STOPS_MAX, LEASE_MS, PENDING_STALE_MS, RECONCILE_MAX_GROUPS, RECONCILE_STALE_MS, RECONCILE_USED_MS, POINTS_OVERHEAD, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { groupWrite, handOff, isDeadline, isHeavy, knownCost, listPrecomputations, overLimit, pushQuietly, rewrite, writeGroups } from './groups.js';
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
 * Hourly safety net: deletes past points ledger keys, restarts a journal no refresh is pending for, then within the reconcile points rewrites
 * used groups that missed an event, follow the clock, need repair or were skipped and used since (heavy ones via the lane), restarts the lane
 * and fills index gaps; it waits while the background is paused for Jira's rate limit, and a 429 pauses it.
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

async function restartJournal(deps, at) {
  const [pending, running] = await Promise.all([deps.state.pending.get(), deps.state.lease.get()]);
  const idle = at - (pending ?? 0) > PENDING_STALE_MS && at - (running ?? 0) > LEASE_MS;
  if (idle && (await deps.journal.read(1)).length) await pushRefresh(deps, at);
}

async function reconcileRoom(deps, at) {
  if (!deps.points || !deps.siteCap) return { limit: Infinity };
  const { byLane } = await deps.points.siteSpent(hourKey(at));
  if (!admit('reconcile', POINTS_OVERHEAD, byLane, at, deps.siteCap).ok) return { refused: true };
  return { limit: laneRoom('reconcile', byLane, at, deps.siteCap) };
}

/** The groups to reconcile: used ones that are due, those a pass skipped and that were used since first, heavy ones only once a day. */
async function targetsOf(deps, startedAt) {
  const used = groupPrecomputations(await listPrecomputations(deps), { now: startedAt, activeMs: ACTIVE_MS })
    .filter((g) => g.items.some((pc) => pc.used && startedAt - Date.parse(pc.used) <= RECONCILE_USED_MS));
  const skips = new Map();
  for (const g of used) {
    const at = await deps.state.skip.get(g.key);
    if (at !== null) skips.set(g.key, at);
  }
  const due = used.filter((g) => skips.has(g.key) || rewriteDue(g, { now: startedAt, staleMs: RECONCILE_STALE_MS }));
  const heavy = new Set();
  for (const g of due) if (await isHeavy(deps, g)) heavy.add(g.key);
  return reconcileTargets(due, { now: startedAt, usedMs: RECONCILE_USED_MS, staleMs: RECONCILE_STALE_MS, max: RECONCILE_MAX_GROUPS, skips, heavy, heavyMs: HEAVY_RECONCILE_MS })
    .map((g) => ({ group: g, heavy: heavy.has(g.key), skipped: skips.has(g.key) }));
}

async function reconcileGroups(deps, startedAt, limit) {
  const targets = await targetsOf(deps, startedAt);
  const cap = deps.siteCap;
  const byGroup = [];
  let queued = false;
  let limited = null;
  let stopped = false;
  const handOver = async (group, points) => {
    const waiting = await deps.state.heavy.get(group.key);
    if ((waiting?.stops ?? 0) >= HEAVY_STOPS_MAX && startedAt - waiting.at < HEAVY_RECONCILE_MS) return;
    if (await handOff(deps, group, points)) queued = true;
  };
  await withPass(deps, limit, () => pool(targets, REFRESH_CONCURRENCY, async ({ group, heavy }) => {
    if (limited || stopped) return;
    try {
      const cost = knownCost(await deps.cache.meta(group.key), null);
      if (cap && groupClass(cost, cap) === 'over') {
        byGroup.push([group.key, groupWrite(group, overLimit(group, cost, cap), deps.levels, false)]);
        return;
      }
      if (heavy) {
        await handOver(group);
        return;
      }
      const light = cap ? lightLimit(cap) : Infinity;
      byGroup.push([group.key, await deps.withDeadline(deps.now() + REFRESH_GROUP_BUDGET_MS, () => rewrite(deps, group, [], { compare: false, limit: light }))]);
    } catch (error) {
      if (isRateLimit(error)) {
        limited = error;
        return;
      }
      if (error?.name === 'PointsError' && error.scope === 'pass') {
        stopped = true;
        return;
      }
      if (error?.name === 'PointsError') {
        await handOver(group, { pts: error.spent, floor: true });
        return;
      }
      if (!isDeadline(error)) throw error;
      await handOver(group);
    }
  }));
  if (limited) throw limited;
  let changed = 0;
  if (byGroup.length && ((await deps.state.lastWrittenStart.get()) ?? 0) <= startedAt) {
    if (byGroup.some(([, r]) => r.updates.length)) await deps.state.lastWrittenStart.set(startedAt);
    changed = await writeGroups(deps, startedAt, byGroup);
    const skipped = new Set(targets.filter((t) => t.skipped).map((t) => t.group.key));
    for (const [key] of byGroup) if (skipped.has(key)) await deps.state.skip.clear(key);
  }
  return { groups: targets.length, changed, queued };
}

const withPass = (deps, limit, task) => (deps.withPoints ? deps.withPoints(limit, task, { scope: 'pass' }) : task()).catch((error) => {
  if (error?.name === 'PointsError' && error.scope === 'pass') return null;
  throw error;
});

async function reconcileOnce(deps) {
  const startedAt = deps.now();
  await restartJournal(deps, startedAt);
  const room = await reconcileRoom(deps, startedAt);
  const done = room.refused ? { groups: 0, changed: 0, queued: false } : await reconcileGroups(deps, startedAt, room.limit);
  if (done.queued || (await deps.state.heavy.oldest())) await pushQuietly(deps, { kind: 'heavy' });
  return { groups: done.groups, changed: done.changed, index: await deps.indexReconcile() };
}
