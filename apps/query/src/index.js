import Resolver from '@forge/resolver';
import { createDeps } from './deps.js';
import { createFunctionHandlers } from './handlers/functions.js';
import { createResolverDefinitions } from './handlers/resolvers.js';
import { onEvent as handleEvent } from './handlers/trigger.js';
import { onRefresh as handleRefresh } from './handlers/refresh.js';
import { onReconcile as handleReconcile } from './handlers/reconcile.js';
import { WORKER_RETRY_MAX_MS } from './core/limits.js';

const deps = createDeps();
const workerDeps = createDeps({ retryMaxMs: WORKER_RETRY_MAX_MS });
const resolver = new Resolver();
for (const [key, fn] of Object.entries(createResolverDefinitions(deps))) resolver.define(key, fn);

/** Forge resolver entry point. */
export const resolverHandler = resolver.getDefinitions();

const handlers = createFunctionHandlers(deps);

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

/** Product event trigger. */
export const onEvent = (event) => handleEvent(deps, event);
/** Consumer of the query-refresh queue. */
export const onRefresh = (event) => handleRefresh(workerDeps, event);
/** Hourly reconcile. */
export const onReconcile = () => handleReconcile(workerDeps);
