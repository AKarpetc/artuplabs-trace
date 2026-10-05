import { groupKey, parseArgs, splitPage } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { ERR, LOG } from '../core/errors.js';
import { groupPrecomputations, usedWithin } from '../core/affected.js';
import { forOperator } from '../core/jql-build.js';
import { ACTIVE_MS, HEAVY_ATTEMPTS, HEAVY_LEASE_MS, HEAVY_MIN_INTERVAL_MS, HEAVY_QUEUED_STALE_MS, HEAVY_WAIT_MAX_MS, REFRESH_RETRY_DELAY_S, REFRESH_USED_MS, PAGE_CACHE_MS, REFRESH_GROUP_BUDGET_MS, WORKER_BUDGET_MS } from '../core/limits.js';
import { computeGroup, costOf, fragmentFor, rejectedByJira } from './functions.js';
import { admit, groupClass, groupLimit, HOUR_MS, knownCost, hourKey, issuesWithin, laneRoom, lightLimit, retryAfter } from '../core/points.js';
import { keptPoints } from '../infra/state.js';
import { brake, brakedUntil, isRateLimit, scheduleWake } from './brake.js';

/** Whether a computation stopped because it ran past its deadline. */
export const isDeadline = (error) => error?.name === 'DeadlineError';

/** Pushes a queue body; a refused push is logged, never thrown (the next event, pass or reconcile pushes again). */
export async function pushQuietly(deps, body, delay) {
  try {
    await deps.queue.push(body, delay);
    return true;
  } catch (error) {
    console.error(`${body.kind} push failed: ${error?.message}`);
    return false;
  }
}

async function keepJob(deps, functionName, userArgs, result) {
  if (result.ids) await deps.state.addJob({ key: groupKey(functionName, userArgs), functionName, userArgs, at: deps.now() });
}

async function recompute(deps, group, reconcile, source, limit = Infinity) {
  const parsed = parseArgs(group.functionName, group.userArgs);
  const gate = parsed.error ? null : await deps.ready(group.functionName);
  if (parsed.error || gate) return { error: parsed.error ?? gate };
  return computeGroup(deps, group.functionName, parsed.args, group.userArgs, { reconcile, source, keep: false, limit });
}

async function keepEntry(deps, key, result) {
  if (result.entry) await deps.cache.write(key, result.entry);
}

const listed = (pc) => pc.hasValue !== undefined;
const clean = (pc) => pc.hasValue && pc.errorKind === null;

/** Updates of a group's precomputations in the form of each operator: all of them for records of the cached list, else only the changed ones. */
export function updatesFor(group, result, levels) {
  if (group.items.length && group.items.every(listed)) return listedUpdates(group, result, levels);
  const updates = [];
  for (const pc of group.items) {
    const { page } = splitPage(pc.arguments);
    const fragment = fragmentFor(group.functionName, group.userArgs, page, result, levels);
    const r = fragment.error ? fragment : { jql: forOperator(fragment.jql, pc.operator) };
    const storedError = pc.error ?? null;
    if ((r.jql ?? null) === (pc.value ?? null) && (r.error ?? null) === storedError) continue;
    if (r.error) updates.push({ id: pc.id, error: r.error });
    else updates.push(storedError === null ? { id: pc.id, value: r.jql } : { id: pc.id, value: r.jql, error: null });
  }
  return updates;
}

function listedUpdates(group, result, levels) {
  return group.items.map((pc) => {
    const { page } = splitPage(pc.arguments);
    const fragment = fragmentFor(group.functionName, group.userArgs, page, result, levels);
    if (fragment.error) return { id: pc.id, error: fragment.error };
    const value = forOperator(fragment.jql, pc.operator);
    return pc.errorKind === null ? { id: pc.id, value } : { id: pc.id, value, error: null };
  });
}

/** Whether the writes of a group may be skipped when its current meta, written after all its precomputations, holds the same value. */
const mayKeep = (group, result) => Boolean(result.entry) && !result.error && group.items.length > 0 && group.items.every((pc) => listed(pc) && clean(pc));

/** A group's write: its updates, the cache entry (marked posted, as it is stored once all its precomputations are written) and whether it may be kept. */
export const groupWrite = (group, result, levels, compare = true) => ({
  updates: updatesFor(group, result, levels),
  entry: result.entry ? { ...result.entry, posted: true } : null,
  keepIfSame: compare && mayKeep(group, result),
});

