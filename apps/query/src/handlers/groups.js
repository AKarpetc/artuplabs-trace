import { groupKey, parseArgs, splitPage } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { ERR, LOG } from '../core/errors.js';
import { groupPrecomputations, usedWithin } from '../core/affected.js';
import { forOperator } from '../core/jql-build.js';
import { ACTIVE_MS, HEAVY_ATTEMPTS, HEAVY_LEASE_MS, HEAVY_QUEUED_STALE_MS, REFRESH_USED_MS, PAGE_CACHE_MS, REFRESH_GROUP_BUDGET_MS, WORKER_BUDGET_MS } from '../core/limits.js';
import { computeGroup, costOf, fragmentFor, rejectedByJira } from './functions.js';
import { admit, groupClass, groupLimit, hourKey, laneRoom } from '../core/points.js';
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

/**
 * Precomputation updates, each in the form of its operator (`not in` stores the complement); a value clears a stored error, which Jira keeps
 * otherwise. Precomputations from the cached list (no stored value) are all written unless the result is `same` as the group's cache meta and
 * each holds a value alone; precomputations read from Jira with their values get an update only where the stored value or error changed.
 */
export function updatesFor(group, result, levels, same = false) {
  if (group.items.length && group.items.every(listed)) return listedUpdates(group, result, levels, same);
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

function listedUpdates(group, result, levels, same) {
  if (same && !result.error && group.items.every(clean)) return [];
  return group.items.map((pc) => {
    const { page } = splitPage(pc.arguments);
    const fragment = fragmentFor(group.functionName, group.userArgs, page, result, levels);
    if (fragment.error) return { id: pc.id, error: fragment.error };
    const value = forOperator(fragment.jql, pc.operator);
    return pc.errorKind === null ? { id: pc.id, value } : { id: pc.id, value, error: null };
  });
}

/** Whether a group's new result holds what its cache meta (`meta`, read when undefined) describes. */
async function sameAsCache(deps, key, result, meta) {
  if (!result.entry) return false;
  const m = meta === undefined ? await deps.cache.meta(key) : meta;
  return deps.cache.matches(m, result.entry);
}

/**
 * Recomputes one group within `limit` Jira points: its precomputation updates and the cache entry to store after they are written (a group
 * without precomputations is a background job, cached at once). Staleness is judged against the cache, so the cache must never run ahead of
 * what Jira stores.
 */
export async function rewrite(deps, group, reconcile, { limit = Infinity, meta } = {}) {
  const result = await recompute(deps, group, reconcile, group.items.length ? 'refresh' : 'job', limit);
  if (!group.items.length) {
    await keepEntry(deps, group.key, result);
    await keepJob(deps, group.functionName, group.userArgs, result);
    return { updates: [], entry: null };
  }
  return { updates: updatesFor(group, result, deps.levels, await sameAsCache(deps, group.key, result, meta)), entry: result.entry ?? null };
}

/** The precomputation list: the cached one when the dependencies keep it, else Jira's own. */
export const listPrecomputations = (deps) => (deps.pcList?.list ? deps.pcList.list() : deps.jira.precomputations());

/**
 * Writes the updates of each group unless a computation that started later already wrote or confirmed that group, then stores the cache
 * entries of the groups it did not skip; a group found unchanged is confirmed too, so an older computation finishing later cannot roll it
 * back. Returns how many updates were written.
 */
export async function writeGroups(deps, startedAt, byGroup) {
  const out = [];
  const entries = [];
  for (const [key, { updates, entry }] of byGroup) {
    if (!updates.length && !entry) continue;
    if (((await deps.state.groupWrite.get(key)) ?? 0) > startedAt) continue;
    await deps.state.groupWrite.set(key, startedAt);
    out.push(...updates);
    if (entry) entries.push([key, entry]);
  }
  if (out.length) await deps.jira.writePrecomputations(out);
  for (const [key, entry] of entries) await deps.cache.write(key, entry);
  return out.length;
}

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

/** The cost a group is known to have: the points of its last finished computation (cache meta), else what a stopped one spent (its job), else null. */
export function knownCost(meta, job) {
  if (meta?.pts !== undefined && meta?.pts !== null) return { points: meta.pts, floor: false, measured: true };
  if (job?.pts !== undefined) return { points: job.pts, floor: Boolean(job.floor) };
  return null;
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
export async function handOff(deps, group, points = {}) {
  const waiting = await deps.state.heavy.get(group.key);
  if (waiting && !waiting.runningSince && deps.now() - waiting.at < HEAVY_QUEUED_STALE_MS) return false;
  const kept = points.pts === undefined ? keptPoints(waiting) : keptPoints(points);
  await deps.state.heavy.put({ key: group.key, functionName: group.functionName, userArgs: group.userArgs, at: deps.now(), ...kept });
  return true;
}

/** Computes one group within the worker budget and `limit` Jira points and writes its precomputations (clearing a stored Computing error); a group still without precomputations stays a background job. */
export async function runGroupJob(deps, { functionName, userArgs }, { limit = Infinity } = {}) {
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
  const group = groupPrecomputations(await listPrecomputations(deps), { now: deps.now(), activeMs: ACTIVE_MS }).find((g) => g.key === key);
  if (!group) {
    await keepEntry(deps, key, result);
    await keepJob(deps, functionName, parsed.userArgs, result);
    return { computed: key, changed: 0 };
  }
  const same = await sameAsCache(deps, key, result);
  return { computed: key, changed: await writeGroups(deps, startedAt, [[key, { updates: updatesFor(group, result, deps.levels, same), entry: result.entry ?? null }]]) };
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
      await deps.state.addJob({ ...job, pts, floor: true });
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
 * Settles the lane entry of a finished run: removed once the run wrote the group, kept when the group was handed again meanwhile,
 * moved behind the other groups when the run failed or ran out of time (until HEAVY_ATTEMPTS runs).
 */
async function settle(deps, running, unfinished) {
  const current = await deps.state.heavy.get(running.key);
  if (!current || current.runningSince !== running.runningSince) return;
  const tries = (running.tries ?? 0) + 1;
  if (unfinished && tries < HEAVY_ATTEMPTS) {
    const { runningSince, ...job } = running;
    await deps.state.heavy.put({ ...job, tries, at: deps.now() });
    return;
  }
  await deps.state.heavy.take(running.key);
}

/**
 * Heavy lane runner: one waiting group per invocation under a lease; its entry stays until the group is written, so a failed run is retried.
 * While the background waits for Jira's rate limit it runs nothing; a run a 429 stopped counts as a try and the lane goes on after the wake;
 * a group Jira has not used within REFRESH_USED_MS leaves the lane without a run.
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
  try {
    const job = await deps.state.heavy.oldest();
    const group = job ? groupPrecomputations(await listPrecomputations(deps), { now: deps.now(), activeMs: Infinity }).find((g) => g.key === job.key) : null;
    if (group && !usedWithin(group, deps.now(), REFRESH_USED_MS)) {
      await deps.state.heavy.take(job.key);
      heavy = { computed: job.key, unused: true };
    } else if (job) {
      const running = { ...job, runningSince: deps.now() };
      await deps.state.heavy.put(running);
      try {
        heavy = await runGroupJob(deps, running);
      } catch (error) {
        await settle(deps, running, true);
        if (!isRateLimit(error)) throw error;
        limited = error;
        heavy = { computed: running.key, braked: true };
        console.error(`${running.functionName} stopped by the Jira rate limit`);
        await deps.state.recordError({ at: deps.now(), functionName: running.functionName, message: LOG.rateLimited() });
      }
      if (!limited) await settle(deps, running, Boolean(heavy.timedOut));
    }
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    limited = error;
  } finally {
    await deps.state.heavy.lease.clear();
  }
  if (limited) await brake(deps, limited.retryAt);
  else if (await deps.state.heavy.oldest()) await pushQuietly(deps, { kind: 'heavy' });
  return { heavy };
}
