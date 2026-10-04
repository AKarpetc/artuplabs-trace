import { groupKey, parseArgs, splitPage } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { LOG } from '../core/errors.js';
import { groupPrecomputations } from '../core/affected.js';
import { forOperator } from '../core/jql-build.js';
import { ACTIVE_MS, HEAVY_ATTEMPTS, HEAVY_LEASE_MS, HEAVY_QUEUED_STALE_MS, REFRESH_GROUP_BUDGET_MS, WORKER_BUDGET_MS } from '../core/limits.js';
import { computeGroup, fragmentFor } from './functions.js';

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

async function recompute(deps, group, reconcile, source) {
  const parsed = parseArgs(group.functionName, group.userArgs);
  const gate = parsed.error ? null : await deps.ready(group.functionName);
  if (parsed.error || gate) return { error: parsed.error ?? gate };
  return computeGroup(deps, group.functionName, parsed.args, group.userArgs, { reconcile, source, keep: false });
}

async function keepEntry(deps, key, result) {
  if (result.entry) await deps.cache.write(key, result.entry);
}

/** Precomputation updates whose stored value or error changed, each in the form of its operator (`not in` stores the complement); a value clears a stored error, which Jira keeps otherwise. */
export function updatesFor(group, result, levels) {
  const updates = [];
  for (const pc of group.items) {
    const fragment = fragmentFor(group.functionName, group.userArgs, splitPage(pc.arguments).page, result, levels);
    const r = fragment.error ? fragment : { jql: forOperator(fragment.jql, pc.operator) };
    const storedError = pc.error ?? null;
    if ((r.jql ?? null) === (pc.value ?? null) && (r.error ?? null) === storedError) continue;
    if (r.error) updates.push({ id: pc.id, error: r.error });
    else updates.push(storedError === null ? { id: pc.id, value: r.jql } : { id: pc.id, value: r.jql, error: null });
  }
  return updates;
}

/**
 * Recomputes one group: its precomputation updates and the cache entry to store after they are written (a group without precomputations
 * is a background job, cached at once). Staleness is judged against the cache, so the cache must never run ahead of what Jira stores.
 */
export async function rewrite(deps, group, reconcile) {
  const result = await recompute(deps, group, reconcile, group.items.length ? 'refresh' : 'job');
  if (!group.items.length) {
    await keepEntry(deps, group.key, result);
    await keepJob(deps, group.functionName, group.userArgs, result);
    return { updates: [], entry: null };
  }
  return { updates: updatesFor(group, result, deps.levels), entry: result.entry ?? null };
}

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

/** Whether a group belongs to the heavy lane: it waits there, or its last computation took longer than a refresh pass may spend on it. */
export async function isHeavy(deps, group) {
  if (await deps.state.heavy.get(group.key)) return true;
  return ((await deps.cache.meta(group.key))?.ms ?? 0) >= REFRESH_GROUP_BUDGET_MS;
}

/**
 * Queues a group in the heavy lane, once: an entry that is waiting will start after this call, so it sees every change made before it;
 * an entry whose run already started is replaced, so the group runs again. True when it queued, and the caller then pushes one runner.
 */
export async function handOff(deps, group) {
  const waiting = await deps.state.heavy.get(group.key);
  if (waiting && !waiting.runningSince && deps.now() - waiting.at < HEAVY_QUEUED_STALE_MS) return false;
  await deps.state.heavy.put({ key: group.key, functionName: group.functionName, userArgs: group.userArgs, at: deps.now() });
  return true;
}

/** Computes one group within the worker budget and writes its precomputations (clearing a stored Computing error); a group still without precomputations stays a background job. */
export async function runGroupJob(deps, { functionName, userArgs }) {
  const startedAt = deps.now();
  const parsed = parseArgs(functionName, userArgs);
  if (parsed.error) return { error: parsed.error };
  const key = groupKey(functionName, parsed.userArgs);
  const bare = { key, functionName, family: FUNCTION_BY_NAME.get(functionName)?.family ?? 'query', userArgs: parsed.userArgs, items: [] };
  let result;
  try {
    result = await deps.withDeadline(startedAt + WORKER_BUDGET_MS, () => recompute(deps, bare, [], 'job'));
  } catch (error) {
    if (!isDeadline(error)) throw error;
    console.error(`${functionName} ran out of time`);
    await deps.state.recordError({ at: deps.now(), functionName, message: LOG.refreshTimedOut() });
    return { computed: key, timedOut: true };
  }
  const group = groupPrecomputations(await deps.jira.precomputations(), { now: deps.now(), activeMs: ACTIVE_MS }).find((g) => g.key === key);
  if (!group) {
    await keepEntry(deps, key, result);
    await keepJob(deps, functionName, parsed.userArgs, result);
    return { computed: key, changed: 0 };
  }
  return { computed: key, changed: await writeGroups(deps, startedAt, [[key, { updates: updatesFor(group, result, deps.levels), entry: result.entry ?? null }]]) };
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

/** Heavy lane runner: one waiting group per invocation under a lease; its entry stays until the group is written, so a failed run is retried. */
export async function runHeavy(deps) {
  if (!(await laneIdle(deps))) return { busy: true };
  await deps.state.heavy.lease.set(deps.now());
  let heavy = null;
  try {
    const job = await deps.state.heavy.oldest();
    if (job) {
      const running = { ...job, runningSince: deps.now() };
      await deps.state.heavy.put(running);
      try {
        heavy = await runGroupJob(deps, running);
      } catch (error) {
        await settle(deps, running, true);
        throw error;
      }
      await settle(deps, running, Boolean(heavy.timedOut));
    }
  } finally {
    await deps.state.heavy.lease.clear();
  }
  if (await deps.state.heavy.oldest()) await pushQuietly(deps, { kind: 'heavy' });
  return { heavy };
}
