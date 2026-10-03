import { decideLicence } from '../access.js';
import { groupKey, parseArgs } from '../core/args.js';
import { FUNCTIONS } from '../core/catalog.js';
import { ERR } from '../core/errors.js';
import { CACHE_READ_ATTEMPTS, FUNCTION_BUDGET_MS, PAGE_CACHE_MS, VALUE_LIMIT } from '../core/limits.js';
import { buildFragment, valuesOf } from '../core/tree.js';

const TIMEOUT = Symbol('timeout');
const UNKNOWN_ENVIRONMENT = 'PRODUCTION';

/**
 * Licence input of a JQL function call: the environment from the app context (an unknown one counts as production),
 * the licence from the handler context, the app context or the payload context.
 */
export function licenceInput(payload, context, app) {
  return {
    environmentType: app?.environmentType ?? context?.environmentType ?? payload?.context?.environmentType ?? UNKNOWN_ENVIRONMENT,
    license: context?.license ?? app?.license ?? payload?.context?.license,
  };
}

/** Runs a value source and caches a value list; a Jira 400 (invalid subquery) becomes the function's error with a generic log line. */
export async function computeGroup(deps, functionName, args, userArgs, { reconcile = [], source = 'function' } = {}) {
  let result;
  try {
    result = await deps.compute[functionName](args, { reconcile });
  } catch (error) {
    if (error?.name !== 'JiraError' || error.status !== 400) throw error;
    result = { error: ERR.withFunction(functionName, error.message), log: ERR.subqueryRejected() };
  }
  if (result.ids) {
    await deps.cache.write(groupKey(functionName, userArgs), { values: result.ids, watch: result.watch ?? null, field: result.field, rootFilter: result.rootFilter ?? null, at: deps.now(), source });
  }
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

async function defer(deps, functionName, userArgs) {
  await deps.state.addJob({ key: groupKey(functionName, userArgs), functionName, userArgs, at: deps.now() });
  await deps.queue.push({ kind: 'compute', functionName, userArgs });
  return { error: ERR.computing() };
}

async function evaluateClause(deps, functionName, payload, context) {
  if (!decideLicence(licenceInput(payload, context, deps.appContext?.())).licensed) return { error: ERR.unlicensed() };
  const parsed = parseArgs(functionName, payload?.clause?.arguments);
  if (parsed.error) return parsed;
  const { args, userArgs, page } = parsed;
  const gate = await deps.ready(functionName);
  if (gate) return { error: gate };
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

/** One JQL function clause → stored JQL, or an error Jira shows in the editor (never stored, so the next search retries). */
export async function handleFunction(deps, functionName, payload, context) {
  const reply = await evaluateClause(deps, functionName, payload, context);
  if (!reply.error) return { jql: reply.jql };
  if (reply.error !== ERR.computing()) await deps.state.recordError({ at: deps.now(), functionName, message: reply.log ?? reply.error });
  return { error: reply.error, storeErrorAsPrecomputation: false };
}

/** Forge handlers for every catalog function, by function name. */
export function createFunctionHandlers(deps) {
  return Object.fromEntries(FUNCTIONS.map((f) => [f.name, (payload, context) => handleFunction(deps, f.name, payload, context)]));
}
