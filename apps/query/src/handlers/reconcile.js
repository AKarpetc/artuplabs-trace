import { groupPrecomputations, reconcileTargets, rewriteDue } from '../core/affected.js';
import { LOG } from '../core/errors.js';
import { admit, groupClass, hourKey, laneRoom, lightLimit } from '../core/points.js';
import { ACTIVE_MS, HEAVY_RECONCILE_MS, LEASE_MS, PENDING_STALE_MS, RECONCILE_MAX_GROUPS, RECONCILE_STALE_MS, RECONCILE_USED_MS, POINTS_OVERHEAD, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS } from '../core/limits.js';
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
 * Hourly safety net: restarts the journal, rewrites due, skipped or failed groups within the reconcile points (heavy ones via the lane),
 * restarts the lane and checks the index; it waits while the background is paused, and a 429 pauses it.
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
  if (!admit('reconcile', POINTS_OVERHEAD, byLane, at, deps.siteCap).ok) return { refused: true, limit: 0 };
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
  let targets = [];
  let spent = 0;
  const cap = deps.siteCap;
  const byGroup = [];
  let queued = false;
  let limited = null;
  let stopped = false;
  const handOver = async (group, points, extra) => {
    if (await handOff(deps, group, points, extra)) queued = true;
  };
  const visit = async ({ group, heavy }) => {
    if (limited || stopped) return;
    try {
      const cost = knownCost(await deps.cache.meta(group.key), null);
      if (cap && groupClass(cost, cap) === 'over') {
        byGroup.push([group.key, groupWrite(group, overLimit(group, cost, cap), deps.levels, false)]);
        return;
      }
      if (heavy) {
        await handOver(group, {}, { force: true });
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
      if (!isDeadline(error)) {
        const status = error?.name === 'JiraError' ? error.status : null;
        console.error(`reconcile of ${group.functionName} failed: ${error?.name} ${status ?? ''}`);
        await deps.state.recordError({ at: deps.now(), functionName: group.functionName, message: LOG.refreshFailed(status) });
      }
      await handOver(group, {}, { force: true });
    }
  };
  await withPass(deps, limit, async () => {
    try {
      targets = await targetsOf(deps, startedAt);
      await pool(targets, REFRESH_CONCURRENCY, visit);
    } finally {
      spent = deps.currentPoints?.()?.spent ?? 0;
    }
  });
  if (limited) throw limited;
  let changed = 0;
  if (byGroup.length && ((await deps.state.lastWrittenStart.get()) ?? 0) <= startedAt) {
    if (byGroup.some(([, r]) => r.updates.length)) await deps.state.lastWrittenStart.set(startedAt);
    changed = await writeGroups(deps, startedAt, byGroup);
    const skipped = new Set(targets.filter((t) => t.skipped).map((t) => t.group.key));
    for (const [key] of byGroup) if (skipped.has(key)) await deps.state.skip.clear(key);
  }
  return { groups: targets.length, changed, queued, spent };
}

const withPass = (deps, limit, task) => (deps.withPoints ? deps.withPoints(limit, task, { scope: 'pass' }) : task()).catch((error) => {
  if (error?.name === 'PointsError' && error.scope === 'pass') return null;
  throw error;
});

async function reconcileOnce(deps) {
  const startedAt = deps.now();
  await restartJournal(deps, startedAt);
  const room = await reconcileRoom(deps, startedAt);
  const done = room.refused ? { groups: 0, changed: 0, queued: false, spent: 0 } : await reconcileGroups(deps, startedAt, room.limit);
  if (done.queued || (await deps.state.heavy.oldest())) await pushQuietly(deps, { kind: 'heavy' });
  const index = room.limit === Infinity || !deps.withPoints ? await deps.indexReconcile() : await deps.withPoints(Math.max(0, room.limit - done.spent), () => deps.indexReconcile(), { scope: 'pass' });
  return { groups: done.groups, changed: done.changed, index };
}
