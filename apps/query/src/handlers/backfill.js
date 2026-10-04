import { LOG } from '../core/errors.js';
import { CHANGELOG_BATCH, WORKER_BUDGET_MS } from '../core/limits.js';
import { REWRITE_ALL_KIND } from '../core/affected.js';
import { indexReadyKind } from '../core/readiness.js';
import { pushRefresh } from './refresh.js';
import { brake, brakedUntil, delayUntil, isRateLimit } from './brake.js';

const inList = (projects) => projects.map((p) => `"${p.key}"`).join(', ');
const excludedNow = async (deps, project) => (await deps.state.excluded()).includes(project.key);

/** Starts filling one index part for every project not excluded (or the given ones, marked partial); an earlier readyAt is kept; the job is queued before the part's preparation, which the hourly gap filler repeats. */
export async function startBackfill(deps, part, { projects } = {}) {
  const excluded = new Set(await deps.state.excluded());
  const scope = projects ?? (await deps.jira.projects()).filter((p) => !excluded.has(p.key));
  const old = await deps.state.progress.getPart(part);
  const total = scope.length ? await deps.jira.approximateCount(`project in (${inList(scope)})`) : 0;
  const progress = { generation: deps.now(), startedAt: deps.now(), done: 0, total, cursor: { projects: scope, index: 0, token: null, offset: 0 }, finishedAt: null, readyAt: old?.readyAt ?? null, ...(projects ? { partial: true } : {}) };
  await deps.state.progress.setPart(part, progress);
  await deps.backfillQueue.push({ kind: 'backfill', part, generation: progress.generation });
  await deps.indexParts[part].prepare();
  return progress;
}

/**
 * Journals a change of every group that reads the finished part and queues a refresh, so precomputations stored while it was building are
 * recomputed; after a fill of chosen projects every stored precomputation is rewritten, used or not, since idle ones were stored without
 * those projects; a failure is logged without values.
 */
async function refreshReaders(deps, part, partial) {
  try {
    await deps.journal.append({ ids: [], kinds: [partial ? REWRITE_ALL_KIND : indexReadyKind(part)] }, deps.now());
    await pushRefresh(deps, deps.now());
  } catch {
    console.error(LOG.indexRefreshNotQueued());
  }
}

/** Fills the given projects of one part now, or keeps them for when the running fill of that part ends (the hourly gap filler starts them too); a part never built is built in full. */
export async function backfillProjects(deps, part, projects) {
  const p = await deps.state.progress.getPart(part);
  if (!p) return startBackfill(deps, part);
  if (!p.finishedAt) {
    await deps.state.waiting.add(part, projects);
    return null;
  }
  return startBackfill(deps, part, { projects });
}

/** Starts the projects kept for one part unless a fill of it runs; a part never built is built in full, which covers them. */
export async function fillWaiting(deps, part) {
  const p = await deps.state.progress.getPart(part);
  if (!p) {
    const progress = await startBackfill(deps, part);
    await deps.state.waiting.clear(part);
    return progress;
  }
  return p.finishedAt ? startWaiting(deps, part) : null;
}

/** Deletes the index rows of every excluded project in every shipped part within the worker budget, then queues itself for the rest; idempotent, and a project that returned meanwhile is left alone. */
export async function purgeExcluded(deps) {
  const excluded = new Set(await deps.state.excluded());
  if (!excluded.size) return { purged: 0 };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  let purged = 0;
  for (const project of (await deps.jira.projects()).filter((p) => excluded.has(p.key))) {
    if (deps.now() >= deadline) {
      await deps.backfillQueue.push({ kind: 'purge' });
      return { purged, continued: true };
    }
    for (const part of deps.shippedParts()) {
      if (!(await excludedNow(deps, project))) break;
      await deps.repo.deleteProject(project.id, deps.indexParts[part].tables);
    }
    purged += 1;
  }
  return { purged };
}

/** Starts the fill of the projects kept for one part, then forgets them; null when none wait. */
export async function startWaiting(deps, part) {
  const projects = await deps.state.waiting.get(part);
  if (!projects.length) return null;
  const progress = await startBackfill(deps, part, { projects });
  await deps.state.waiting.remove(part, projects.map((p) => p.key));
  return progress;
}

const skipProject = (c) => {
  c.index += 1;
  c.token = null;
  c.offset = 0;
};

/** Indexes the next slice of the current page and moves the cursor; rows of a project excluded meanwhile are deleted and the project is left. Returns the page to go on with, or null. */
async function fillSlice(deps, part, p, project, page) {
  const c = p.cursor;
  const slice = page.ids.slice(c.offset, c.offset + CHANGELOG_BATCH);
  if (slice.length) {
    await deps.indexParts[part].index(slice, project);
    if (await excludedNow(deps, project)) {
      await deps.repo.deleteProject(project.id, deps.indexParts[part].tables);
      skipProject(c);
      return null;
    }
    p.done += slice.length;
    c.offset += slice.length;
  }
  if (c.offset < page.ids.length) return page;
  if (page.nextPageToken) {
    c.token = page.nextPageToken;
    c.offset = 0;
  } else skipProject(c);
  return null;
}

async function finish(deps, part, p) {
  await deps.state.progress.setPart(part, { ...p, cursor: null, finishedAt: deps.now(), readyAt: p.readyAt ?? deps.now() });
  await refreshReaders(deps, part, Boolean(p.partial));
  await startWaiting(deps, part);
  return { finished: true, done: p.done };
}

/**
 * Backfill consumer: slices of issue ids, project by project, within the budget, leaving out projects excluded since the fill started;
 * then it queues itself to continue; it stops when a newer backfill started or another copy of this job finished the part; a finished
 * part starts the projects kept for it; while the background waits for Jira's rate limit, or when a 429 stops a slice, it queues itself for
 * the reset. A `purge` job deletes the rows of the excluded projects.
 */
export async function onBackfill(deps, event) {
  if (event?.body?.kind === 'purge') return purgeExcluded(deps);
  const { part, generation } = event?.body ?? {};
  const p = part && deps.indexParts[part] ? await deps.state.progress.getPart(part) : null;
  if (!p || p.generation !== generation || p.finishedAt) return { skipped: true };
  const until = await brakedUntil(deps);
  if (until) {
    await deps.backfillQueue.push({ kind: 'backfill', part, generation }, delayUntil(deps, until));
    return { braked: until };
  }
  try {
    return await fillPart(deps, part, generation, p);
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    console.error('backfill stopped by the Jira rate limit');
    const resume = await brake(deps, error.retryAt);
    await deps.backfillQueue.push({ kind: 'backfill', part, generation }, delayUntil(deps, resume));
    return { braked: true, done: p.done };
  }
}

async function fillPart(deps, part, generation, p) {
  const deadline = deps.now() + WORKER_BUDGET_MS;
  const c = p.cursor;
  let page = null;
  while (deps.now() < deadline) {
    const project = c.projects[c.index];
    if (!project) return finish(deps, part, p);
    if (await excludedNow(deps, project)) {
      skipProject(c);
      page = null;
    } else {
      page = await fillSlice(deps, part, p, project, page ?? (await deps.jira.searchPage(`project = "${project.key}" ORDER BY id ASC`, c.token)));
    }
    const current = await deps.state.progress.getPart(part);
    if (current?.generation !== generation || current.finishedAt) return { skipped: true };
    p.savedAt = deps.now();
    await deps.state.progress.setPart(part, p);
  }
  await deps.backfillQueue.push({ kind: 'backfill', part, generation });
  return { continued: true, done: p.done };
}
