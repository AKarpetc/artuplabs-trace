import { SHIPPED_GROUPS } from '../core/catalog.js';
import { sprintWindow } from '../core/boards.js';
import { extOf } from '../core/comment-clauses.js';
import {
  BACKFILL_STALE_MS, COMMENT_PAGE, INDEX_ISSUE_POINTS, INDEX_PREPARE_TTL_MS, INDEX_SLICE_MIN, RECENT_WINDOW_MARGIN_MIN, RECENT_WINDOW_MIN, RECONCILE_RECENT_MAX, SPRINT_FIELDS_TTL_MS, STATUS_REREAD_MS, STATUS_TTL_MS,
} from '../core/limits.js';
import { indexPartOf } from '../core/readiness.js';
import { sprintEvents, statusEvents, toMs } from '../core/sprint-history.js';
import { startBackfill, startWaiting } from './backfill.js';

const SPRINT_FIELD = 'com.pyxis.greenhopper.jira:gh-sprint';
const RECENT_ORDER = ' ORDER BY id ASC';
const NUMERIC = /^\d+$/;

const sprintRow = (s, boardId) => ({ id: String(s.id), boardId: String(boardId ?? s.originBoardId ?? 0), name: s.name ?? '', state: s.state ?? '', ...sprintWindow(s) });
const withProject = (rows, project) => rows.map((e) => ({ ...e, projectId: String(project.id) }));
const isStatus = (item) => item?.fieldId === 'status' || item?.field === 'status';
const ZONELESS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const COMMENT_EVENTS = new Set(['avi:jira:commented:issue', 'avi:jira:deleted:comment', 'avi:jira:created:attachment', 'avi:jira:deleted:attachment', 'avi:jira:created:issue']);

/** Time of a comment or an attachment; an attachment event writes its date without a zone, in UTC; an unreadable date falls back to the event time, else null. */
const timeOf = (value, fallback) => toMs(ZONELESS.test(String(value ?? '')) ? `${String(value).replace(' ', 'T')}Z` : value) ?? toMs(fallback);
const dated = (metas) => metas.filter((m) => m.createdAt !== null);
const commentMeta = (c, issueId, projectId, at) => ({
  id: String(c.id),
  issueId: String(issueId),
  projectId: String(projectId),
  author: c.author?.accountId ?? '',
  createdAt: timeOf(c.created, at),
  updatedAt: timeOf(c.updated, at) ?? timeOf(c.created, at),
  visType: c.visibility?.type ?? null,
  visValue: c.visibility?.value ?? c.visibility?.identifier ?? null,
});
const attachmentMeta = (a, issueId, projectId, at) => ({
  id: String(a.id),
  issueId: String(issueId),
  projectId: String(projectId),
  author: a.author?.accountId ?? '',
  createdAt: timeOf(a.created ?? a.createDate, at),
  ext: extOf(a.filename ?? a.fileName),
});