/**
 * Recomputes one group within `limit` Jira points: its precomputation updates and the cache entry to store after they are written (a group
 * without precomputations is a background job, cached at once). Staleness is judged against the cache, so the cache must never run ahead of
 * what Jira stores.
 */
export async function rewrite(deps, group, reconcile, { limit = Infinity, compare = true } = {}) {
  const result = await recompute(deps, group, reconcile, group.items.length ? 'refresh' : 'job', limit);
  if (!group.items.length) {
    await keepEntry(deps, group.key, result);
    await keepJob(deps, group.functionName, group.userArgs, result);
    return { updates: [], entry: null };
  }
  return groupWrite(group, result, deps.levels, compare);
}

/** The precomputation list: the cached one when the dependencies keep it, else Jira's own. */
export const listPrecomputations = (deps) => (deps.pcList?.list ? deps.pcList.list() : deps.jira.precomputations());

/**
 * Writes each group a later computation has not written (skipping one whose current posted meta holds the same value) and then its cache
 * entry; returns how many updates were written.
 */
export async function writeGroups(deps, startedAt, byGroup) {
  const out = [];
  const entries = [];
  for (const [key, { updates, entry, keepIfSame }] of byGroup) {
    if (!updates.length && !entry) continue;
    if (((await deps.state.groupWrite.get(key)) ?? 0) > startedAt) continue;
    await deps.state.groupWrite.set(key, startedAt);
    const current = keepIfSame ? await deps.cache.meta(key) : null;
    if (!(current?.posted && deps.cache.matches(current, entry))) out.push(...updates);
    if (entry) entries.push([key, entry]);
  }
  if (out.length) await deps.jira.writePrecomputations(out);
  for (const [key, entry] of entries) await deps.cache.write(key, entry);
  return out.length;
}

export { knownCost };

/**
 * Whether a group belongs to the heavy lane: it waits there, or its last computation took longer than a refresh pass may spend on it, or
 * (under a points budget) cost, or a stopped background job of it spent, more than a light group may; `meta` is its cache meta when the caller
 * has read it.
 */
export async function isHeavy(deps, group, meta) {
  if (await deps.state.heavy.get(group.key)) return true;
  const m = meta === undefined ? await deps.cache.meta(group.key) : meta;
  if ((m?.ms ?? 0) >= REFRESH_GROUP_BUDGET_MS) return true;
  return Boolean(deps.siteCap) && groupClass(knownCost(m, group.job ?? null), deps.siteCap) === 'medium';
}


/** The result of a group dearer than the group limit: the error with its numbers, which its precomputations store. */
export function overLimit(group, cost, cap) {
  return { error: ERR.tooExpensive(group.functionName, { n: null, points: cost.points, limit: groupLimit(cap), floor: cost.floor }), log: LOG.tooExpensive() };
}

/**
 * Queues a group in the heavy lane, once: an entry that is waiting will start after this call, so it sees every change made before it;
 * an entry whose run already started is replaced, so the group runs again, keeping the points it spent (`pts`, `floor`) unless `points` names
 * new ones. True when it queued, and the caller then pushes one runner.
 */
export async function handOff(deps, group, points = {}, extra = {}) {
  const waiting = await deps.state.heavy.get(group.key);
  if (waiting && !waiting.runningSince && deps.now() - waiting.at < HEAVY_QUEUED_STALE_MS) return false;
  const kept = points.pts === undefined ? keptPoints(waiting) : keptPoints(points);
  const history = { since: waiting?.since ?? waiting?.at ?? deps.now(), ...(waiting?.stops ? { stops: waiting.stops } : {}) };
  await deps.state.heavy.put({ key: group.key, functionName: group.functionName, userArgs: group.userArgs, at: deps.now(), ...history, ...kept, ...extra });
  return true;
}

/**
 * Computes one group within the worker budget and `limit` Jira points and writes its precomputations (clearing a stored Computing error); a
 * group still without precomputations stays a background job; `group` is its precomputation group when the caller has the list (null: none).
 */
