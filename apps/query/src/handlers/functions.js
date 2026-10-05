import { decideLicence } from '../access.js';
import { groupKey, parseArgs } from '../core/args.js';
import { FUNCTIONS, takesSubquery } from '../core/catalog.js';
import { ERR, LOG } from '../core/errors.js';
import { errorKindOf } from '../core/affected.js';
import { CACHE_READ_ATTEMPTS, FUNCTION_BUDGET_MS, NEAR_FN_POINTS, PAGE_CACHE_MS, VALUE_LIMIT } from '../core/limits.js';
import { admit, countQueryOf, estimate, groupClass, groupLimit, hourKey, issuesWithin, laneRoom, retryAfter } from '../core/points.js';
import { forOperator } from '../core/jql-build.js';
import { buildFragment, valuesOf } from '../core/tree.js';
import { brake, brakeOf, isRateLimit } from './brake.js';

const TIMEOUT = Symbol('timeout');

/** Licence input of a JQL function call: the environment from the app context first, the licence from the handler context first. */
export function licenceInput(payload, context, app) {
  return {
    environmentType: app?.environmentType ?? context?.environmentType ?? payload?.context?.environmentType,
    license: context?.license ?? app?.license ?? payload?.context?.license,
  };
}

/** The function's error for a Jira 400 (Jira's text with the function name, a generic log line), or null for any other failure. */
export function rejectedByJira(functionName, error) {
  if (error?.name !== 'JiraError' || error.status !== 400) return null;
  return { error: ERR.withFunction(functionName, error.message), log: ERR.subqueryRejected() };
}

async function runSource(deps, functionName, args, reconcile) {
  try {
    if (takesSubquery(functionName)) await deps.jira.validateJql(args.subquery);
    return await deps.compute[functionName](args, { reconcile });
  } catch (error) {
    const rejected = rejectedByJira(functionName, error);
    if (!rejected) throw error;
    return rejected;
  }
}

async function measured(deps, limit, task) {
  if (!deps.withPoints) return { result: await task(), pts: null };
  return deps.withPoints(limit, async () => {
    const result = await task();
    return { result, pts: deps.currentPoints().spent };
  });
}

/**
 * Runs a value source within `limit` Jira points (a request past it throws PointsError), leaves the excluded projects out of it and caches a
 * value list with its compute time and the points it cost; a subquery is first checked by Jira's strict parser (its search answers an invalid
 * query with no issues), and a Jira 400 becomes the function's error with a generic log line. With `keep: false` the cache entry is returned as
 * `entry` instead, for the caller to store once Jira holds the same value.
 */
export async function computeGroup(deps, functionName, args, userArgs, { reconcile = [], source = 'function', keep = true, limit = Infinity } = {}) {
  const startedAt = deps.now();
  const run = await measured(deps, limit, async () => {
    const found = await runSource(deps, functionName, args, reconcile);
    return deps.exclude ? deps.exclude(found) : found;
  });
  const { result, pts } = run;
  if (!result.ids) return result;
  const entry = { values: result.ids, watch: result.watch ?? null, field: result.field, rootFilter: result.rootFilter ?? null, at: deps.now(), source, ms: deps.now() - startedAt, startedAt, lv: deps.levels, ...(pts === null ? {} : { pts }) };
  if (!keep) return { ...result, entry };
  await deps.cache.write(groupKey(functionName, userArgs), entry);
  return result;
}

/** Stored JQL of one precomputation (root or page) from a group result. */
export function fragmentFor(functionName, userArgs, page, result, levels) {
  if (result.error) return { error: result.error, ...(result.log ? { log: result.log } : {}) };
  if (result.native !== undefined) return { jql: result.native };
  return buildFragment({ functionName, userArgs, page, values: valuesOf(result.ids), field: result.field, rootFilter: result.rootFilter ?? undefined, levels });
}

function windowOf(page, meta) {
  if (page?.kind === 'leaf') return { from: (page.index - 1) * VALUE_LIMIT, to: page.index * VALUE_LIMIT };
  return { from: 0, to: page ? 0 : Math.min(meta.n, VALUE_LIMIT) };
}

async function fromCache(deps, functionName, userArgs, page) {
  const key = groupKey(functionName, userArgs);
  let meta = null;
  for (let attempt = 0; attempt < CACHE_READ_ATTEMPTS; attempt += 1) {
    meta = await deps.cache.meta(key);
    if (!meta || deps.now() - meta.at >= PAGE_CACHE_MS) return { meta };
    if (!page && meta.source !== 'job') return { meta };
    const { from, to } = windowOf(page, meta);
    const ids = to > from ? await deps.cache.values(key, meta, from, to) : [];
    if (ids) {
      const values = { n: meta.n, range: (f, t) => ids.slice(f - from, t - from) };
      return { meta, fragment: buildFragment({ functionName, userArgs, page, values, field: meta.field, rootFilter: meta.rootFilter ?? undefined, levels: deps.levels }) };
    }
  }
  return { meta };
}