/** Index parts, the event writer and the hourly gap filler of the shipped index parts. */
export function createIndexing(deps) {
  async function sprintFieldIds() {
    const cached = await deps.state.sprintFields.get();
    if (cached && deps.now() - cached.at < SPRINT_FIELDS_TTL_MS) return new Set(cached.ids);
    const ids = ((await deps.jira.fields()) ?? []).filter((f) => f.schema?.custom === SPRINT_FIELD).map((f) => f.id);
    await deps.state.sprintFields.set({ ids, at: deps.now() });
    return new Set(ids);
  }

  /** Status categories from `cfg:status`, read again when stale or for a missing status (at most every STATUS_REREAD_MS; one Jira does not list is not asked again). */
  async function statusCategories(needed = []) {
    const cached = await deps.state.statuses.get();
    const age = cached ? deps.now() - cached.at : Infinity;
    const map = cached ? new Map(cached.categories) : null;
    const unknown = new Set(cached?.unknown ?? []);
    const missing = map ? needed.some((id) => !map.has(String(id)) && !unknown.has(String(id))) : true;
    if (map && age < STATUS_TTL_MS && !(missing && age >= STATUS_REREAD_MS)) return map;
    const categories = await deps.jira.statusCategories();
    const stillUnknown = [...new Set(needed.map(String))].filter((id) => !categories.has(id));
    const misses = [...new Set([...(map && age < STATUS_TTL_MS ? unknown : []), ...stillUnknown])];
    await deps.state.statuses.set({ at: deps.now(), categories: [...categories], ...(misses.length ? { unknown: misses } : {}) });
    return categories;
  }

  const statusIdsOf = (histories) => histories.flatMap((h) => (h.items ?? []).filter(isStatus).flatMap((i) => [String(i.from), String(i.to)]));
  const knownOnly = (histories, categories) => histories.map((h) => ({
    ...h,
    items: (h.items ?? []).filter((i) => !isStatus(i) || (categories.has(String(i.from)) && categories.has(String(i.to)))),
  }));

  async function projectOf(event) {
    return event.issue?.fields?.project ?? (await deps.jira.issue(String(event.issue.id), ['project'])).fields.project;
  }

  async function readComments(issue) {
    const list = issue.fields?.comment?.comments ?? [];
    if ((issue.fields?.comment?.total ?? 0) <= list.length) return list;
    return (await deps.jira.call('GET', `/rest/api/3/issue/${issue.id}/comment?maxResults=${COMMENT_PAGE}`))?.comments ?? [];
  }

  const parts = {
    comments: {
      tables: ['comment_meta', 'attachment_meta'],
      async prepare() {},
      async index(ids, project) {
        const comments = [];
        const attachments = [];
        for (const issue of await deps.jira.bulkIssues(ids, ['comment', 'attachment'])) {
          comments.push(...(await readComments(issue)).map((c) => commentMeta(c, issue.id, project.id)));
          attachments.push(...(issue.fields?.attachment ?? []).map((a) => attachmentMeta(a, issue.id, project.id)));
        }
        await deps.repo.upsertComments(dated(comments));
        await deps.repo.upsertAttachments(dated(attachments));
      },
    },
    sprint: {
      tables: ['sprint_event', 'status_event'],
      async prepare() {
        for (const board of await deps.jira.allBoards()) {
          if (board.type !== 'scrum') continue;
          await deps.repo.upsertSprints((await deps.jira.sprints(board.id)).map((s) => sprintRow(s, board.id)));
        }
      },
      async index(ids, project) {
        const fields = await sprintFieldIds();
        const logs = await deps.jira.changelogs(ids, [...fields, 'status']);
        const categories = await statusCategories([...logs.values()].flatMap(statusIdsOf));
        const sprintRows = [];
        const statusRows = [];
        for (const [issueId, histories] of logs) {
          sprintRows.push(...withProject(sprintEvents(issueId, histories, fields), project));
          statusRows.push(...withProject(statusEvents(issueId, knownOnly(histories, categories), categories), project));
        }
        await deps.repo.addSprintEvents(sprintRows);
        await deps.repo.addStatusEvents(statusRows);
      },
    },
  };

  const shippedParts = () => [...new Set(SHIPPED_GROUPS.map(indexPartOf).filter(Boolean))].filter((p) => parts[p]);
  const shippedTables = () => shippedParts().flatMap((p) => parts[p].tables);

  async function indexUpdate(event) {
    const items = Array.isArray(event.changelog?.items) ? event.changelog.items : [];
    const changeId = String(event.changelog?.id ?? '');
    if (!items.length || !NUMERIC.test(changeId) || !event.issue?.id) return;
    const fields = await sprintFieldIds();
    const histories = [{ id: changeId, created: event.timestamp ?? deps.now(), items }];
    const sprintRows = sprintEvents(event.issue.id, histories, fields);
    const statusChanged = items.some(isStatus);
    if (!sprintRows.length && !statusChanged) return;
    const project = await projectOf(event);
    if ((await deps.state.excluded()).includes(project.key)) return;
    if (sprintRows.length) await deps.repo.addSprintEvents(withProject(sprintRows, project));
    if (!statusChanged) return;
    const categories = await statusCategories(statusIdsOf(histories));
    const statusRows = statusEvents(event.issue.id, knownOnly(histories, categories), categories);
    if (statusRows.length) await deps.repo.addStatusEvents(withProject(statusRows, project));
  }

  async function included(event) {
    const project = await projectOf(event);
    return (await deps.state.excluded()).includes(project.key) ? null : project;
  }

  async function indexCommentEvent(type, event) {
    if (type === 'avi:jira:deleted:comment') return deps.repo.deleteComment(String(event.comment.id));
    if (type === 'avi:jira:deleted:attachment') return deps.repo.deleteAttachment(String(event.attachment.id));
    const issueId = String(event.issue?.id ?? event.attachment?.issueId);
    const project = await included(event.issue ? event : { issue: { id: issueId } });
    if (!project) return null;
    if (type === 'avi:jira:created:issue') return parts.comments.index([issueId], project);
    if (event.comment) return deps.repo.upsertComments(dated([commentMeta(event.comment, issueId, project.id, event.timestamp)]));
    return deps.repo.upsertAttachments(dated([attachmentMeta(event.attachment, issueId, project.id, event.timestamp)]));
  }

  async function indexSprintEvent(type, event) {
    if (type.startsWith('avi:jira-software:') && type.endsWith(':sprint')) {
      if (type.endsWith(':deleted:sprint')) await deps.repo.deleteSprint(String(event.sprint.id));
      else await deps.repo.upsertSprints([sprintRow(event.sprint)]);
      return;
    }
    if (type === 'avi:jira:updated:issue') await indexUpdate(event);
  }

  async function indexEvent(event) {
    const type = String(event?.eventType ?? '');
    const shipped = shippedParts();
    if (!shipped.length) return;
    if (type === 'avi:jira:deleted:issue') {
      await deps.repo.deleteIssue(String(event.issue.id), shippedTables());
      return;
    }
    if (shipped.includes('comments') && COMMENT_EVENTS.has(type)) await indexCommentEvent(type, event);
    if (shipped.includes('sprint')) await indexSprintEvent(type, event);
  }

  async function resumeStalled(part, progress) {
    if (deps.now() - (progress.savedAt ?? progress.startedAt ?? 0) < BACKFILL_STALE_MS) return;
    await deps.backfillQueue.push({ kind: 'backfill', part, generation: progress.generation });
  }

  /** The query of a check slice: issues updated since `since` (as minutes back from now), outside excluded projects, after `after`, by id. */
  async function sliceQuery(run) {
    const window = `updated >= -${Math.ceil((deps.now() - run.since) / 60000)}m`;
    const stored = await deps.state.excluded();
    const known = stored.length ? new Set((await deps.jira.projects()).map((p) => p.key)) : new Set();
    const excluded = stored.filter((k) => known.has(k));
    const scope = excluded.length ? `${window} AND project not in (${excluded.map((k) => `"${k}"`).join(', ')})` : window;
    return `${scope}${run.after ? ` AND id > ${run.after}` : ''}${RECENT_ORDER}`;
  }

  /** A new check run: its window starts at the last finished run (less a margin), at least RECENT_WINDOW_MIN back. */
  function newRun(last, startedAt) {
    const floor = startedAt - RECENT_WINDOW_MIN * 60000;
    return { since: last === null ? floor : Math.min(floor, last - RECENT_WINDOW_MARGIN_MIN * 60000), startedAt, after: null, cap: null };
  }

  /** Issues the next slice may read: what is left of RECONCILE_RECENT_MAX this run, the run's cap and what the points scope has room for. */
  function recentSlice(read, cap) {
    const scope = deps.currentPoints?.();
    const room = scope && Number.isFinite(scope.limit) ? scope.limit - scope.spent : Infinity;
    return Math.min(RECONCILE_RECENT_MAX - read, cap ?? Infinity, Math.floor(room / INDEX_ISSUE_POINTS));
  }

  async function prepareParts(list) {
    const prepared = (await deps.state.prepared.get()) ?? {};
    for (const part of list) {
      if (deps.now() - (prepared[part] ?? 0) < INDEX_PREPARE_TTL_MS) continue;
      await parts[part].prepare();
      prepared[part] = deps.now();
      await deps.state.prepared.set(prepared);
    }
  }

  async function indexSlice(list, issues) {
    const byProject = new Map();
    for (const issue of issues) {
      const p = issue.fields?.project;
      if (!p) continue;
      if (!byProject.has(p.id)) byProject.set(p.id, { project: p, ids: [] });
      byProject.get(p.id).ids.push(String(issue.id));
    }
    for (const part of list) for (const { project, ids } of byProject.values()) await parts[part].index(ids, project);
  }

  /**
   * Re-reads the recently updated issues in slices by id that fit the points left, saving the run (window start, last id read, slice cap) in
   * `idx:recent` after each slice, so a stopped run goes on with the next one; a slice the points stop halves the cap; a query Jira
   * rejects starts the window over; a finished run moves the next window start to its own start.
   */
  async function checkRecent(list, startedAt) {
    const saved = (await deps.state.recentIndex.get()) ?? { at: null, run: null };
    const run = saved.run ?? newRun(saved.at, startedAt);
    const keep = (r) => deps.state.recentIndex.set({ at: saved.at, run: r });
    await prepareParts(list);
    let read = 0;
    for (;;) {
      const size = recentSlice(read, run.cap);
      if (size < Math.min(INDEX_SLICE_MIN, run.cap ?? INDEX_SLICE_MIN)) {
        await keep(run);
        return read < RECONCILE_RECENT_MAX ? { reindexed: read, stopped: true } : { reindexed: read };
      }
      let page;
      try {
        page = await deps.jira.searchPage(await sliceQuery(run), null, { maxResults: size, fields: ['project'] });
      } catch (error) {
        if (error?.name !== 'JiraError' || error.status !== 400) throw error;
        console.error(`index check search failed: ${error.status}`);
        await keep(null);
        return { reindexed: read, failed: true };
      }
      const issues = page.issues.slice(0, size);
      try {
        await indexSlice(list, issues);
      } catch (error) {
        if (error?.name !== 'PointsError') throw error;
        await keep({ ...run, cap: Math.max(1, Math.floor(size / 2)) });
        return { reindexed: read, stopped: true };
      }
      read += issues.length;
      if (issues.length < size) {
        await deps.state.recentIndex.set({ at: run.startedAt, run: null });
        return { reindexed: read };
      }
      run.after = String(issues[issues.length - 1].id);
      await keep(run);
    }
  }

  /**
   * Hourly gap filler: starts, resumes or continues the fill of each shipped part, then re-reads the recently updated issues in slices
   * (`checkRecent`); a run the reconcile points stop is continued by the next one.
   */
  async function reconcileIndex() {
    try {
      return await checkIndex(deps.now());
    } catch (error) {
      if (error?.name !== 'PointsError') throw error;
      return { stopped: true };
    }
  }

  async function checkIndex(startedAt) {
    const shipped = shippedParts();
    if (!shipped.length) return { started: [], reindexed: 0 };
    await deps.migrate();
    const started = [];
    for (const part of shipped) {
      const progress = await deps.state.progress.getPart(part);
      if (progress?.finishedAt) await startWaiting(deps, part);
      else if (progress) await resumeStalled(part, progress);
      else {
        await startBackfill(deps, part);
        started.push(part);
      }
    }
    const recent = await checkRecent(shipped.filter((part) => !started.includes(part)), startedAt);
    return { started, ...recent };
  }

  return { parts, indexEvent, reconcileIndex, shippedParts, shippedTables };
}