export async function runGroupJob(deps, { functionName, userArgs }, { limit = Infinity, group: known, compare = true } = {}) {
  const startedAt = deps.now();
  const parsed = parseArgs(functionName, userArgs);
  if (parsed.error) return { error: parsed.error };
  const key = groupKey(functionName, parsed.userArgs);
  const bare = { key, functionName, family: FUNCTION_BY_NAME.get(functionName)?.family ?? 'query', userArgs: parsed.userArgs, items: [] };
  let result;
  try {
    result = await deps.withDeadline(startedAt + WORKER_BUDGET_MS, () => recompute(deps, bare, [], 'job', limit));
  } catch (error) {
    if (!isDeadline(error)) throw error;
    console.error(`${functionName} ran out of time`);
    await deps.state.recordError({ at: deps.now(), functionName, message: LOG.refreshTimedOut() });
    return { computed: key, timedOut: true };
  }
  const group = known !== undefined ? known : groupPrecomputations(await listPrecomputations(deps), { now: deps.now(), activeMs: ACTIVE_MS }).find((g) => g.key === key);
  if (!group) {
    await keepEntry(deps, key, result);
    await keepJob(deps, functionName, parsed.userArgs, result);
    return { computed: key, changed: 0 };
  }
  return { computed: key, changed: await writeGroups(deps, startedAt, [[key, groupWrite(group, result, deps.levels, compare)]]) };
}

/**
 * Queue job of a deferred function call, spent from the function lane: dropped while the background waits for Jira's rate limit and when no
 * function call asked for the group within PAGE_CACHE_MS (the next call asks again), and when the lane cannot hold it now or it is dearer than
 * the group limit (nothing queues it again: the next function call or journal pass picks it up); a subquery Jira rejects ends with its error;
 * a stop by the points budget keeps what it spent as a lower bound (the group limit, when that stopped it), and a 429 pauses the background
 * instead of failing, so the queue does not retry it.
 */
export async function runCompute(deps, body) {
  const until = await brakedUntil(deps);
  if (until) return { braked: until };
  const parsed = parseArgs(body.functionName, body.userArgs);
  const key = parsed.error ? null : groupKey(body.functionName, parsed.userArgs);
  const job = key ? await deps.state.job(key) : null;
  if (key && !(job && deps.now() - job.at < PAGE_CACHE_MS)) return { skipped: key };
  let budget = { limit: Infinity };
  try {
    if (key) budget = await deps.withDeadline(deps.now() + WORKER_BUDGET_MS, () => jobBudget(deps, body.functionName, parsed.args, key, job));
    if (budget.waitUntil) return { computed: key, waitUntil: budget.waitUntil };
    if (budget.tooExpensive) return { computed: key, tooExpensive: true };
    return await runGroupJob(deps, body, { limit: budget.limit });
  } catch (error) {
    const rejected = rejectedByJira(body.functionName, error);
    if (rejected) return { computed: key, error: rejected.error };
    if (isDeadline(error)) return { computed: key, timedOut: true };
    if (error?.name === 'PointsError') {
      console.error(`${body.functionName} stopped by the Jira points budget`);
      const pts = error.limit >= groupLimit(deps.siteCap) ? Math.max(error.spent, error.limit) : error.spent;
      await deps.state.addJob({ ...job, pts, floor: true, floorAt: deps.now() });
      return { computed: key, stopped: error.scope };
    }
    if (!isRateLimit(error)) throw error;
    console.error(`${body.functionName} stopped by the Jira rate limit`);
    await brake(deps, error.retryAt);
    return { computed: key, braked: true };
  } finally {
    budget.release?.();
  }
}

/**
 * Points a deferred computation may spend from the function lane: its cost by `costOf`, within the group limit and what the lane has left,
 * reserved until `release`; `waitUntil` when the lane cannot hold it now, `tooExpensive` when it passes the group limit.
 */
async function jobBudget(deps, functionName, args, key, job) {
  if (!deps.points) return { limit: Infinity };
  const at = deps.now();
  const [cost, { byLane }] = await Promise.all([costOf(deps, functionName, args, key, await deps.cache.meta(key), job), deps.points.siteSpent(hourKey(at))]);
  if (groupClass(cost, deps.siteCap) === 'over') return { tooExpensive: true };
  const step = admit('fn', cost.points, byLane, at, deps.siteCap);
  if (!step.ok) return { waitUntil: step.waitUntil };
  return { limit: Math.min(groupLimit(deps.siteCap), laneRoom('fn', byLane, at, deps.siteCap)), release: deps.points.reserve('fn', cost.points) };
}