const tooExpensive = (functionName, cost, limit) => ({
  error: ERR.tooExpensive(functionName, { ...cost, limit, issues: issuesWithin(functionName, limit) }),
  log: LOG.tooExpensive(),
  store: true,
});
const allowanceUsed = (retryAt) => ({ error: ERR.allowanceUsed(retryAt), log: LOG.allowanceUsed() });

async function countOf(deps, query) {
  try {
    return await deps.jira.approximateCount(query, { attempts: 1 });
  } catch {
    return null;
  }
}

/**
 * What computing a group should cost: the points its last finished computation cost, or what a stopped one spent (a lower bound), else the
 * estimate over Jira's approximate count of its query (one try; unknown when it fails). A subquery is checked by Jira's strict parser before
 * it is counted, so an invalid one throws its Jira 400. `job` is the group's stored job when the caller has read it.
 */
export async function costOf(deps, functionName, args, key, meta, job) {
  if (meta?.pts !== undefined && meta?.pts !== null) return { n: null, points: meta.pts, floor: false, measured: true };
  const stored = job === undefined ? await deps.state.job(key) : job;
  if (stored?.pts !== undefined) return { n: null, points: stored.pts, floor: Boolean(stored.floor) };
  const query = countQueryOf(functionName, args);
  if (!query || estimate(functionName, 1).points === estimate(functionName, 0).points) return { n: null, ...estimate(functionName, null) };
  if (takesSubquery(functionName)) await deps.jira.validateJql(args.subquery);
  const n = await countOf(deps, query);
  return { n, ...estimate(functionName, n) };
}

/**
 * Whether a function call may compute a group, and within how many points: a group dearer than the group limit gets an error with its
 * numbers (stored), a step the function lane cannot hold an error naming when to retry (not stored), and while Jira warns that the app's pool
 * is nearly used only a step of at most NEAR_FN_POINTS runs.
 */
async function budgetFor(deps, functionName, args, key, meta) {
  if (!deps.points) return { limit: Infinity };
  const cap = deps.siteCap;
  const most = groupLimit(cap);
  const at = deps.now();
  let found;
  try {
    found = await Promise.all([costOf(deps, functionName, args, key, meta), brakeOf(deps), deps.points.siteSpent(hourKey(at))]);
  } catch (error) {
    const rejected = rejectedByJira(functionName, error);
    if (rejected) return { refused: rejected };
    throw error;
  }
  const [cost, pause, { byLane }] = found;
  if (groupClass(cost, cap) === 'over') return { refused: tooExpensive(functionName, cost, most) };
  const near = pause?.reason === 'near';
  if (near && cost.points > NEAR_FN_POINTS) return { refused: allowanceUsed(pause.until) };
  const step = admit('fn', cost.points, byLane, at, cap);
  if (!step.ok) return { refused: allowanceUsed(step.waitUntil) };
  const room = laneRoom('fn', byLane, at, cap);
  const limits = [['group', most], ['lane', room], ...(near ? [['near', NEAR_FN_POINTS]] : [])];
  const [cause, limit] = limits.reduce((a, b) => (b[1] <= a[1] ? b : a));
  return { limit, cause, most, at, pause, release: deps.points.reserve('fn', cost.points) };
}

function failedOnPoints(functionName, budget, failure) {
  if (failure?.name !== 'PointsError') return null;
  if (budget.cause === 'group') return tooExpensive(functionName, { n: null, points: null }, budget.most);
  return allowanceUsed(budget.cause === 'near' ? budget.pause.until : retryAfter(budget.at));
}

async function budgetedCompute(deps, functionName, args, userArgs, key, meta) {
  const budget = await budgetFor(deps, functionName, args, key, meta);
  if (budget.refused) return { refused: budget.refused };
  try {
    return { result: await computeGroup(deps, functionName, args, userArgs, { limit: budget.limit }) };
  } catch (failed) {
    return { failed, refused: failedOnPoints(functionName, budget, failed) };
  } finally {
    budget.release?.();
  }
}

/**
 * Queues the computation of a group, or, when Jira rate-limited the call, pauses the background until the reset and queues nothing (the
 * next call asks again); never throws, so Jira always gets the Computing answer (a function that throws fails the whole search).
 */
