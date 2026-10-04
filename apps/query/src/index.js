import Resolver from '@forge/resolver';
import { createDeps } from './deps.js';
import { createFunctionHandlers } from './handlers/functions.js';
import { createResolverDefinitions } from './handlers/resolvers.js';
import { onEvent as handleEvent } from './handlers/trigger.js';
import { onRefresh as handleRefresh } from './handlers/refresh.js';
import { onReconcile as handleReconcile } from './handlers/reconcile.js';
import { onBackfill as handleBackfill } from './handlers/backfill.js';
import { onLifecycle as handleLifecycle } from './handlers/lifecycle.js';
import { WORKER_RETRY_MAX_MS } from './core/limits.js';
import { withKvsLog } from './infra/meter.js';

const deps = createDeps();
const workerDeps = createDeps({ retryMaxMs: WORKER_RETRY_MAX_MS });
const resolver = new Resolver();
for (const [key, fn] of Object.entries(createResolverDefinitions(deps))) resolver.define(key, fn);

/** Forge resolver entry point. */
export const resolverHandler = resolver.getDefinitions();

const handlers = Object.fromEntries(Object.entries(createFunctionHandlers(deps)).map(([name, fn]) => [name, withKvsLog(name, deps.meter, deps.logKvs, fn)]));

export const subtasksOf = handlers.subtasksOf;
export const parentsOf = handlers.parentsOf;
export const epicsOf = handlers.epicsOf;
export const issuesInEpics = handlers.issuesInEpics;
export const childIssuesOf = handlers.childIssuesOf;
export const linkedIssuesOf = handlers.linkedIssuesOf;
export const linkedIssuesOfRecursive = handlers.linkedIssuesOfRecursive;
export const linkedIssuesOfRecursiveLimited = handlers.linkedIssuesOfRecursiveLimited;
export const hasLinks = handlers.hasLinks;
export const hasLinkType = handlers.hasLinkType;
export const hasSubtasks = handlers.hasSubtasks;
export const previousSprint = handlers.previousSprint;
export const nextSprint = handlers.nextSprint;
export const addedAfterSprintStart = handlers.addedAfterSprintStart;
export const removedAfterSprintStart = handlers.removedAfterSprintStart;
export const incompleteInSprint = handlers.incompleteInSprint;
export const completeInSprint = handlers.completeInSprint;
export const commented = handlers.commented;
export const lastComment = handlers.lastComment;
export const hasComments = handlers.hasComments;
export const fileAttached = handlers.fileAttached;
export const hasAttachments = handlers.hasAttachments;
export const dateCompare = handlers.dateCompare;
export const expression = handlers.expression;

/** Product event trigger: Forge gives a trigger no custom timeout, so it keeps the short retry cap of a function call and a failed index write is left to the hourly gap filler. */
export const onEvent = withKvsLog('on-event', deps.meter, deps.logKvs, (event) => handleEvent(deps, event));
/** Consumer of the query-refresh queue. */
export const onRefresh = withKvsLog((event) => `on-refresh:${event?.body?.verify ? 'verify' : event?.body?.kind}`, workerDeps.meter, workerDeps.logKvs, (event) => handleRefresh(workerDeps, event));
/** Hourly reconcile. */
export const onReconcile = withKvsLog('on-reconcile', workerDeps.meter, workerDeps.logKvs, () => handleReconcile(workerDeps));
/** Consumer of the query-backfill queue. */
export const onBackfill = withKvsLog('on-backfill', workerDeps.meter, workerDeps.logKvs, (event) => handleBackfill(workerDeps, event));
/** App installed or upgraded (a trigger: the default timeout, so a part's preparation that runs out is redone by the hourly gap filler). */
export const onLifecycle = withKvsLog('on-lifecycle', workerDeps.meter, workerDeps.logKvs, () => handleLifecycle(workerDeps));
