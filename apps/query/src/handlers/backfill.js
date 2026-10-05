import { LOG } from '../core/errors.js';
import { BACKFILL_WAKE_DELAY_MS, CHANGELOG_BATCH, INDEX_ISSUE_POINTS, INDEX_SLICE_MIN, POINTS_OVERHEAD, WORKER_BUDGET_MS } from '../core/limits.js';
import { admit, hourKey, laneRoom, retryAfter } from '../core/points.js';
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

/** Issues the next slice may read: CHANGELOG_BATCH, or fewer when the points scope of the run has less room left. */
export function sliceSize(deps) {
  const scope = deps.currentPoints?.();
  const room = scope && Number.isFinite(scope.limit) ? scope.limit - scope.spent : Infinity;
  return Math.min(CHANGELOG_BATCH, Math.floor(room / INDEX_ISSUE_POINTS));
}

/**
 * Reads and indexes the next slice of a project (one search page of the slice size, from the saved token) and moves the cursor past it;
 * rows of a project excluded meanwhile are deleted and the project is left.
 */
async function fillSlice(deps, part, p, project, size) {
  const c = p.cursor;
  const page = await deps.jira.searchPage(`project = "${project.key}" ORDER BY id ASC`, c.token, { maxResults: size });
  const slice = page.ids.slice(0, size);
  if (slice.length) {
    await deps.indexParts[part].index(slice, project);
    if (await excludedNow(deps, project)) {
      await deps.repo.deleteProject(project.id, deps.indexParts[part].tables);
      skipProject(c);
      return;
    }
    p.done += slice.length;
  }
  if (page.nextPageToken) {
    c.token = page.nextPageToken;
    c.offset = 0;
  } else skipProject(c);
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
 * the reset; it spends the backfill points only, and when they are out it keeps its progress and queues itself for just after the next
 * allowance (half past or the hour). A `purge` job deletes the rows of the excluded projects.
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
  const room = await backfillRoom(deps);
  if (room.waitUntil) {
    await deps.state.progress.setPart(part, { ...p, savedAt: deps.now() });
    await deps.backfillQueue.push({ kind: 'backfill', part, generation }, delayUntil(deps, room.waitUntil));
    return { waiting: room.waitUntil, done: p.done };
  }
  try {
    const run = await (room.limit === Infinity ? fillPart(deps, part, generation, p) : deps.withPoints(room.limit, () => fillPart(deps, part, generation, p), { scope: 'pass' }));
    if (!run.short) return run;
    return await waitForPoints(deps, part, generation);
  } catch (error) {
    if (error?.name === 'PointsError') return waitForPoints(deps, part, generation);
    if (!isRateLimit(error)) throw error;
    console.error('backfill stopped by the Jira rate limit');
    const resume = await brake(deps, error.retryAt);
    await deps.backfillQueue.push({ kind: 'backfill', part, generation }, delayUntil(deps, resume));
    return { braked: true, done: p.done };
  }
}

/** Keeps the saved progress fresh, so the hourly check queues no second copy, and queues the job for just after the next allowance. */
async function waitForPoints(deps, part, generation) {
  const saved = await deps.state.progress.getPart(part);
  if (saved?.generation === generation && !saved.finishedAt) await deps.state.progress.setPart(part, { ...saved, savedAt: deps.now() });
  await deps.backfillQueue.push({ kind: 'backfill', part, generation }, delayUntil(deps, retryAfter(deps.now()) + BACKFILL_WAKE_DELAY_MS));
  return { stopped: true, done: saved?.done ?? 0 };
}

/** Points the next backfill run may spend: what the backfill lane has left, or the instant to try again (just after half past or the hour). */
async function backfillRoom(deps) {
  if (!deps.points || !deps.siteCap || !deps.withPoints) return { limit: Infinity };
  const at = deps.now();
  const { byLane } = await deps.points.siteSpent(hourKey(at));
  const step = admit('backfill', POINTS_OVERHEAD, byLane, at, deps.siteCap);
  if (!step.ok) return { waitUntil: step.waitUntil + BACKFILL_WAKE_DELAY_MS };
  return { limit: laneRoom('backfill', byLane, at, deps.siteCap) };
}

async function fillPart(deps, part, generation, p) {
  const deadline = deps.now() + WORKER_BUDGET_MS;
  const c = p.cursor;
  while (deps.now() < deadline) {
    const project = c.projects[c.index];
    if (!project) return finish(deps, part, p);
    if (await excludedNow(deps, project)) skipProject(c);
    else {
      const size = sliceSize(deps);
      if (size < INDEX_SLICE_MIN) return { short: true };
      await fillSlice(deps, part, p, project, size);
    }
    const current = await deps.state.progress.getPart(part);
    if (current?.generation !== generation || current.finishedAt) return { skipped: true };
    p.savedAt = deps.now();
    await deps.state.progress.setPart(part, p);
  }
  await deps.backfillQueue.push({ kind: 'backfill', part, generation });
  return { continued: true, done: p.done };
}