async function defer(deps, functionName, userArgs, failure) {
  try {
    await deps.state.addJob({ key: groupKey(functionName, userArgs), functionName, userArgs, at: deps.now() });
    if (isRateLimit(failure)) await brake(deps, failure.retryAt);
    else await deps.queue.push({ kind: 'compute', functionName, userArgs });
  } catch (error) {
    console.error(`${functionName} defer failed: ${error?.name} ${error?.message}`);
  }
  return { error: ERR.computing() };
}

async function evaluateSafely(deps, functionName, payload, context) {
  try {
    return await evaluateClause(deps, functionName, payload, context);
  } catch (error) {
    console.error(`${functionName} failed: ${error?.name} ${error?.status ?? ''}`);
    const parsed = parseArgs(functionName, payload?.clause?.arguments);
    return parsed.error ? { error: ERR.computing() } : defer(deps, functionName, parsed.userArgs, error);
  }
}

async function evaluateClause(deps, functionName, payload, context) {
  if (!decideLicence(licenceInput(payload, context, deps.appContext?.())).licensed) return { error: ERR.unlicensed(), log: ERR.unlicensed() };
  const parsed = parseArgs(functionName, payload?.clause?.arguments);
  if (parsed.error) return { log: parsed.error, ...parsed };
  const { args, userArgs, page } = parsed;
  const gate = await deps.ready(functionName);
  if (gate) return { error: gate, log: gate };
  const operator = payload?.clause?.operator;
  const cached = await fromCache(deps, functionName, userArgs, page);
  if (cached.fragment) return answer(cached.fragment, operator);
  const work = budgetedCompute(deps, functionName, args, userArgs, groupKey(functionName, userArgs), cached.meta).catch((failed) => ({ failed }));
  const outcome = await Promise.race([work, deps.sleep(FUNCTION_BUDGET_MS).then(() => TIMEOUT)]);
  if (outcome === TIMEOUT) return defer(deps, functionName, userArgs);
  if (outcome.refused) return outcome.refused;
  if (outcome.failed) {
    console.error(`${functionName} failed: ${outcome.failed?.name} ${outcome.failed?.status ?? ''}`);
    return defer(deps, functionName, userArgs, outcome.failed);
  }
  return answer(fragmentFor(functionName, userArgs, page, outcome.result, deps.levels), operator);
}

/**
 * Adds the precomputation Jira creates from a stored answer (a JQL fragment or a stored error) to the cached list, by the id Jira passed;
 * when that fails the cached list is marked stale, so the next pass reads Jira's.
 */
async function listCreated(deps, functionName, payload, reply) {
  if (!deps.pcList || !payload?.precomputationId) return;
  const record = { id: payload.precomputationId, functionName, arguments: payload.clause?.arguments ?? [], operator: payload.clause?.operator, hasValue: !reply.error, errorKind: reply.error ? errorKindOf(reply.error) : null };
  try {
    await deps.pcList.add(record);
    const parsed = parseArgs(functionName, record.arguments);
    if (!parsed.error) await deps.cache.unpost(groupKey(functionName, parsed.userArgs));
  } catch (error) {
    console.error(`precomputation list add failed: ${error?.name}`);
    try {
      await deps.pcList.markDirty();
    } catch (failure) {
      console.error(`precomputation list mark failed: ${failure?.name}`);
    }
  }
}

/** A fragment in the form of the clause's operator. */
function answer(fragment, operator) {
  if (fragment.error) return fragment;
  return { jql: forOperator(fragment.jql, operator) };
}

/**
 * One JQL function clause → stored JQL (the complement for `not in`), or an error Jira shows in the editor for either operator (only a group too
 * dear for the Jira points budget has its error stored as the precomputation); never throws
 * (Jira answers a thrown call with "Your query couldn't be processed"); the log gets value-free text only.
 */
export async function handleFunction(deps, functionName, payload, context) {
  const reply = await evaluateSafely(deps, functionName, payload, context);
  if (!reply.error || reply.store === true) await listCreated(deps, functionName, payload, reply);
  if (!reply.error) return { jql: reply.jql };
  if (reply.error !== ERR.computing()) await recordQuietly(deps, functionName, reply.log ?? LOG.rejected());
  return { error: reply.error, storeErrorAsPrecomputation: reply.store === true };
}

async function recordQuietly(deps, functionName, message) {
  try {
    await deps.state.recordError({ at: deps.now(), functionName, message });
  } catch (error) {
    console.error(`${functionName} error log failed: ${error?.name}`);
  }
}

/** Forge handlers for every catalog function, by function name. */
export function createFunctionHandlers(deps) {
  return Object.fromEntries(FUNCTIONS.map((f) => [f.name, (payload, context) => handleFunction(deps, f.name, payload, context)]));
}
