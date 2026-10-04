import { parseArgs } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { LOG } from '../core/errors.js';
import { commentTimesWanted, REWRITE_ALL_KIND, familyWants, groupPrecomputations, needsRepair, queryOverlap, summarizeJournal } from '../core/affected.js';
import {
  ACTIVE_MS, FAILED_ROWS_KEEP_MS, JOURNAL_PAGE, JOURNAL_TS_DIGITS, LEASE_MS, MAX_TOUCHED, RECONCILE_MAX, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS, REFRESH_RETRY_DELAY_S, VERIFY_DELAY_S, WORKER_BUDGET_MS,
} from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { handOff, isDeadline, isHeavy, laneIdle, pushQuietly, rewrite, runGroupJob, runHeavy, writeGroups } from './groups.js';

export { rewrite };

/** Marks a refresh as pending and pushes it (after `delay` seconds when given); a failed push clears the mark so the next event retries. */
export async function pushRefresh(deps, ts, delay) {
  await deps.state.pending.set(ts);
  try {
    await deps.queue.push({ kind: 'refresh', ts }, delay);
    return true;
  } catch (error) {
    await deps.state.pending.clear();
    console.error(`refresh push failed: ${error?.message}`);
    return false;
  }
}

const isUsed = (group) => group.items.some((pc) => pc.used);

function jobGroups(jobs, groups) {
  const known = new Set(groups.map((g) => g.key));
  return jobs.filter((j) => !known.has(j.key)).map((j) => ({ key: j.key, functionName: j.functionName, family: FUNCTION_BY_NAME.get(j.functionName)?.family ?? 'query', userArgs: j.userArgs, items: [] }));
}

/** Whether a group must be recomputed for this journal page: a query group when a touched issue is watched or now matches its subquery, checked in searches of RECONCILE_MAX. */
async function isStale(deps, group, summary) {
  if (summary.all || group.items.some(needsRepair)) return true;
  if (group.family !== 'query') return familyWants(group.family, summary.kinds);
  if (commentTimesWanted(group, summary.kinds)) return true;
  if (!summary.touched.length) return false;
  const parsed = parseArgs(group.functionName, group.userArgs);
  if (parsed.error) return false;
  const watched = await deps.cache.watchHit(group.key, summary.touched);
  if (watched) return true;
  const touched = new Set(summary.touched);
  const liveHits = [];
  try {
    for (let i = 0; i < summary.touched.length && !liveHits.length; i += RECONCILE_MAX) {
      const part = summary.touched.slice(i, i + RECONCILE_MAX);
      const hits = await deps.jira.searchIds(`(${parsed.args.subquery}) AND id in (${part.join(',')})`, { reconcile: part });
      liveHits.push(...hits.filter((id) => touched.has(String(id))));
    }
  } catch (error) {
    if (error?.name !== 'JiraError') throw error;
    return true;
  }
  return queryOverlap({ watched, liveHits });
}

/**
 * One pass over a journal page: recompute stale groups (precomputations Jira used, every stored one after a rewrite of all, and
 * background jobs), each within its own deadline,
 * hand slow groups to the heavy lane, write changes, then drop the rows; rows stay when the write fails, when a later pass wrote first,
 * when the worker budget stopped a group (it is not slow, so it stays out of the heavy lane and the next refresh computes it),
 * or (until FAILED_ROWS_KEEP_MS) when a group failed.
 */
