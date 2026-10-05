import { parseArgs } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { LOG } from '../core/errors.js';
import { commentTimesWanted, REWRITE_ALL_KIND, familyWants, groupPrecomputations, needsRepair, queryOverlap, summarizeJournal, usedWithin } from '../core/affected.js';
import {
  ACTIVE_MS, FAILED_ROWS_KEEP_MS, REFRESH_USED_MS, JOURNAL_PAGE, JOURNAL_TS_DIGITS, LEASE_MS, MAX_TOUCHED, POINTS_OVERHEAD, RECONCILE_MAX, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS, REFRESH_RETRY_DELAY_S, TOUCHED_CHECK_MAX, VERIFY_DELAY_S, WORKER_BUDGET_MS,
} from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { handOff, isDeadline, isHeavy, knownCost, laneIdle, overLimit, pushQuietly, rewrite, runCompute, runHeavy, updatesFor, writeGroups } from './groups.js';
import { admit, groupClass, hourKey, laneRoom, lightLimit, retryAfter } from '../core/points.js';
import { brake, brakedUntil, isRateLimit, scheduleWake } from './brake.js';

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
  return jobs.filter((j) => !known.has(j.key)).map((j) => ({ key: j.key, functionName: j.functionName, family: FUNCTION_BY_NAME.get(j.functionName)?.family ?? 'query', userArgs: j.userArgs, items: [], job: j }));
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

/** Rows a pass reads: the journal page, or while a cut stands only its rows (a cut no row falls under is dropped and the page read as usual). */
async function rowsOf(deps) {
  const rows = await deps.journal.read(JOURNAL_PAGE);
  const cut = await deps.state.cut.get();
  if (!cut) return { rows, cut: null };
  const inCut = rows.filter((r) => r.key <= cut.key);
  if (inCut.length) return { rows: inCut, cut };
  await deps.state.cut.clear();
  return { rows, cut: null };
}

/** Writes the cut of a pass the points budget stopped: a new cut, or its own one; the cut of another pass only gets the groups it did. */
async function saveCut(deps, { key, startedAt, done }) {
  const cut = await deps.state.cut.get();
  const own = !cut || cut.startedAt === startedAt;
  const list = [...new Set([...(own ? [] : cut.done), ...done])];
  await deps.state.cut.set(own ? { key: cut?.key ?? key, startedAt, done: list } : { ...cut, done: list });
}

async function passRoom(deps, startedAt) {
  if (!deps.points) return { limit: Infinity };
  const { byLane } = await deps.points.siteSpent(hourKey(startedAt));
  if (!admit('refresh', POINTS_OVERHEAD, byLane, startedAt, deps.siteCap).ok) return { refused: retryAfter(startedAt) };
  return { limit: laneRoom('refresh', byLane, startedAt, deps.siteCap) };
}

const inScope = (deps, limit, task) => (deps.withPoints ? deps.withPoints(limit, task, { scope: 'pass' }) : task());

/**
 * One pass over a journal page: recompute stale groups (precomputations Jira used within REFRESH_USED_MS, every stored one after a rewrite of
 * all, and background jobs), each within its own deadline and, under a points budget, the light limit; hand slow or medium groups Jira used
 * within REFRESH_USED_MS to the heavy lane (a group without a known cost that passes the light limit goes there with what it spent as a lower
 * bound), give a group dearer than the group limit the error with its numbers, write changes, then drop the rows; rows stay when the write
 * fails, when a later pass wrote first, when the worker budget stopped a group, or (until FAILED_ROWS_KEEP_MS) when a group failed. When the
 * refresh lane's points run out the pass writes what it computed and cuts the journal (`q:cut`): later passes read only the rows of the cut,
 * skip its done groups, take the cheapest known groups first and drop its rows once every group is done. A 429 stops the pass: it writes nothing, keeps the rows and the cut and
 * returns `limited`.
 */
