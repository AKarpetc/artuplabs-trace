import { parseArgs } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { LOG } from '../core/errors.js';
import { commentTimesWanted, REWRITE_ALL_KIND, familyWants, groupPrecomputations, needsRepair, pricedOut, queryOverlap, summarizeJournal, usedWithin } from '../core/affected.js';
import {
  ACTIVE_MS, REFRESH_USED_MS, JOURNAL_PAGE, LEASE_MS, MAX_TOUCHED, RECONCILE_MAX, REFRESH_CONCURRENCY, REFRESH_GROUP_BUDGET_MS, REFRESH_RETRY_DELAY_S, TOUCHED_CHECK_MAX, VERIFY_DELAY_S, WORKER_BUDGET_MS,
} from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { keptPoints } from '../infra/state.js';
import { handOff, isDeadline, isHeavy, knownCost, laneIdle, listPrecomputations, overLimit, pushQuietly, rewrite, runCompute, runHeavy, groupWrite, writeGroups } from './groups.js';
import { groupClass, hourKey, lightLimit, passInterval, retryAfter } from '../core/points.js';
import { claimRoom, stepCap } from './budget.js';
import { brake, brakedUntil, isRateLimit, scheduleWake } from './brake.js';
import { backgroundAllowed } from './licence.js';

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

/** Whether the changes may make a group outside the used window stale: a query group on any touched issue, another on the kinds it wants. */
const skipWanted = (group, summary) => summary.all
  || (group.family === 'query' ? summary.touched.length > 0 || commentTimesWanted(group, summary.kinds) : familyWants(group.family, summary.kinds));

function jobGroups(jobs, groups) {
  const known = new Set(groups.map((g) => g.key));
  return jobs.filter((j) => !known.has(j.key)).map((j) => ({ key: j.key, functionName: j.functionName, family: FUNCTION_BY_NAME.get(j.functionName)?.family ?? 'query', userArgs: j.userArgs, items: [], job: j }));
}

