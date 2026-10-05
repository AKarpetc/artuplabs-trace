import { createHash } from 'node:crypto';
import api, { getAppContext, route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { Queue } from '@forge/events';
import { FUNCTION_BY_NAME, SHIPPED_GROUPS } from './core/catalog.js';
import { RETRY_MAX_MS, TREE_LEVELS } from './core/limits.js';
import { readinessError } from './core/readiness.js';
import { appJira, withDeadline } from './infra/jira.js';
import { createLedger } from './infra/points.js';
import { capOf } from './core/points.js';
import { createValueCache } from './infra/cache.js';
import { createJournal } from './infra/journal.js';
import { createState } from './infra/state.js';
import { createIndexRepo } from './infra/indexRepo.js';
import { runMigrations } from './infra/schema.js';
import { createQueueClient } from './infra/queue.js';
import { meterKvs } from './infra/meter.js';
import { createHierarchyCompute } from './compute/hierarchy.js';
import { createLinkCompute } from './compute/links.js';
import { createBoardCompute } from './compute/boards.js';
import { createSprintCompute } from './compute/sprints.js';
import { createCommentCompute } from './compute/comments.js';
import { createFieldCompute } from './compute/fields.js';
import { createExclusion } from './compute/exclusion.js';
import { createIndexing } from './handlers/indexing.js';

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/** Whether the calling user is a Jira administrator, asked as that user. */
const isAdmin = async () => {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!res.ok) return false;
  return (await res.json()).permissions?.ADMINISTER?.havePermission === true;
};

/** The Forge app context of the running invocation, or null outside one (then the licence check fails closed). */
function currentAppContext() {
  try {
    return getAppContext();
  } catch {
    return null;
  }
}

/** Production dependencies of every handler; `retryMaxMs` caps one Jira retry sleep (queue workers pass a longer cap); all KVS access goes through the write meter; Jira points go to the process's ledger, and the site's hourly points cap comes from QUERY_POINTS_TIER or QUERY_SITE_POINTS; the index parts, the event writer and the gap filler read and write the Forge SQL index. */
export function createDeps({ retryMaxMs = RETRY_MAX_MS } = {}) {
  const logKvs = { writes: process.env.QUERY_LOG_WRITES === '1', reads: process.env.QUERY_LOG_READS === '1', requests: process.env.QUERY_LOG_REQUESTS === '1' };
  const metered = meterKvs(kvs, { readBytes: logKvs.reads });
  const points = createLedger({ kvs: metered.kvs, beginsWith: WhereConditions.beginsWith });
  const jira = appJira({ retryMaxMs, ledger: points });
  const meter = { ...metered, takeRequests: jira.takeRequests, points };
  const state = createState({ kvs: meter.kvs, hash: sha1, beginsWith: WhereConditions.beginsWith });
  const repo = createIndexRepo();
  const deps = {
    jira,
    state,
    repo,
    cache: createValueCache({ kvs: meter.kvs, hash: sha1 }),
    journal: createJournal({ kvs: meter.kvs, beginsWith: WhereConditions.beginsWith }),
    meter,
    logKvs,
    points,
    siteCap: capOf(Number(process.env.QUERY_POINTS_TIER), Number(process.env.QUERY_SITE_POINTS)),
    queue: createQueueClient(new Queue({ key: 'query-refresh' })),
    backfillQueue: createQueueClient(new Queue({ key: 'query-backfill' })),
    compute: {
      ...createHierarchyCompute({ jira }),
      ...createLinkCompute({ jira }),
      ...createBoardCompute({ jira }),
      ...createSprintCompute({ jira, repo, state, now: () => Date.now() }),
      ...createCommentCompute({ jira, repo, now: () => Date.now() }),
      ...createFieldCompute({ jira, repo, commentsShipped: () => SHIPPED_GROUPS.includes('comment'), commentGate: async () => readinessError(await state.progress.get(), 'comment') }),
    },
    exclude: createExclusion({ jira, state, now: () => Date.now() }),
    withDeadline,
    migrate: runMigrations,
    hash: sha1,
    appContext: currentAppContext,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
    levels: Number(process.env.QUERY_TREE_LEVELS) || TREE_LEVELS,
    debugEvents: process.env.QUERY_DEBUG_EVENTS === '1',
    isAdmin,
    ready: async (functionName) => readinessError(await state.progress.get(), FUNCTION_BY_NAME.get(functionName).group),
  };
  const indexing = createIndexing(deps);
  deps.indexParts = indexing.parts;
  deps.indexEvent = indexing.indexEvent;
  deps.indexReconcile = indexing.reconcileIndex;
  deps.shippedParts = indexing.shippedParts;
  return deps;
}