export async function refreshOnce(deps, { deadline = Infinity } = {}) {
  const startedAt = deps.now();
  const { rows, cut } = await rowsOf(deps);
  if (!rows.length) return null;
  const summary = summarizeJournal(rows);
  const lastKey = rows[rows.length - 1].key;
  const room = await passRoom(deps, startedAt);
  if (room.refused) {
    await saveCut(deps, { key: lastKey, startedAt, done: [] });
    return { budgeted: room.refused, events: rows.length, groups: 0, touched: [], kinds: summary.kinds, changed: 0, oldestEventMs: null };
  }
  const cap = deps.siteCap;
  const skip = new Set(cut?.done ?? []);
  const done = [];
  const byGroup = [];
  const counts = { recomputed: 0, handed: 0, failed: 0, postponed: 0, groups: 0 };
  let queued = false;
  let limited = null;
  let stopped = false;
  const names = { computed: [], handed: [] };
  const handOver = async (group, points) => {
    if (!usedWithin(group, startedAt, REFRESH_USED_MS)) return;
    counts.handed += 1;
    names.handed.push(group.functionName);
    if (await handOff(deps, group, points)) queued = true;
  };
  const reconcile = summary.touched.slice(0, RECONCILE_MAX);
  try {
    await inScope(deps, room.limit, async () => {
      const every = summary.kinds.includes(REWRITE_ALL_KIND);
      const stored = groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: every ? Infinity : ACTIVE_MS });
      const groups = every ? stored : stored.filter((g) => isUsed(g) && usedWithin(g, startedAt, REFRESH_USED_MS));
      const all = [...groups, ...jobGroups(await deps.state.jobs(startedAt), groups)].filter((g) => !skip.has(deps.hash(g.key)));
      counts.groups = all.length;
      const metas = new Map(cut ? await Promise.all(all.map(async (g) => [g.key, await deps.cache.meta(g.key)])) : []);
      const metaOf = async (g) => (metas.has(g.key) ? metas.get(g.key) : deps.cache.meta(g.key));
      const costOfGroup = (g) => knownCost(metas.get(g.key), g.job);
      const order = cut ? [...all].sort((a, b) => (costOfGroup(a)?.points ?? Infinity) - (costOfGroup(b)?.points ?? Infinity)) : all;
      await pool(order, REFRESH_CONCURRENCY, async (group) => {
        let cutByWorker = false;
        if (limited || stopped) return;
        try {
          if (!(await isStale(deps, group, summary))) {
            done.push(group.key);
            return;
          }
          const meta = await metaOf(group);
          const cost = knownCost(meta, group.job);
          if (cap && groupClass(cost, cap) === 'over') {
            byGroup.push([group.key, { updates: updatesFor(group, overLimit(group, cost, cap), deps.levels), entry: null }]);
            return;
          }
          if (await isHeavy(deps, group, meta)) {
            await handOver(group);
            done.push(group.key);
            return;
          }
          names.computed.push(`${group.functionName}@${usedHoursAgo(group, startedAt)}h`);
          const ownDeadline = deps.now() + REFRESH_GROUP_BUDGET_MS;
          cutByWorker = ownDeadline > deadline;
          const limit = cap ? lightLimit(cap) : Infinity;
          byGroup.push([group.key, await deps.withDeadline(Math.min(ownDeadline, deadline), () => rewrite(deps, group, reconcile, { limit }))]);
          counts.recomputed += 1;
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
            if (group.items.length) await handOver(group, { pts: error.spent, floor: true });
            else await deps.state.addJob({ ...group.job, pts: error.spent, floor: true });
            done.push(group.key);
            return;
          }
          if (isDeadline(error) && cutByWorker) {
            counts.postponed += 1;
            return;
          }
          if (isDeadline(error)) {
            await handOver(group);
            done.push(group.key);
            return;
          }
          counts.recomputed += 1;
          counts.failed += 1;
          const status = error?.name === 'JiraError' ? error.status : null;
          console.error(`refresh of ${group.functionName} failed: ${error?.name} ${status ?? ''}`);
          await deps.state.recordError({ at: deps.now(), functionName: group.functionName, message: LOG.refreshFailed(status) });
        } finally {
          await deps.state.lease.set(deps.now());
        }
      });
    });
  } catch (error) {
    if (error?.name !== 'PointsError' || error.scope !== 'pass') throw error;
    stopped = true;
  }
  const { recomputed, handed, failed, postponed } = counts;
  if (deps.logKvs?.requests) console.log(`refresh pass: ${counts.groups} groups, computed ${nameCounts(names.computed)}, handed ${nameCounts(names.handed)}${limited ? ', stopped by the rate limit' : ''}${stopped ? ', stopped by the points budget' : ''}`);
  if (limited) return { limited, events: rows.length, groups: counts.groups, touched: [], kinds: summary.kinds, changed: 0, oldestEventMs: null };
  if (queued || (handed && (await laneIdle(deps)))) await pushQuietly(deps, { kind: 'heavy' });
  let stale = false;
  let changed = 0;
  if (byGroup.length) {
    const anyUpdates = byGroup.some(([, r]) => r.updates.length);
    if (((await deps.state.lastWrittenStart.get()) ?? 0) > startedAt) stale = anyUpdates;
    else {
      if (anyUpdates) await deps.state.lastWrittenStart.set(startedAt);
      changed = await writeGroups(deps, startedAt, byGroup);
      done.push(...byGroup.map(([key]) => key));
    }
  }
  const doneHashes = done.map((key) => deps.hash(key));
  if (stopped) {
    await saveCut(deps, { key: lastKey, startedAt, done: doneHashes });
    return { budgeted: retryAfter(startedAt), events: rows.length, groups: counts.groups, recomputed, handed, changed, stale, failed, postponed, touched: [], kinds: summary.kinds, oldestEventMs: null };
  }
  const finished = !stale && !postponed;
  if (finished) await deps.journal.remove((failed ? rows.filter((r) => r.key < expiredBefore(startedAt)) : rows).map((r) => r.key));
  if (cut && finished && !failed) await deps.state.cut.clear();
  else if (cut) await saveCut(deps, { key: cut.key, startedAt, done: doneHashes });
  return {
    touched: summary.touched.slice(0, cut ? TOUCHED_CHECK_MAX : MAX_TOUCHED),
    kinds: summary.kinds,
    events: rows.length,
    all: summary.all,
    groups: counts.groups,
    recomputed,
    handed,
    changed,
    stale,
    failed,
    postponed,
    oldestEventMs: summary.firstAt === null ? null : startedAt - summary.firstAt,
  };
}