/** Whether a group must be recomputed for this journal page: a query group when a touched issue is watched or now matches its subquery, checked in searches of RECONCILE_MAX. */
async function isStale(deps, group, summary) {
  if (pricedOut(group)) return false;
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

/**
 * Writes the cut of a pass the points budget stopped: a new cut, or its own one; the cut of another pass only gets the groups it did when
 * that cut covers no row past the ones the pass read; an unchanged cut is not written again.
 */
async function saveCut(deps, { key, startedAt, done, under = null }) {
  const cut = await deps.state.cut.get();
  const own = !cut || cut.startedAt === startedAt;
  if (!own && under !== cut.key && key < cut.key) return null;
  const list = [...new Set([...(cut?.done ?? []), ...done])];
  const next = own ? { key: cut?.key ?? key, startedAt, done: list } : { ...cut, done: list };
  if (cut && JSON.stringify(next) === JSON.stringify(cut)) return next;
  await deps.state.cut.set(next);
  return next;
}

const minuteText = (at) => `${new Date(at).toISOString().slice(11, 16)}Z`;

/** Logs the cut a stopped pass left, by its done count and the pass rows under its key (no values), when requests are logged. */
function logCut(deps, cut, rows) {
  if (!cut || !deps.logKvs?.requests) return;
  console.log(`refresh cut: done ${cut.done.length}, rows ${rows.filter((r) => r.key <= cut.key).length} under its key`);
}

async function passRoom(deps, startedAt) {
  if (!deps.points) return { limit: Infinity };
  const room = await claimRoom(deps, 'refresh', { most: stepCap(deps, 'refresh') });
  if (!room.waitUntil) return room;
  const { byLane, total } = await deps.points.siteSpent(hourKey(startedAt));
  return { refused: room.waitUntil, spent: byLane.refresh ?? 0, total };
}

const inScope = (deps, limit, task) => (deps.withPoints ? deps.withPoints(limit, task, { scope: 'pass' }) : task());

/**
 * One pass over a journal page within the refresh points: stale light groups are recomputed and written, others go to the heavy lane, the
 * error or a skip mark; a pass the points stop writes what it computed and cuts the journal (`q:cut`), a 429 writes nothing (`limited`).
 */
export async function refreshOnce(deps, { deadline = Infinity } = {}) {
  const startedAt = deps.now();
  const { rows, cut } = await rowsOf(deps);
  if (!rows.length) return null;
  const summary = summarizeJournal(rows);
  const lastKey = rows[rows.length - 1].key;
  const room = await passRoom(deps, startedAt);
  if (room.refused) {
    if (deps.logKvs?.requests) console.log(`refresh pass refused by the points budget: refresh ${room.spent}, site ${room.total}, rows ${rows.length}, retry ${minuteText(room.refused)}`);
    logCut(deps, await saveCut(deps, { key: lastKey, startedAt, done: [], under: cut?.key ?? null }), rows);
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
  const spent = { pass: 0, runs: 0 };
  const names = { computed: [], handed: [], used: [] };
  const measured = (task) => (deps.withPoints ? deps.withPoints(Infinity, async () => {
    try {
      return await task();
    } finally {
      spent.runs += deps.currentPoints().spent;
    }
  }, { scope: 'run' }) : task());
  const markSkip = async (group) => {
    if (!(await deps.state.skip.get(group.key))) await deps.state.skip.set(group.key, startedAt);
  };
  const handOver = async (group, points, extra) => {
    if (!usedWithin(group, startedAt, REFRESH_USED_MS)) {
      await markSkip(group);
      return;
    }
    counts.handed += 1;
    names.handed.push(group.functionName);
    if (await handOff(deps, group, points, extra)) queued = true;
  };
  const reconcile = summary.touched.slice(0, RECONCILE_MAX);
  try {
    await inScope(deps, room.limit, async () => {
      const every = summary.kinds.includes(REWRITE_ALL_KIND);
      const stored = groupPrecomputations(await listPrecomputations(deps, { full: measured }), { now: startedAt, activeMs: every ? Infinity : ACTIVE_MS });
      const inWindow = (g) => isUsed(g) && usedWithin(g, startedAt, REFRESH_USED_MS);
      const groups = every ? stored : stored.filter(inWindow);
      if (!every) for (const g of stored.filter((x) => !inWindow(x) && skipWanted(x, summary))) await markSkip(g);
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
            byGroup.push([group.key, groupWrite(group, overLimit(group, cost, cap), deps.levels)]);
            return;
          }
          if (await isHeavy(deps, group, meta)) {
            await handOver(group, keptPoints(group.job));
            done.push(group.key);
            return;
          }
          names.computed.push(`${group.functionName}@${usedHoursAgo(group, startedAt)}h`);
          names.used.push(`${group.functionName} ${lastUsed(group)}`);
          const ownDeadline = deps.now() + REFRESH_GROUP_BUDGET_MS;
          cutByWorker = ownDeadline > deadline;
          const limit = cap ? lightLimit(cap) : Infinity;
          byGroup.push([group.key, await deps.withDeadline(Math.min(ownDeadline, deadline), () => measured(() => rewrite(deps, group, reconcile, { limit })))]);
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
            await handOver(group, { pts: Math.max(error.spent, group.job?.pts ?? 0), floor: true, floorAt: deps.now() });
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
          await recordQuietly(deps, group.functionName, LOG.refreshFailed(status));
          if (((await deps.state.skip.get(group.key)) ?? Infinity) > startedAt) await deps.state.skip.set(group.key, startedAt);
          await handOver(group, {}, { retry: true, notBefore: startedAt + REFRESH_RETRY_DELAY_S * 1000 });
          done.push(group.key);
        } finally {
          await deps.state.lease.set(deps.now());
        }
      });
      spent.pass = deps.currentPoints?.()?.spent ?? 0;
    });
  } catch (error) {
    if (error?.name !== 'PointsError' || error.scope !== 'pass') throw error;
    stopped = true;
  } finally {
    room.release?.();
  }
  const { recomputed, handed, failed, postponed } = counts;
  const overhead = Math.max(0, spent.pass - spent.runs);
  if (deps.logKvs?.requests && names.used.length) console.log(`refresh used: ${names.used.join(', ')}`);
  if (deps.logKvs?.requests) console.log(`refresh pass: ${counts.groups} groups, computed ${nameCounts(names.computed)}, handed ${nameCounts(names.handed)}${limited ? ', stopped by the rate limit' : ''}${stopped ? ', stopped by the points budget' : ''}, overhead ${overhead}`);
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
    logCut(deps, await saveCut(deps, { key: lastKey, startedAt, done: doneHashes, under: cut?.key ?? null }), rows);
    if (room.capped) return { capped: true, events: rows.length, groups: counts.groups, recomputed, handed, changed, stale, failed, postponed, touched: [], kinds: summary.kinds, oldestEventMs: null, overhead };
    return { budgeted: retryAfter(startedAt), events: rows.length, groups: counts.groups, recomputed, handed, changed, stale, failed, postponed, touched: [], kinds: summary.kinds, oldestEventMs: null, overhead };
  }
  const finished = !stale && !postponed;
  if (finished) await deps.journal.remove(rows.map((r) => r.key));
  if (cut && finished) await deps.state.cut.clear();
  else if (cut) await saveCut(deps, { key: cut.key, startedAt, done: doneHashes, under: cut.key });
  return {
    touched: summary.touched.slice(0, TOUCHED_CHECK_MAX),
    cutFinished: Boolean(cut && finished),
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
    overhead,
    oldestEventMs: summary.firstAt === null ? null : startedAt - summary.firstAt,
  };
}