/** Whether no heavy lane runner holds the lease. */
export async function laneIdle(deps) {
  return deps.now() - ((await deps.state.heavy.lease.get()) ?? 0) >= HEAVY_LEASE_MS;
}

/**
 * Settles the lane entry of a finished run: removed once written, kept when handed again meanwhile, retried a minute after a failure or
 * timeout (until HEAVY_ATTEMPTS runs, then removed with a skip mark for the reconcile).
 */
async function settle(deps, running, unfinished) {
  const current = await deps.state.heavy.get(running.key);
  if (!current || current.runningSince !== running.runningSince) return;
  const tries = (running.tries ?? 0) + 1;
  if (unfinished && tries < HEAVY_ATTEMPTS) {
    const { runningSince, ...job } = running;
    const notBefore = deps.now() + REFRESH_RETRY_DELAY_S * 1000;
    await deps.state.heavy.put({ ...job, tries, at: deps.now(), retry: true, notBefore });
    await scheduleWake(deps, notBefore);
    return;
  }
  if (unfinished) {
    const mark = running.since ?? running.at;
    if (((await deps.state.skip.get(running.key)) ?? Infinity) > mark) await deps.state.skip.set(running.key, mark);
  }
  await deps.state.heavy.take(running.key);
}

/** Puts a run the rate limit or the points budget stopped back as it was (same place, same tries), counting the stop. */
async function putBack(deps, running, points = {}) {
  const current = await deps.state.heavy.get(running.key);
  if (!current || current.runningSince !== running.runningSince) return;
  const { runningSince, ...job } = running;
  await deps.state.heavy.put({ ...job, stops: (job.stops ?? 0) + 1, ...points });
}

/** Writes an error into every precomputation of a group, as of `startedAt`. */
async function writeError(deps, group, startedAt, error) {
  if (group) await writeGroups(deps, startedAt, [[group.key, groupWrite(group, { error }, deps.levels, false)]]);
}

function waitedError(deps, job, meta) {
  const cap = deps.siteCap;
  const points = knownCost(meta, job)?.points ?? (cap ? lightLimit(cap) : 0);
  return ERR.waited(job.functionName, { hours: HEAVY_WAIT_MAX_MS / HOUR_MS, points, perFunction: cap ? groupLimit(cap) : 0, perHour: cap ?? 0, issues: cap ? issuesWithin(job.functionName, lightLimit(cap)) : 0 });
}

/**
 * The lane's next step: drop a group nobody used within REFRESH_USED_MS, give one that waited past HEAVY_WAIT_MAX_MS its waited error, or
 * take the first waiting group (by `at`) whose last lane write is HEAVY_MIN_INTERVAL_MS old and whose cost fits the room claimed for the
 * heavy lane (`release` frees it once the step ends); else the earliest instant one may run (`waitUntil`).
 */
async function pickHeavy(deps, queued, groups) {
  const now = deps.now();
  const cap = deps.siteCap;
  const claim = deps.points?.claim ? await deps.points.claim('heavy', (byLane) => Math.min(groupLimit(cap), laneRoom('heavy', byLane, now, cap))) : null;
  try {
    return await pickWithin(deps, queued, groups, now, claim);
  } catch (error) {
    claim?.release();
    throw error;
  }
}

