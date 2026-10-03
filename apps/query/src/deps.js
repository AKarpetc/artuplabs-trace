import { createHash } from 'node:crypto';
import { getAppContext } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { Queue } from '@forge/events';
import { FUNCTION_BY_NAME } from './core/catalog.js';
import { TREE_LEVELS } from './core/limits.js';
import { readinessError } from './core/readiness.js';
import { appJira } from './infra/jira.js';
import { createValueCache } from './infra/cache.js';
import { createJournal } from './infra/journal.js';
import { createState } from './infra/state.js';
import { createQueueClient } from './infra/queue.js';
import { createHierarchyCompute } from './compute/hierarchy.js';
import { createLinkCompute } from './compute/links.js';
import { createBoardCompute } from './compute/boards.js';

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/** The Forge app context of the running invocation, or null outside one (then the licence check fails closed). */
function currentAppContext() {
  try {
    return getAppContext();
  } catch {
    return null;
  }
}

/** Production dependencies of every handler. */
export function createDeps() {
  const jira = appJira();
  const state = createState({ kvs, hash: sha1, beginsWith: WhereConditions.beginsWith });
  return {
    jira,
    state,
    cache: createValueCache({ kvs, hash: sha1 }),
    journal: createJournal({ kvs, beginsWith: WhereConditions.beginsWith }),
    queue: createQueueClient(new Queue({ key: 'query-refresh' })),
    backfillQueue: createQueueClient(new Queue({ key: 'query-backfill' })),
    compute: { ...createHierarchyCompute({ jira }), ...createLinkCompute({ jira }), ...createBoardCompute({ jira }) },
    indexEvent: async () => null,
    indexReconcile: async () => null,
    appContext: currentAppContext,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
    levels: Number(process.env.QUERY_TREE_LEVELS) || TREE_LEVELS,
    debugEvents: process.env.QUERY_DEBUG_EVENTS === '1',
    ready: async (functionName) => readinessError(await state.progress.get(), FUNCTION_BY_NAME.get(functionName).group),
  };
}
