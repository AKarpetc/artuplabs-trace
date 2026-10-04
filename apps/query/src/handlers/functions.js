import { decideLicence } from '../access.js';
import { groupKey, parseArgs } from '../core/args.js';
import { FUNCTIONS } from '../core/catalog.js';
import { ERR, LOG } from '../core/errors.js';
import { CACHE_READ_ATTEMPTS, FUNCTION_BUDGET_MS, PAGE_CACHE_MS, VALUE_LIMIT } from '../core/limits.js';
import { buildFragment, valuesOf } from '../core/tree.js';

const TIMEOUT = Symbol('timeout');

/** Licence input of a JQL function call: the environment from the app context first, the licence from the handler context first. */
export function licenceInput(payload, context, app) {
  return {
    environmentType: app?.environmentType ?? context?.environmentType ?? payload?.context?.environmentType,
    license: context?.license ?? app?.license ?? payload?.context?.license,
  };
}

/**
 * Runs a value source and caches a value list with its compute time; a Jira 400 (invalid subquery) becomes the function's error with a generic log line.
 * With `keep: false` the cache entry is returned as `entry` instead, for the caller to store once Jira holds the same value.
 */
export async function computeGroup(deps, functionName, args, userArgs, { reconcile = [], source = 'function', keep = true } = {}) {
  const startedAt = deps.now();
  let result;
  try {
    result = await deps.compute[functionName](args, { reconcile });
  } catch (error) {
    if (error?.name !== 'JiraError' || error.status !== 400) throw error;
    result = { error: ERR.withFunction(functionName, error.message), log: ERR.subqueryRejected() };
  }
  if (!result.ids) return result;
  const entry = { values: result.ids, watch: result.watch ?? null, field: result.field, rootFilter: result.rootFilter ?? null, at: deps.now(), source, ms: deps.now() - startedAt, startedAt };
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
  for (let attempt = 0; attempt < CACHE_READ_ATTEMPTS; attempt += 1) {
    const meta = await deps.cache.meta(key);
    if (!meta || deps.now() - meta.at >= PAGE_CACHE_MS) return null;
    if (!page && meta.source !== 'job') return null;
    const { from, to } = windowOf(page, meta);
    const ids = to > from ? await deps.cache.values(key, meta, from, to) : [];
    if (ids) {
      const values = { n: meta.n, range: (f, t) => ids.slice(f - from, t - from) };
      return buildFragment({ functionName, userArgs, page, values, field: meta.field, rootFilter: meta.rootFilter ?? undefined, levels: deps.levels });
    }
  }
  return null;
}

/** Queues the computation of a group; never throws, so Jira always gets the Computing answer (a function that throws fails the whole search). */
async function defer(deps, functionName, userArgs) {
  try {
    await deps.state.addJob({ key: groupKey(functionName, userArgs), functionName, userArgs, at: deps.now() });
    await deps.queue.push({ kind: 'compute', functionName, userArgs });
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
    return parsed.error ? { error: ERR.computing() } : defer(deps, functionName, parsed.userArgs);
  }
}

async function evaluateClause(deps, functionName, payload, context) {
  if (!decideLicence(licenceInput(payload, context, deps.appContext?.())).licensed) return { error: ERR.unlicensed(), log: ERR.unlicensed() };
  const parsed = parseArgs(functionName, payload?.clause?.arguments);
  if (parsed.error) return { log: parsed.error, ...parsed };
  const { args, userArgs, page } = parsed;
  const gate = await deps.ready(functionName);
  if (gate) return { error: gate, log: gate };
  const cached = await fromCache(deps, functionName, userArgs, page);
  if (cached) return cached;
  const work = computeGroup(deps, functionName, args, userArgs).catch((failed) => ({ failed }));
  const outcome = await Promise.race([work, deps.sleep(FUNCTION_BUDGET_MS).then(() => TIMEOUT)]);
  if (outcome === TIMEOUT) return defer(deps, functionName, userArgs);
  if (outcome.failed) {
    console.error(`${functionName} failed: ${outcome.failed?.name} ${outcome.failed?.status ?? ''}`);
    return defer(deps, functionName, userArgs);
  }
  return fragmentFor(functionName, userArgs, page, outcome, deps.levels);
}

/** One JQL function clause → stored JQL, or an error Jira shows in the editor; never throws (Jira answers a thrown call with "Your query couldn't be processed"); the log gets value-free text only. */
export async function handleFunction(deps, functionName, payload, context) {
  const reply = await evaluateSafely(deps, functionName, payload, context);
  if (!reply.error) return { jql: reply.jql };
  if (reply.error !== ERR.computing()) await recordQuietly(deps, functionName, reply.log ?? LOG.rejected());
  return { error: reply.error, storeErrorAsPrecomputation: false };
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
