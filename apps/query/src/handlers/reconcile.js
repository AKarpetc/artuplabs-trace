import { groupPrecomputations, reconcileTargets } from '../core/affected.js';
import { ACTIVE_MS, RECONCILE_MAX_GROUPS, RECONCILE_STALE_MS, RECONCILE_USED_MS, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { handOff, isDeadline, isHeavy, pushQuietly, rewrite, writeGroups } from './groups.js';

/** Hourly safety net: recompute used groups that missed an event, depend on the clock or need repair (slow ones go to the heavy lane), restart a stalled heavy lane, then fill index gaps. */
export async function onReconcile(deps) {
  const startedAt = deps.now();
  const groups = reconcileTargets(groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: ACTIVE_MS }), {
    now: startedAt, usedMs: RECONCILE_USED_MS, staleMs: RECONCILE_STALE_MS, max: RECONCILE_MAX_GROUPS,
  });
  const byGroup = [];
  let queued = false;
  const handOver = async (group) => {
    if (await handOff(deps, group)) queued = true;
  };
  await pool(groups, REFRESH_CONCURRENCY, async (group) => {
    try {
      if (await isHeavy(deps, group)) {
        await handOver(group);
        return;
      }
      byGroup.push([group.key, await deps.withDeadline(deps.now() + REFRESH_GROUP_BUDGET_MS, () => rewrite(deps, group, []))]);
    } catch (error) {
      if (!isDeadline(error)) throw error;
      await handOver(group);
    }
  });
  let changed = 0;
  if (byGroup.length && ((await deps.state.lastWrittenStart.get()) ?? 0) <= startedAt) {
    if (byGroup.some(([, r]) => r.updates.length)) await deps.state.lastWrittenStart.set(startedAt);
    changed = await writeGroups(deps, startedAt, byGroup);
  }
  if (queued || (await deps.state.heavy.oldest())) await pushQuietly(deps, { kind: 'heavy' });
  return { groups: groups.length, changed, index: await deps.indexReconcile() };
}
