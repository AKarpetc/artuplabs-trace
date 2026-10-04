import { CHANGELOG_BATCH, WORKER_BUDGET_MS } from '../core/limits.js';

const inList = (projects) => projects.map((p) => `"${p.key}"`).join(', ');

/** Starts filling one index part for every project not excluded (or the given ones); an earlier readyAt is kept; the job is queued before the part's preparation, which the hourly gap filler repeats. */
export async function startBackfill(deps, part, { projects } = {}) {
  const excluded = new Set(await deps.state.excluded());
  const scope = projects ?? (await deps.jira.projects()).filter((p) => !excluded.has(p.key));
  const old = await deps.state.progress.getPart(part);
  const total = scope.length ? await deps.jira.approximateCount(`project in (${inList(scope)})`) : 0;
  const progress = { generation: deps.now(), startedAt: deps.now(), done: 0, total, cursor: { projects: scope, index: 0, token: null, offset: 0 }, finishedAt: null, readyAt: old?.readyAt ?? null };
  await deps.state.progress.setPart(part, progress);
  await deps.backfillQueue.push({ kind: 'backfill', part, generation: progress.generation });
  await deps.indexParts[part].prepare();
  return progress;
}

/** Backfill consumer: slices of issue ids, project by project, within the budget; then it queues itself to continue. */
export async function onBackfill(deps, event) {
  const { part, generation } = event?.body ?? {};
  const p = part && deps.indexParts[part] ? await deps.state.progress.getPart(part) : null;
  if (!p || p.generation !== generation || p.finishedAt) return { skipped: true };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  const c = p.cursor;
  let page = null;
  while (deps.now() < deadline) {
    const project = c.projects[c.index];
    if (!project) {
      await deps.state.progress.setPart(part, { ...p, cursor: null, finishedAt: deps.now(), readyAt: p.readyAt ?? deps.now() });
      return { finished: true, done: p.done };
    }
    if (!page) page = await deps.jira.searchPage(`project = "${project.key}" ORDER BY id ASC`, c.token);
    const slice = page.ids.slice(c.offset, c.offset + CHANGELOG_BATCH);
    if (slice.length) {
      await deps.indexParts[part].index(slice, project);
      p.done += slice.length;
      c.offset += slice.length;
    }
    if (c.offset >= page.ids.length) {
      if (page.nextPageToken) c.token = page.nextPageToken;
      else {
        c.index += 1;
        c.token = null;
      }
      c.offset = 0;
      page = null;
    }
    if ((await deps.state.progress.getPart(part))?.generation !== generation) return { skipped: true };
    p.savedAt = deps.now();
    await deps.state.progress.setPart(part, p);
  }
  await deps.backfillQueue.push({ kind: 'backfill', part, generation });
  return { continued: true, done: p.done };
}