async function pickWithin(deps, queued, groups, now, claim) {
  const cap = deps.siteCap;
  const room = claim ? claim.limit : Infinity;
  const release = () => claim?.release();
  const waits = [];
  for (const job of queued) {
    const group = groups.get(job.key) ?? null;
    if (group && !usedWithin(group, now, REFRESH_USED_MS)) {
      if ((await deps.state.skip.get(job.key)) === null) await deps.state.skip.set(job.key, job.at);
      await deps.state.heavy.take(job.key);
      release();
      return { result: { computed: job.key, unused: true } };
    }
    const meta = await deps.cache.meta(job.key);
    if (now - (job.since ?? job.at) >= HEAVY_WAIT_MAX_MS) {
      await writeError(deps, group, now, waitedError(deps, job, meta));
      await deps.state.heavy.take(job.key);
      release();
      return { result: { computed: job.key, waited: true } };
    }
    if ((job.notBefore ?? 0) > now) {
      waits.push(job.notBefore);
      continue;
    }
    const written = job.retry ? null : await deps.state.groupWrite.get(job.key);
    if (written && now - written < HEAVY_MIN_INTERVAL_MS) {
      waits.push(written + HEAVY_MIN_INTERVAL_MS);
      continue;
    }
    const known = knownCost(meta, job)?.points;
    const cost = known ?? (cap ? lightLimit(cap) : 0);
    if (cost > room) {
      waits.push(retryAfter(now));
      continue;
    }
    return { job, group, room, admitted: { points: cost, known: known !== undefined }, release };
  }
  release();
  return { waitUntil: waits.length ? Math.min(...waits) : null };
}

/**
 * Heavy lane runner: one step of `pickHeavy` per invocation under a lease, within the group limit and the heavy reserve; a stop by the
 * reserve or a 429 is not a try, a failure is (retried after a minute).
 */
export async function runHeavy(deps) {
  const until = await brakedUntil(deps);
  if (until) {
    await scheduleWake(deps, until);
    return { braked: until };
  }
  if (!(await laneIdle(deps))) return { busy: true };
  await deps.state.heavy.lease.set(deps.now());
  let heavy = null;
  let limited = null;
  let wake = null;
  try {
    const queued = (await deps.state.heavy.all()).sort((a, b) => a.at - b.at);
    if (queued.length) {
      const groups = new Map(groupPrecomputations(await listPrecomputations(deps), { now: deps.now(), activeMs: Infinity }).map((g) => [g.key, g]));
      const pick = await pickHeavy(deps, queued, groups);
      heavy = pick.result ?? null;
      if (pick.waitUntil) {
        wake = pick.waitUntil;
        heavy = { waiting: pick.waitUntil };
      }
      if (pick.job) {
        try {
          const step = await runPicked(deps, pick);
          heavy = step.heavy;
          limited = step.limited ?? null;
          wake = step.wake ?? null;
        } finally {
          pick.release();
        }
      }
    }
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    limited = error;
  } finally {
    await deps.state.heavy.lease.clear();
  }
  if (limited) await brake(deps, limited.retryAt);
  else if (wake) await scheduleWake(deps, wake);
  else if (await deps.state.heavy.oldest()) await pushQuietly(deps, { kind: 'heavy' });
  return { heavy };
}

async function runPicked(deps, { job, group, room, admitted }) {
  const cap = deps.siteCap;
  const most = cap ? groupLimit(cap) : Infinity;
  const running = { ...job, runningSince: deps.now() };
  await deps.state.heavy.put(running);
  let heavy;
  try {
    heavy = await runGroupJob(deps, running, { limit: Math.min(most, room), group, compare: !running.force });
  } catch (error) {
    if (error?.name === 'PointsError' && room >= most) {
      console.warn(`${running.functionName} passed the group limit in the heavy lane: spent ${error.spent} of ${error.limit}, admitted at ${admitted.points}${admitted.known ? '' : ' (no known cost)'}`);
      await writeError(deps, group, running.runningSince, overLimit(running, { points: null, floor: false }, cap).error);
      await deps.state.heavy.take(running.key);
      return { heavy: { computed: running.key, tooExpensive: true } };
    }
    if (error?.name === 'PointsError') {
      await putBack(deps, running, { pts: Math.max(error.spent, running.pts ?? 0), floor: true, floorAt: deps.now() });
      return { heavy: { computed: running.key, stopped: 'lane' }, wake: retryAfter(deps.now()) };
    }
    if (isRateLimit(error)) {
      await putBack(deps, running);
      console.error(`${running.functionName} stopped by the Jira rate limit`);
      await deps.state.recordError({ at: deps.now(), functionName: running.functionName, message: LOG.rateLimited() });
      return { heavy: { computed: running.key, braked: true }, limited: error };
    }
    await settle(deps, running, true);
    throw error;
  }
  await settle(deps, running, Boolean(heavy.timedOut));
  if (!heavy.timedOut && ((await deps.state.skip.get(running.key)) ?? Infinity) <= running.runningSince) await deps.state.skip.clear(running.key);
  return { heavy };
}
