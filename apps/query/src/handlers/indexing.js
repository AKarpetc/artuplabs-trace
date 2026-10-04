import { SHIPPED_GROUPS } from '../core/catalog.js';
import { sprintWindow } from '../core/boards.js';
import { extOf } from '../core/comment-clauses.js';
import { BACKFILL_STALE_MS, COMMENT_PAGE, RECONCILE_RECENT_MAX, SPRINT_FIELDS_TTL_MS } from '../core/limits.js';
import { indexPartOf } from '../core/readiness.js';
import { sprintEvents, statusEvents, toMs } from '../core/sprint-history.js';
import { startBackfill } from './backfill.js';

const SPRINT_FIELD = 'com.pyxis.greenhopper.jira:gh-sprint';
const RECENT_JQL = 'updated >= -2h';
const RECENT_ORDER = ' ORDER BY updated DESC';
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
        const categories = await deps.jira.statusCategories();
        const logs = await deps.jira.changelogs(ids, [...fields, 'status']);
        const sprintRows = [];
        const statusRows = [];
        for (const [issueId, histories] of logs) {
          sprintRows.push(...withProject(sprintEvents(issueId, histories, fields), project));
          statusRows.push(...withProject(statusEvents(issueId, histories, categories), project));
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
    const statusRows = statusEvents(event.issue.id, histories, await deps.jira.statusCategories());
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
    if (progress.finishedAt || deps.now() - (progress.savedAt ?? progress.startedAt ?? 0) < BACKFILL_STALE_MS) return;
    await deps.backfillQueue.push({ kind: 'backfill', part, generation: progress.generation });
  }

  async function recentByProject() {
    const excluded = await deps.state.excluded();
    const scope = excluded.length ? `${RECENT_JQL} AND project not in (${excluded.map((k) => `"${k}"`).join(', ')})` : RECENT_JQL;
    const recent = (await deps.jira.searchPage(`${scope}${RECENT_ORDER}`, null)).ids.slice(0, RECONCILE_RECENT_MAX);
    const byProject = new Map();
    for (const issue of await deps.jira.bulkIssues(recent, ['project'])) {
      const p = issue.fields.project;
      if (!byProject.has(p.id)) byProject.set(p.id, { project: p, ids: [] });
      byProject.get(p.id).ids.push(String(issue.id));
    }
    return { recent, byProject };
  }

  async function reconcileIndex() {
    const shipped = shippedParts();
    if (!shipped.length) return { started: [], reindexed: 0 };
    await deps.migrate();
    const started = [];
    for (const part of shipped) {
      const progress = await deps.state.progress.getPart(part);
      if (progress) await resumeStalled(part, progress);
      else {
        await startBackfill(deps, part);
        started.push(part);
      }
    }
    const { recent, byProject } = await recentByProject();
    for (const part of shipped) {
      if (started.includes(part)) continue;
      await parts[part].prepare();
      for (const { project, ids } of byProject.values()) await parts[part].index(ids, project);
    }
    return { started, reindexed: recent.length };
  }

  return { parts, indexEvent, reconcileIndex, shippedParts, shippedTables };
}
