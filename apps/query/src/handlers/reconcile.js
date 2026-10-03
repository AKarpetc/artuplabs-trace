import { groupPrecomputations, reconcileTargets } from '../core/affected.js';
import { ACTIVE_MS, RECONCILE_MAX_GROUPS, RECONCILE_STALE_MS, RECONCILE_USED_MS, REFRESH_CONCURRENCY } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { rewrite } from './refresh.js';

/** Hourly safety net: recompute used groups that missed an event or depend on the clock, then fill index gaps. */
export async function onReconcile(deps) {
  const startedAt = deps.now();
  const groups = reconcileTargets(groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: ACTIVE_MS }), {
    now: startedAt, usedMs: RECONCILE_USED_MS, staleMs: RECONCILE_STALE_MS, max: RECONCILE_MAX_GROUPS,
  });
  const updates = [];
  await pool(groups, REFRESH_CONCURRENCY, async (group) => {
    updates.push(...(await rewrite(deps, group, [])));
  });
  let changed = 0;
  if (updates.length && ((await deps.state.lastWrittenStart.get()) ?? 0) <= startedAt) {
    await deps.state.lastWrittenStart.set(startedAt);
    await deps.jira.writePrecomputations(updates);
    changed = updates.length;
  }
  return { groups: groups.length, changed, index: await deps.indexReconcile() };
}
