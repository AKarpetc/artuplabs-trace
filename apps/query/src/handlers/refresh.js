import { groupKey, parseArgs, splitPage } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { familyWants, groupPrecomputations, queryOverlap, summarizeJournal } from '../core/affected.js';
import { ACTIVE_MS, JOURNAL_PAGE, LEASE_MS, MAX_TOUCHED, RECONCILE_MAX, REFRESH_CONCURRENCY, VERIFY_DELAY_S, WORKER_BUDGET_MS } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { computeGroup, fragmentFor } from './functions.js';

/** Marks a refresh as pending and pushes it; a failed push clears the mark so the next event retries. */
export async function pushRefresh(deps, ts) {
  await deps.state.pending.set(ts);
  try {
    await deps.queue.push({ kind: 'refresh', ts });
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

async function keepJob(deps, functionName, userArgs, result) {
  if (result.ids) await deps.state.addJob({ key: groupKey(functionName, userArgs), functionName, userArgs, at: deps.now() });
}

async function isStale(deps, group, summary) {
  if (summary.all) return true;
  if (group.family !== 'query') return familyWants(group.family, summary.kinds);
  if (!summary.touched.length) return false;
  const parsed = parseArgs(group.functionName, group.userArgs);
  if (parsed.error) return false;
  const watch = await deps.cache.watch(group.key);
  const touched = new Set(summary.touched);
  let liveHits = null;
  try {
    const hits = await deps.jira.searchIds(`(${parsed.args.subquery}) AND id in (${summary.touched.join(',')})`, { reconcile: summary.touched.slice(0, RECONCILE_MAX) });
    liveHits = hits.filter((id) => touched.has(String(id)));
  } catch (error) {
    if (error?.name !== 'JiraError') throw error;
  }
  return queryOverlap({ touched: summary.touched, watch, liveHits });
}

/** Recomputes one group; returns the precomputation updates whose stored value or error changed (a group without precomputations is a background job). */
export async function rewrite(deps, group, reconcile) {
  const parsed = parseArgs(group.functionName, group.userArgs);
  const gate = parsed.error ? null : await deps.ready(group.functionName);
  let result = { error: parsed.error ?? gate };
  if (!parsed.error && !gate) {
    result = await computeGroup(deps, group.functionName, parsed.args, group.userArgs, { reconcile, source: group.items.length ? 'refresh' : 'job' });
    if (!group.items.length) await keepJob(deps, group.functionName, group.userArgs, result);
  }
  const updates = [];
  for (const pc of group.items) {
    const r = fragmentFor(group.functionName, group.userArgs, splitPage(pc.arguments).page, result, deps.levels);
    if ((r.jql ?? null) !== (pc.value ?? null) || (r.error ?? null) !== (pc.error ?? null)) updates.push(r.error ? { id: pc.id, error: r.error } : { id: pc.id, value: r.jql });
  }
  return updates;
}

/** One pass over a journal page: recompute stale groups (precomputations Jira used, and background jobs), write changes, then drop the rows (kept if the write fails). */
export async function refreshOnce(deps) {
  const startedAt = deps.now();
  const rows = await deps.journal.read(JOURNAL_PAGE);
  if (!rows.length) return null;
  const summary = summarizeJournal(rows);
  const groups = groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: ACTIVE_MS }).filter(isUsed);
  const all = [...groups, ...jobGroups(await deps.state.jobs(startedAt), groups)];
  const reconcile = summary.touched.slice(0, RECONCILE_MAX);
  const updates = [];
  let recomputed = 0;
  await pool(all, REFRESH_CONCURRENCY, async (group) => {
    if (!(await isStale(deps, group, summary))) return;
    recomputed += 1;
    updates.push(...(await rewrite(deps, group, reconcile)));
  });
  let stale = false;
  if (updates.length) {
    if (((await deps.state.lastWrittenStart.get()) ?? 0) > startedAt) stale = true;
    else {
      await deps.state.lastWrittenStart.set(startedAt);
      await deps.jira.writePrecomputations(updates);
    }
  }
  await deps.journal.remove(rows.map((r) => r.key));
  return {
    touched: summary.touched.slice(0, MAX_TOUCHED),
    kinds: summary.kinds,
    events: rows.length,
    all: summary.all,
    groups: all.length,
    recomputed,
    changed: updates.length,
    stale,
    oldestEventMs: summary.firstAt === null ? null : startedAt - summary.firstAt,
  };
}

async function computeJob(deps, { functionName, userArgs }) {
  const parsed = parseArgs(functionName, userArgs);
  if (parsed.error) return { error: parsed.error };
  const result = await computeGroup(deps, functionName, parsed.args, parsed.userArgs, { source: 'job' });
  await keepJob(deps, functionName, parsed.userArgs, result);
  return { computed: groupKey(functionName, parsed.userArgs) };
}

/** Queue consumer: a compute job, or refresh passes under a lease until the journal is empty or the budget is spent. */
export async function onRefresh(deps, event) {
  const body = event?.body ?? {};
  if (body.kind === 'compute') return computeJob(deps, body);
  if (body.verify?.length) await deps.journal.append({ ids: body.verify, kinds: body.kinds ?? ['issue-updated'] }, deps.now());
  else await deps.state.pending.clear();
  if (deps.now() - ((await deps.state.lease.get()) ?? 0) < LEASE_MS) return { busy: true };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  await deps.state.lease.set(deps.now());
  const passes = [];
  try {
    while (deps.now() < deadline) {
      const pass = await refreshOnce(deps);
      if (!pass) break;
      passes.push(pass);
      await deps.state.lease.set(deps.now());
    }
  } finally {
    await deps.state.lease.clear();
  }
  if ((await deps.journal.read(1)).length && !(await deps.state.pending.get())) await pushRefresh(deps, deps.now());
  const verify = [...new Set(passes.flatMap((p) => p.touched))].slice(0, MAX_TOUCHED);
  if (!body.verify && verify.length) {
    await deps.queue.push({ kind: 'refresh', ts: deps.now(), verify, kinds: [...new Set(passes.flatMap((p) => p.kinds))].sort() }, VERIFY_DELAY_S);
  }
  if (passes.length) {
    await deps.state.lastRefresh.set({ at: deps.now(), passes: passes.length, changed: passes.reduce((s, p) => s + p.changed, 0), oldestEventMs: Math.max(...passes.map((p) => p.oldestEventMs ?? 0)) });
  }
  return { passes };
}