export async function refreshOnce(deps, { deadline = Infinity } = {}) {
  const startedAt = deps.now();
  const rows = await deps.journal.read(JOURNAL_PAGE);
  if (!rows.length) return null;
  const summary = summarizeJournal(rows);
  const every = summary.kinds.includes(REWRITE_ALL_KIND);
  const stored = groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: every ? Infinity : ACTIVE_MS });
  const groups = every ? stored : stored.filter(isUsed);
  const all = [...groups, ...jobGroups(await deps.state.jobs(startedAt), groups)];
  const reconcile = summary.touched.slice(0, RECONCILE_MAX);
  const byGroup = [];
  let recomputed = 0;
  let handed = 0;
  let queued = false;
  let failed = 0;
  let postponed = 0;
  const handOver = async (group) => {
    handed += 1;
    if (await handOff(deps, group)) queued = true;
  };
  await pool(all, REFRESH_CONCURRENCY, async (group) => {
    let cutByWorker = false;
    try {
      if (!(await isStale(deps, group, summary))) return;
      if (await isHeavy(deps, group)) {
        await handOver(group);
        return;
      }
      const ownDeadline = deps.now() + REFRESH_GROUP_BUDGET_MS;
      cutByWorker = ownDeadline > deadline;
      byGroup.push([group.key, await deps.withDeadline(Math.min(ownDeadline, deadline), () => rewrite(deps, group, reconcile))]);
      recomputed += 1;
    } catch (error) {
      if (isDeadline(error) && cutByWorker) {
        postponed += 1;
        return;
      }
      if (isDeadline(error)) {
        await handOver(group);
        return;
      }
      recomputed += 1;
      failed += 1;
      const status = error?.name === 'JiraError' ? error.status : null;
      console.error(`refresh of ${group.functionName} failed: ${error?.name} ${status ?? ''}`);
      await deps.state.recordError({ at: deps.now(), functionName: group.functionName, message: LOG.refreshFailed(status) });
    }
  });
  if (queued || (handed && (await laneIdle(deps)))) await pushQuietly(deps, { kind: 'heavy' });
  let stale = false;
  let changed = 0;
  if (byGroup.length) {
    const anyUpdates = byGroup.some(([, r]) => r.updates.length);
    if (((await deps.state.lastWrittenStart.get()) ?? 0) > startedAt) stale = anyUpdates;
    else {
      if (anyUpdates) await deps.state.lastWrittenStart.set(startedAt);
      changed = await writeGroups(deps, startedAt, byGroup);
    }
  }
  if (!stale && !postponed) await deps.journal.remove((failed ? rows.filter((r) => r.key < expiredBefore(startedAt)) : rows).map((r) => r.key));
  return {
    touched: summary.touched.slice(0, MAX_TOUCHED),
    kinds: summary.kinds,
    events: rows.length,
    all: summary.all,
    groups: all.length,
    recomputed,
    handed,
    changed,
    stale,
    failed,
    postponed,
    oldestEventMs: summary.firstAt === null ? null : startedAt - summary.firstAt,
  };
}

const expiredBefore = (now) => `t:${String(now - FAILED_ROWS_KEEP_MS).padStart(JOURNAL_TS_DIGITS, '0')}`;

/** Queue consumer: a compute job, the heavy lane, or refresh passes under a lease until the journal is empty or the budget is spent. */
export async function onRefresh(deps, event) {
  const body = event?.body ?? {};
  if (body.kind === 'compute') return runGroupJob(deps, body);
  if (body.kind === 'heavy') return runHeavy(deps);
  if (body.verify?.length) await deps.journal.append({ ids: body.verify, kinds: body.kinds ?? ['issue-updated'] }, deps.now());
  else await deps.state.pending.clear();
  if (deps.now() - ((await deps.state.lease.get()) ?? 0) < LEASE_MS) return { busy: true };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  await deps.state.lease.set(deps.now());
  const passes = [];
  try {
    while (deps.now() < deadline) {
      const pass = await refreshOnce(deps, { deadline });
      if (!pass) break;
      passes.push(pass);
      await deps.state.lease.set(deps.now());
      if (pass.stale || pass.failed || pass.postponed) break;
    }
  } finally {
    await deps.state.lease.clear();
  }
  const kept = passes.some((p) => p.stale || p.failed);
  if ((await deps.journal.read(1)).length && !(await deps.state.pending.get())) await pushRefresh(deps, deps.now(), kept ? REFRESH_RETRY_DELAY_S : undefined);
  const verify = [...new Set(passes.flatMap((p) => p.touched))].slice(0, MAX_TOUCHED);
  if (!body.verify && verify.length) {
    await pushQuietly(deps, { kind: 'refresh', ts: deps.now(), verify, kinds: [...new Set(passes.flatMap((p) => p.kinds))].sort() }, VERIFY_DELAY_S);
  }
  if (passes.length) {
    await deps.state.lastRefresh.set({ at: deps.now(), passes: passes.length, changed: passes.reduce((s, p) => s + p.changed, 0), oldestEventMs: Math.max(...passes.map((p) => p.oldestEventMs ?? 0)) });
  }
  return { passes };
}