const usedHoursAgo = (group, now) => {
  const used = group.items.map((pc) => Date.parse(pc.used ?? '')).filter(Number.isFinite);
  return used.length ? Math.floor((now - Math.max(...used)) / 3600000) : '-';
};

const nameCounts = (list) => {
  const counts = new Map();
  for (const name of list) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts.size ? [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => `${name} ${n}`).join(', ') : 'none';
};

const expiredBefore = (now) => `t:${String(now - FAILED_ROWS_KEEP_MS).padStart(JOURNAL_TS_DIGITS, '0')}`;

/**
 * Queue consumer: a compute job, the heavy lane, a wake after a rate-limit pause, or refresh passes under a lease until the journal is
 * empty or the budget is spent; while the background waits for Jira's rate limit, refresh waits for the wake, and a 429 pauses it.
 */
export async function onRefresh(deps, event) {
  const body = event?.body ?? {};
  if (body.kind === 'compute') return runCompute(deps, body);
  if (body.kind === 'heavy') return runHeavy(deps);
  if (body.kind === 'wake') return onWake(deps);
  if (body.verify?.length) await deps.journal.append({ ids: body.verify, kinds: body.kinds ?? ['issue-updated'] }, deps.now());
  else await deps.state.pending.clear();
  return refreshPasses(deps, body);
}

/** Wake after a rate-limit pause: waits again while it lasts, else runs the journal first and then restarts the heavy lane. */
async function onWake(deps) {
  await deps.state.wake.clear();
  const until = await brakedUntil(deps);
  console.log(until ? `wake: background paused for ${Math.ceil((until - deps.now()) / 1000)} s more` : 'wake: running the journal');
  if (until) {
    await scheduleWake(deps, until);
    return { braked: until };
  }
  const result = await refreshPasses(deps, {});
  if (!result.braked && (await deps.state.heavy.oldest()) && (await laneIdle(deps))) await pushQuietly(deps, { kind: 'heavy' });
  return result;
}

/** Pushes verify jobs for the touched issues of the passes, in bodies of MAX_TOUCHED, at most TOUCHED_CHECK_MAX issues in all. */
async function pushVerify(deps, passes) {
  const verify = [...new Set(passes.flatMap((p) => p.touched))].slice(0, TOUCHED_CHECK_MAX);
  const kinds = [...new Set(passes.flatMap((p) => p.kinds))].sort();
  for (let i = 0; i < verify.length; i += MAX_TOUCHED) {
    await pushQuietly(deps, { kind: 'refresh', ts: deps.now(), verify: verify.slice(i, i + MAX_TOUCHED), kinds }, VERIFY_DELAY_S);
  }
}

async function refreshPasses(deps, body) {
  const until = await brakedUntil(deps);
  if (until) {
    await scheduleWake(deps, until);
    return { braked: until };
  }
  if (deps.now() - ((await deps.state.lease.get()) ?? 0) < LEASE_MS) return { busy: true };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  await deps.state.lease.set(deps.now());
  const passes = [];
  let limited = null;
  let budgeted = null;
  try {
    while (deps.now() < deadline) {
      const pass = await refreshOnce(deps, { deadline });
      if (!pass) break;
      if (pass.limited) {
        limited = pass.limited;
        break;
      }
      passes.push(pass);
      await deps.state.lease.set(deps.now());
      if (pass.budgeted) {
        budgeted = pass.budgeted;
        break;
      }
      if (pass.stale || pass.failed || pass.postponed) break;
    }
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    limited = error;
  } finally {
    await deps.state.lease.clear();
  }
  if (limited) {
    console.error('refresh stopped by the Jira rate limit');
    if (!body.verify) await pushVerify(deps, passes);
    await brake(deps, limited.retryAt);
    return { passes, braked: true };
  }
  const kept = passes.some((p) => p.stale || p.failed);
  if (budgeted) await scheduleWake(deps, budgeted);
  else if ((await deps.journal.read(1)).length && !(await deps.state.pending.get())) await pushRefresh(deps, deps.now(), kept ? REFRESH_RETRY_DELAY_S : undefined);
  if (!body.verify) await pushVerify(deps, passes);
  if (passes.length) {
    await deps.state.lastRefresh.set({ at: deps.now(), passes: passes.length, changed: passes.reduce((s, p) => s + p.changed, 0), oldestEventMs: Math.max(...passes.map((p) => p.oldestEventMs ?? 0)) });
  }
  return budgeted ? { passes, budgeted } : { passes };
}