/** Adds a line to the error log; a failed write is logged without values and the pass goes on. */
async function recordQuietly(deps, functionName, message) {
  try {
    await deps.state.recordError({ at: deps.now(), functionName, message });
  } catch (error) {
    console.error(`${functionName} error log failed: ${error?.name}`);
  }
}

/** The latest `used` Jira reports for a group's precomputations, as Jira wrote it, or '-' without one. */
const lastUsed = (group) => group.items.map((pc) => pc.used).filter(Boolean).sort().pop() ?? '-';

const usedHoursAgo = (group, now) => {
  const used = group.items.map((pc) => Date.parse(pc.used ?? '')).filter(Number.isFinite);
  return used.length ? Math.floor((now - Math.max(...used)) / 3600000) : '-';
};

const nameCounts = (list) => {
  const counts = new Map();
  for (const name of list) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts.size ? [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => `${name} ${n}`).join(', ') : 'none';
};


/**
 * Queue consumer: a compute job, the heavy lane, a wake after a rate-limit pause, or refresh passes under a lease until the journal is
 * empty or the budget is spent; while the background waits for Jira's rate limit, refresh waits for the wake, and a 429 pauses it; nothing
 * runs under an inactive licence.
 */
export async function onRefresh(deps, event, context) {
  if (!(await backgroundAllowed(deps, context))) return { unlicensed: true };
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

/** The end of the pause the last passes set by their overhead (`log:refresh`), or null once it has passed. */
async function pauseAfterLastPass(deps) {
  const last = await deps.state.lastRefresh.get();
  const end = last?.interval ? last.at + last.interval * 1000 : 0;
  return end > deps.now() ? end : null;
}

/** Passes whose touched issues get a verify job: every pass, or inside a verify job only a pass that finished a cut. */
const toVerify = (body, passes) => (body.verify ? passes.filter((p) => p.cutFinished) : passes);

async function refreshPasses(deps, body) {
  const until = await brakedUntil(deps);
  if (until) {
    await scheduleWake(deps, until);
    return { braked: until };
  }
  const pauseEnd = await pauseAfterLastPass(deps);
  if (pauseEnd) {
    if (!(await deps.state.pending.get())) await pushRefresh(deps, deps.now(), Math.ceil((pauseEnd - deps.now()) / 1000));
    return { debounced: pauseEnd };
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
      if (pass.stale || pass.postponed) break;
    }
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    limited = error;
  } finally {
    await deps.state.lease.clear();
  }
  if (limited) {
    console.error('refresh stopped by the Jira rate limit');
    await pushVerify(deps, toVerify(body, passes));
    await brake(deps, limited.retryAt);
    return { passes, braked: true };
  }
  const kept = passes.some((p) => p.stale);
  if (budgeted) await scheduleWake(deps, budgeted);
  else if ((await deps.journal.read(1)).length && !(await deps.state.pending.get())) await pushRefresh(deps, deps.now(), kept ? REFRESH_RETRY_DELAY_S : undefined);
  await pushVerify(deps, toVerify(body, passes));
  if (passes.length) {
    const overhead = passes[passes.length - 1].overhead ?? 0;
    const interval = deps.siteCap ? passInterval(overhead, deps.siteCap) : null;
    if (deps.logKvs?.requests && interval !== null) console.log(`refresh interval ${interval} s after overhead ${overhead}`);
    await deps.state.lastRefresh.set({
      at: deps.now(),
      passes: passes.length,
      changed: passes.reduce((s, p) => s + p.changed, 0),
      oldestEventMs: Math.max(...passes.map((p) => p.oldestEventMs ?? 0)),
      overhead,
      ...(interval === null ? {} : { interval }),
    });
  }
  return budgeted ? { passes, budgeted } : { passes };
}
