import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createIndexing } from '../../src/handlers/indexing.js';
import { createJira, currentPoints, PointsError, withPoints } from '../../src/infra/jira.js';
import { INDEX_ISSUE_POINTS, RECONCILE_RECENT_MAX, STATUS_REREAD_MS, STATUS_TTL_MS } from '../../src/core/limits.js';

function makeDeps() {
  let now = 5000;
  const repo = {
    addSprintEvents: vi.fn(), addStatusEvents: vi.fn(), upsertSprints: vi.fn(), deleteSprint: vi.fn(), deleteIssue: vi.fn(),
    upsertComments: vi.fn(), deleteComment: vi.fn(), upsertAttachments: vi.fn(), deleteAttachment: vi.fn(),
  };
  const jira = {
    fields: vi.fn(async () => [{ id: 'customfield_10020', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } }, { id: 'summary', schema: {} }]),
    statusCategories: vi.fn(async () => new Map([['1', 'new'], ['2', 'done']])),
    issue: vi.fn(async () => ({ fields: { project: { id: '10', key: 'JQLG' } } })),
  };
  return { repo, jira, state: createState({ kvs: createFakeKvs() }), now: () => now, advance: (ms) => { now += ms; } };
}
const updated = (items) => ({ eventType: 'avi:jira:updated:issue', timestamp: 4000, issue: { id: '7', fields: { project: { id: '10', key: 'JQLG' } } }, changelog: { id: '900', items } });
const SPRINT_ITEM = { field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '5' };

describe('indexEvent', () => {
  it('stores sprint and status changes of an updated issue with its project', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(updated([SPRINT_ITEM, { field: 'status', fieldId: 'status', from: '1', to: '2' }]));
    expect(deps.repo.addSprintEvents).toHaveBeenCalledWith([{ issueId: '7', projectId: '10', sprintId: '5', kind: 'added', at: 4000, changeId: '900' }]);
    expect(deps.repo.addStatusEvents).toHaveBeenCalledWith([{ issueId: '7', projectId: '10', at: 4000, from: 'new', to: 'done', changeId: '900' }]);
  });
  it('reads the time of the event from its string timestamp', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent({ ...updated([SPRINT_ITEM]), timestamp: '1790584137824' });
    expect(deps.repo.addSprintEvents.mock.calls[0][0][0].at).toBe(1790584137824);
  });
  it('skips issues of excluded projects', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['JQLG']);
    await createIndexing(deps).indexEvent(updated([SPRINT_ITEM]));
    expect(deps.repo.addSprintEvents).not.toHaveBeenCalled();
  });
  it('reads the project of an issue whose event does not carry it', async () => {
    const deps = makeDeps();
    const event = updated([SPRINT_ITEM]);
    delete event.issue.fields;
    await createIndexing(deps).indexEvent(event);
    expect(deps.jira.issue).toHaveBeenCalledWith('7', ['project']);
    expect(deps.repo.addSprintEvents.mock.calls[0][0][0].projectId).toBe('10');
  });
  it('writes nothing for a change of other fields and asks no status categories', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(updated([{ field: 'summary', fieldId: 'summary', from: 'a', to: 'b' }]));
    expect([deps.repo.addSprintEvents.mock.calls, deps.repo.addStatusEvents.mock.calls, deps.jira.statusCategories.mock.calls]).toEqual([[], [], []]);
  });
  it('writes no status row when the category stays the same', async () => {
    const deps = makeDeps();
    deps.jira.statusCategories = async () => new Map([['1', 'new'], ['2', 'new']]);
    await createIndexing(deps).indexEvent(updated([{ field: 'status', fieldId: 'status', from: '1', to: '2' }]));
    expect(deps.repo.addStatusEvents).not.toHaveBeenCalled();
  });
  it('leaves an update without a numeric change id and other events to the hourly gap filler', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent({ ...updated([SPRINT_ITEM]), changelog: { items: [SPRINT_ITEM] } });
    await indexing.indexEvent({ ...updated([]) });
    await indexing.indexEvent(null);
    expect(deps.repo.addSprintEvents).not.toHaveBeenCalled();
    expect(deps.jira.issue).not.toHaveBeenCalled();
  });
  it('caches the ids of the Sprint fields for a day', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(updated([SPRINT_ITEM]));
    await indexing.indexEvent(updated([SPRINT_ITEM]));
    expect(deps.jira.fields).toHaveBeenCalledTimes(1);
    expect(await deps.state.sprintFields.get()).toEqual({ ids: ['customfield_10020'], at: 5000 });
    deps.advance(24 * 60 * 60 * 1000);
    await indexing.indexEvent(updated([SPRINT_ITEM]));
    expect(deps.jira.fields).toHaveBeenCalledTimes(2);
  });
  it('keeps sprint dates and drops deleted sprints and issues', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent({ eventType: 'avi:jira-software:started:sprint', sprint: { id: 5, name: 'S5', state: 'active', startDate: '2026-01-01T00:00:00Z', originBoardId: 2 } });
    expect(deps.repo.upsertSprints).toHaveBeenCalledWith([{ id: '5', boardId: '2', name: 'S5', state: 'active', startAt: Date.UTC(2026, 0, 1), completeAt: null }]);
    await indexing.indexEvent({ eventType: 'avi:jira-software:deleted:sprint', sprint: { id: 5 } });
    expect(deps.repo.deleteSprint).toHaveBeenCalledWith('5');
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '7' } });
    expect(deps.repo.deleteIssue).toHaveBeenCalledWith('7', indexing.shippedTables());
    expect(indexing.shippedTables()).toEqual(['sprint_event', 'status_event', 'comment_meta', 'attachment_meta']);
  });
  it('stores a sprint event of the live shape with its Jira offset dates', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent({ eventType: 'avi:jira-software:closed:sprint', sprint: { id: '34', originBoardId: '36', state: 'closed', startDate: '2026-09-30T14:29:46.516+0200', completeDate: '2026-10-01T10:00:00.000+0200' } });
    expect(deps.repo.upsertSprints).toHaveBeenCalledWith([{ id: '34', boardId: '36', name: '', state: 'closed', startAt: Date.UTC(2026, 8, 30, 12, 29, 46, 516), completeAt: Date.UTC(2026, 9, 1, 8) }]);
  });
});

describe('shipped parts', () => {
  it('ships the sprint part and the comment part with their functions', () => {
    const indexing = createIndexing(makeDeps());
    expect([indexing.shippedParts(), indexing.shippedTables()]).toEqual([['sprint', 'comments'], ['sprint_event', 'status_event', 'comment_meta', 'attachment_meta']]);
  });
});

describe('sprint part', () => {
  it('reads the sprints of scrum boards only', async () => {
    const deps = makeDeps();
    deps.jira.boardPage = async () => ({ values: [{ id: 1, type: 'scrum' }, { id: 2, type: 'kanban' }], isLast: true });
    deps.jira.sprints = vi.fn(async () => [{ id: 3, name: 'S3', state: 'future' }]);
    await createIndexing(deps).parts.sprint.prepare();
    expect(deps.jira.sprints.mock.calls).toEqual([[1]]);
    expect(deps.repo.upsertSprints).toHaveBeenCalledWith([{ id: '3', boardId: '1', name: 'S3', state: 'future', startAt: null, completeAt: null }]);
  });
  it('indexes the changelogs of a slice of issues with their project', async () => {
    const deps = makeDeps();
    deps.jira.changelogs = vi.fn(async () => new Map([
      ['7', [{ id: '901', created: '2026-01-02T00:00:00.000+0000', items: [SPRINT_ITEM, { field: 'status', fieldId: 'status', from: '1', to: '2' }] }]],
      ['8', []],
    ]));
    await createIndexing(deps).parts.sprint.index(['7', '8'], { id: 10, key: 'JQLG' });
    expect(deps.jira.changelogs).toHaveBeenCalledWith(['7', '8'], ['customfield_10020', 'status']);
    const at = Date.UTC(2026, 0, 2);
    expect(deps.repo.addSprintEvents).toHaveBeenCalledWith([{ issueId: '7', projectId: '10', sprintId: '5', kind: 'added', at, changeId: '901' }]);
    expect(deps.repo.addStatusEvents).toHaveBeenCalledWith([{ issueId: '7', projectId: '10', at, from: 'new', to: 'done', changeId: '901' }]);
  });
});

describe('reconcileIndex', () => {
  function reconcileDeps() {
    const deps = makeDeps();
    deps.migrate = vi.fn(async () => {});
    deps.searched = [];
    deps.jira.searchPage = async (jql) => {
      deps.searched.push(jql);
      const issues = ['7', '8', '9'].map((id) => ({ id, fields: { project: id === '9' ? { id: '20', key: 'B' } : { id: '10', key: 'A' } } }));
      return { ids: ['7', '8', '9'], issues, nextPageToken: null };
    };
    deps.jira.projects = async () => [{ id: '10', key: 'A' }, { id: '20', key: 'B' }];
    deps.jira.approximateCount = async () => 3;
    deps.jira.boardPage = async () => ({ values: [], isLast: true });
    deps.backfillQueue = { push: vi.fn(async () => {}) };
    return deps;
  }
  const built = async (deps) => {
    for (const part of ['sprint', 'comments']) await deps.state.progress.setPart(part, { readyAt: 1, finishedAt: 1 });
  };
  const quiet = (indexing) => {
    indexing.parts.sprint.index = vi.fn();
    indexing.parts.comments.index = vi.fn();
    return indexing;
  };

  it('starts a part that was never built instead of re-reading it', async () => {
    const deps = reconcileDeps();
    const indexing = createIndexing(deps);
    deps.indexParts = indexing.parts;
    quiet(indexing);
    expect(await indexing.reconcileIndex()).toEqual({ started: ['sprint', 'comments'], reindexed: 3 });
    expect(deps.migrate).toHaveBeenCalled();
    expect(deps.backfillQueue.push.mock.calls).toEqual([[{ kind: 'backfill', part: 'sprint', generation: 5000 }], [{ kind: 'backfill', part: 'comments', generation: 5000 }]]);
    expect([indexing.parts.sprint.index.mock.calls, indexing.parts.comments.index.mock.calls]).toEqual([[], []]);
  });
  it('re-reads recently updated issues project by project outside excluded projects, naming only projects Jira knows', async () => {
    const deps = reconcileDeps();
    await built(deps);
    deps.jira.projects = async () => [{ id: '10', key: 'A' }, { id: '30', key: 'X' }];
    await deps.state.setExcluded(['GONE', 'X']);
    const indexing = quiet(createIndexing(deps));
    expect(await indexing.reconcileIndex()).toEqual({ started: [], reindexed: 3 });
    expect(deps.searched).toEqual(['updated >= -120m AND project not in ("X") ORDER BY id ASC']);
    const perProject = [[['7', '8'], { id: '10', key: 'A' }], [['9'], { id: '20', key: 'B' }]];
    expect([indexing.parts.sprint.index.mock.calls, indexing.parts.comments.index.mock.calls]).toEqual([perProject, perProject]);
  });
  it('re-reads at most 2 000 issues a run, without a project filter when none is excluded, and keeps the rest for the next run', async () => {
    const deps = reconcileDeps();
    await built(deps);
    deps.jira.searchPage = async (jql, token, { maxResults }) => {
      deps.searched.push([jql, token, maxResults]);
      const issues = Array.from({ length: maxResults }, (_, i) => ({ id: String(i), fields: { project: { id: '10', key: 'A' } } }));
      return { ids: issues.map((x) => x.id), issues, nextPageToken: 'n' };
    };
    const indexing = createIndexing(deps);
    indexing.parts.sprint.index = vi.fn();
    indexing.parts.comments.index = vi.fn();
    expect(await indexing.reconcileIndex()).toEqual({ started: [], reindexed: 2000 });
    expect(deps.searched).toEqual([['updated >= -120m ORDER BY id ASC', null, 2000]]);
    expect((await deps.state.recentIndex.get()).run).toMatchObject({ after: '1999' });
  });
  it('queues a backfill again when it saved nothing for half an hour', async () => {
    const deps = reconcileDeps();
    await built(deps);
    await deps.state.progress.setPart('sprint', { generation: 7, startedAt: 0, savedAt: 1000, finishedAt: null, readyAt: null });
    const indexing = quiet(createIndexing(deps));
    await indexing.reconcileIndex();
    expect(deps.backfillQueue.push).not.toHaveBeenCalled();
    deps.advance(30 * 60 * 1000);
    await indexing.reconcileIndex();
    expect(deps.backfillQueue.push).toHaveBeenCalledWith({ kind: 'backfill', part: 'sprint', generation: 7 });
  });
  it('starts the projects kept for later of a finished part, and leaves those of a running part alone', async () => {
    const deps = reconcileDeps();
    await built(deps);
    await deps.state.progress.setPart('comments', { generation: 7, startedAt: 5000, finishedAt: null, readyAt: 1 });
    await deps.state.waiting.add('sprint', [{ id: '20', key: 'B' }]);
    await deps.state.waiting.add('comments', [{ id: '20', key: 'B' }]);
    const indexing = createIndexing(deps);
    deps.indexParts = indexing.parts;
    quiet(indexing);
    await indexing.reconcileIndex();
    expect(deps.backfillQueue.push.mock.calls).toEqual([[{ kind: 'backfill', part: 'sprint', generation: 5000 }]]);
    expect((await deps.state.progress.getPart('sprint')).cursor.projects).toEqual([{ id: '20', key: 'B' }]);
    expect([await deps.state.waiting.get('sprint'), await deps.state.waiting.get('comments')]).toEqual([[], [{ id: '20', key: 'B' }]]);
  });
});

describe('comment and attachment events', () => {
  const commented = (comment = {}) => ({
    eventType: 'avi:jira:commented:issue',
    timestamp: '1790584137824',
    issue: { id: '7', fields: { project: { id: '10', key: 'JQLG' } } },
    comment: { id: '55', author: { accountId: 'a' }, created: '2026-01-01T05:00:00.000+0500', updated: '2026-01-01T05:00:00.000+0500', ...comment },
  });
  const attachment = (extra = {}) => ({
    eventType: 'avi:jira:created:attachment',
    timestamp: '1790584137824',
    attachment: { id: '9', issueId: '7', projectId: '10', fileName: 'Report.PDF', createDate: '2026-01-02 00:00:00.000', author: { accountId: 'a' }, ...extra },
  });

  it('stores comment metadata with visibility and drops deleted comments', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(commented({ visibility: { type: 'role', value: 'Developers', identifier: 'Developers' } }));
    expect(deps.repo.upsertComments).toHaveBeenCalledWith([{ id: '55', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 0, 1), visType: 'role', visValue: 'Developers' }]);
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:comment', issue: { id: '7' }, comment: { id: '55' } });
    expect(deps.repo.deleteComment).toHaveBeenCalledWith('55');
  });
  it('stores an edited comment, which arrives as a new comment event, with its new visibility', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(commented({ updated: '2026-01-03T00:00:00.000+0000', visibility: { type: 'group', value: 'jira-staff', identifier: 'f1e2' } }));
    expect(deps.repo.upsertComments.mock.calls[0][0][0]).toMatchObject({ updatedAt: Date.UTC(2026, 0, 3), visType: 'group', visValue: 'jira-staff' });
  });
  it('stores a visible-to-all comment without visibility', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(commented());
    expect(deps.repo.upsertComments.mock.calls[0][0][0]).toMatchObject({ visType: null, visValue: null });
  });
  it('stores attachments of the live event shape with the extension the conditions use, in UTC', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(attachment());
    expect(deps.jira.issue).toHaveBeenCalledWith('7', ['project']);
    expect(deps.repo.upsertAttachments).toHaveBeenCalledWith([{ id: '9', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 2), ext: 'pdf' }]);
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:attachment', attachment: { id: '9', issueId: '7' } });
    expect(deps.repo.deleteAttachment).toHaveBeenCalledWith('9');
  });
  it('takes the event time when an attachment carries no readable date, and no extension from a name without one', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(attachment({ fileName: 'README', createDate: undefined }));
    expect(deps.repo.upsertAttachments.mock.calls[0][0][0]).toMatchObject({ createdAt: 1790584137824, ext: '' });
  });
  it('skips comments and attachments of excluded projects', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['JQLG']);
    const indexing = createIndexing(deps);
    await indexing.indexEvent(commented());
    await indexing.indexEvent(attachment());
    expect([deps.repo.upsertComments.mock.calls, deps.repo.upsertAttachments.mock.calls]).toEqual([[], []]);
  });
  it('reads the comments and attachments of a created issue', async () => {
    const deps = makeDeps();
    deps.jira.bulkIssues = vi.fn(async () => [{ id: '7', fields: { comment: { total: 0, comments: [] }, attachment: [{ id: '3', filename: 'a.TXT', author: { accountId: 'a' }, created: '2026-01-02T00:00:00.000+0000' }] } }]);
    await createIndexing(deps).indexEvent({ eventType: 'avi:jira:created:issue', issue: { id: '7', fields: { project: { id: '10', key: 'JQLG' } } } });
    expect(deps.jira.bulkIssues).toHaveBeenCalledWith(['7'], ['comment', 'attachment']);
    expect(deps.repo.upsertAttachments).toHaveBeenCalledWith([{ id: '3', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 2), ext: 'txt' }]);
  });
  it('drops the comments and attachments of a deleted issue with the sprint rows', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '7' } });
    expect(deps.repo.deleteIssue).toHaveBeenCalledWith('7', ['sprint_event', 'status_event', 'comment_meta', 'attachment_meta']);
  });
});

describe('comment part dates', () => {
  it('skips a comment or an attachment whose date cannot be read instead of storing it at 1970', async () => {
    const deps = makeDeps();
    deps.jira.bulkIssues = async () => [{ id: '7', fields: { comment: { total: 2, comments: [{ id: '1', author: { accountId: 'a' } }, { id: '2', author: { accountId: 'a' }, created: '2026-01-01T00:00:00.000+0000', updated: 'garbage' }] }, attachment: [{ id: '4', filename: 'x.pdf', created: 'soon' }] } }];
    await createIndexing(deps).parts.comments.index(['7'], { id: '10', key: 'JQLG' });
    expect(deps.repo.upsertComments).toHaveBeenCalledWith([{ id: '2', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 0, 1), visType: null, visValue: null }]);
    expect(deps.repo.upsertAttachments).toHaveBeenCalledWith([]);
  });
});

describe('comment part', () => {
  it('reads every comment of an issue whose bulkfetch list is cut', async () => {
    const deps = makeDeps();
    deps.jira.bulkIssues = async () => [{ id: '7', fields: { comment: { total: 2, comments: [{ id: '1', author: { accountId: 'a' }, created: 1 }] }, attachment: [] } }];
    deps.jira.call = vi.fn(async () => ({ comments: [{ id: '1', author: { accountId: 'a' }, created: 1 }, { id: '2', author: { accountId: 'b' }, created: 2 }] }));
    await createIndexing(deps).parts.comments.index(['7'], { id: '10', key: 'JQLG' });
    expect(deps.jira.call).toHaveBeenCalledWith('GET', '/rest/api/3/issue/7/comment?maxResults=5000');
    expect(deps.repo.upsertComments.mock.calls[0][0].map((m) => m.id)).toEqual(['1', '2']);
  });
  it('stores the comments and attachments of a slice with their project and needs no preparation', async () => {
    const deps = makeDeps();
    deps.jira.bulkIssues = vi.fn(async () => [
      { id: '7', fields: { comment: { total: 1, comments: [{ id: '1', author: { accountId: 'a' }, created: '2026-01-01T00:00:00.000+0000', visibility: { type: 'role', value: 'Admins' } }] }, attachment: [{ id: '4', filename: 'x.Docx', author: { accountId: 'b' }, created: '2026-01-02T00:00:00.000+0000' }] } },
      { id: '8', fields: {} },
    ]);
    deps.jira.call = vi.fn();
    const part = createIndexing(deps).parts.comments;
    await part.prepare();
    await part.index(['7', '8'], { id: 10, key: 'JQLG' });
    expect(deps.jira.call).not.toHaveBeenCalled();
    expect(deps.repo.upsertComments).toHaveBeenCalledWith([{ id: '1', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 0, 1), visType: 'role', visValue: 'Admins' }]);
    expect(deps.repo.upsertAttachments).toHaveBeenCalledWith([{ id: '4', issueId: '7', projectId: '10', author: 'b', createdAt: Date.UTC(2026, 0, 2), ext: 'docx' }]);
  });
});

describe('status categories cache', () => {
  const statusChange = { field: 'status', fieldId: 'status', from: '1', to: '2' };
  it('asks Jira for the status categories once an hour', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(updated([statusChange]));
    await indexing.indexEvent({ ...updated([statusChange]), changelog: { id: '901', items: [statusChange] } });
    expect(deps.jira.statusCategories).toHaveBeenCalledTimes(1);
    deps.advance(STATUS_TTL_MS);
    await indexing.indexEvent({ ...updated([statusChange]), changelog: { id: '902', items: [statusChange] } });
    expect(deps.jira.statusCategories).toHaveBeenCalledTimes(2);
  });
  it('keeps only the id and category of each status', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(updated([statusChange]));
    expect(await deps.state.statuses.get()).toEqual({ at: 5000, categories: [['1', 'new'], ['2', 'done']] });
  });
});

describe('reconcileIndex window and budget', () => {
  function windowDeps() {
    const deps = makeDeps();
    deps.migrate = vi.fn(async () => {});
    deps.searched = [];
    deps.jira.searchPage = async (jql, token, options) => {
      deps.searched.push([jql, options?.maxResults ?? null]);
      return { ids: ['7'], issues: [{ id: '7', fields: { project: { id: '10', key: 'A' } } }], nextPageToken: null };
    };
    deps.jira.projects = async () => [{ id: '10', key: 'A' }];
    deps.jira.boardPage = async () => ({ values: [], isLast: true });
    deps.backfillQueue = { push: vi.fn(async () => {}) };
    return deps;
  }
  const built = async (deps) => {
    for (const part of ['sprint', 'comments']) await deps.state.progress.setPart(part, { readyAt: 1, finishedAt: 1 });
  };
  it('asks for one page of at most the recent issues it re-reads', async () => {
    const deps = windowDeps();
    await built(deps);
    const indexing = createIndexing(deps);
    indexing.parts.sprint.index = vi.fn();
    indexing.parts.comments.index = vi.fn();
    await indexing.reconcileIndex();
    expect(deps.searched).toEqual([['updated >= -120m ORDER BY id ASC', RECONCILE_RECENT_MAX]]);
  });
  it('widens its window to the last check it finished', async () => {
    const deps = windowDeps();
    await built(deps);
    const indexing = createIndexing(deps);
    indexing.parts.sprint.index = vi.fn();
    indexing.parts.comments.index = vi.fn();
    await indexing.reconcileIndex();
    deps.advance(3 * 60 * 60 * 1000);
    await indexing.reconcileIndex();
    expect(deps.searched[1][0]).toEqual('updated >= -190m ORDER BY id ASC');
  });
  it('stops when the reconcile points run out and goes on with the same window start the next hour', async () => {
    const deps = windowDeps();
    await built(deps);
    const indexing = createIndexing(deps);
    indexing.parts.sprint.index = vi.fn();
    indexing.parts.comments.index = vi.fn();
    await indexing.reconcileIndex();
    deps.advance(60 * 60 * 1000);
    indexing.parts.sprint.index = vi.fn(async () => { throw new PointsError('pass', 10, 10); });
    expect(await indexing.reconcileIndex()).toMatchObject({ stopped: true });
    deps.advance(2 * 60 * 60 * 1000);
    indexing.parts.sprint.index = vi.fn();
    await indexing.reconcileIndex();
    expect(deps.searched[2][0]).toEqual('updated >= -240m ORDER BY id ASC');
  });
});

describe('new statuses', () => {
  const change = (from, to, id) => ({ ...updated([{ field: 'status', fieldId: 'status', from, to }]), changelog: { id, items: [{ field: 'status', fieldId: 'status', from, to }] } });
  it('reads the statuses again when an event names one the cache does not know', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(change('1', '2', '900'));
    deps.jira.statusCategories = vi.fn(async () => new Map([['1', 'new'], ['2', 'done'], ['3', 'indeterminate']]));
    deps.advance(STATUS_REREAD_MS);
    await indexing.indexEvent(change('2', '3', '901'));
    expect(deps.repo.addStatusEvents.mock.calls.at(-1)[0]).toEqual([{ issueId: '7', projectId: '10', at: 4000, from: 'done', to: 'indeterminate', changeId: '901' }]);
  });
  it('reads the statuses once for a status Jira does not list, not again until they expire', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(change('1', '2', '900'));
    deps.advance(STATUS_REREAD_MS);
    await indexing.indexEvent(change('2', '9', '901'));
    deps.advance(STATUS_REREAD_MS);
    await indexing.indexEvent(change('2', '9', '902'));
    expect(deps.jira.statusCategories).toHaveBeenCalledTimes(2);
  });
  it('writes no status row for a status it still does not know, so the index check reads it later', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent(change('1', '2', '900'));
    deps.repo.addStatusEvents.mockClear();
    await indexing.indexEvent(change('2', '9', '901'));
    expect([deps.repo.addStatusEvents.mock.calls, deps.jira.statusCategories.mock.calls.length]).toEqual([[], 1]);
  });
});

describe('index check with the real points scope', () => {
  const T0 = Date.parse('2026-10-05T07:10:00Z');
  function realDeps(total, { projects = 1, tokenLife = 30 * 60 * 1000, fieldCap = Infinity, boards = 0, sprintsPer = 0, goneBoards = new Set() } = {}) {
    const deps = makeDeps();
    let now = T0;
    deps.now = () => now;
    deps.advance = (ms) => { now += ms; };
    deps.currentPoints = currentPoints;
    deps.withPoints = withPoints;
    deps.migrate = vi.fn(async () => {});
    deps.backfillQueue = { push: vi.fn(async () => {}) };
    deps.repo.addSprintEvents = vi.fn();
    deps.repo.addStatusEvents = vi.fn();
    deps.repo.upsertComments = vi.fn();
    deps.repo.upsertAttachments = vi.fn();
    deps.searched = [];
    deps.read = [];
    const issues = Array.from({ length: total }, (_, i) => ({ id: String(i + 1), fields: { project: { id: String(10 + (i % projects)), key: `P${i % projects}` } } }));
    const tokens = new Map();
    const ok = (body) => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    const bad = (message) => ({ status: 400, headers: { get: () => null }, text: async () => JSON.stringify({ errorMessages: [message] }) });
    deps.jira = createJira(async (path, init) => {
      const body = init.body ? JSON.parse(init.body) : {};
      if (path.includes('search/jql')) {
        deps.searched.push(body);
        if (body.nextPageToken && now - tokens.get(body.nextPageToken) > tokenLife) return bad('The provided next page token is invalid or expired.');
        if (/id > [^\d]/.test(body.jql)) return bad('The value is not valid.');
        const after = Number(/id > (\d+)/.exec(body.jql)?.[1] ?? 0);
        const from = body.nextPageToken ? Number(body.nextPageToken) : issues.findIndex((x) => Number(x.id) > after);
        const step = Math.min(body.maxResults, body.fields.includes('project') ? fieldCap : Infinity);
        const page = from < 0 ? [] : issues.slice(from, from + step);
        const next = from + step;
        if (next < issues.length) tokens.set(String(next), now);
        return ok({ issues: page, ...(from >= 0 && next < issues.length ? { nextPageToken: String(next) } : {}) });
      }
      if (path.includes('changelog/bulkfetch')) {
        deps.read.push(...body.issueIdsOrKeys);
        return ok({ issueChangeLogs: [] });
      }
      if (path.includes('issue/bulkfetch')) return ok({ issues: body.issueIdsOrKeys.map((id) => ({ id, fields: { comment: { comments: [], total: 0 }, attachment: [] } })) });
      if (path.includes('/status')) return ok([]);
      if (path.includes('/field')) return ok([]);
      const sprintsOf = /\/board\/(\d+)\/sprint/.exec(path);
      if (sprintsOf && goneBoards.has(Number(sprintsOf[1]))) return { status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ errorMessages: ['Board does not exist'] }) };
      if (sprintsOf) return ok({ values: Array.from({ length: sprintsPer }, (_, i) => ({ id: Number(sprintsOf[1]) * 100 + i, name: 's', state: 'closed' })), isLast: true });
      if (path.includes('/agile/1.0/board')) {
        deps.boardReads = (deps.boardReads ?? 0) + 1;
        const startAt = Number(/startAt=(\d+)/.exec(path)?.[1] ?? 0);
        const all = Array.from({ length: boards }, (_, i) => ({ id: i + 1, type: 'scrum' }));
        return ok({ values: all.slice(startAt, startAt + 50), isLast: startAt + 50 >= all.length });
      }
      return ok({ values: [], isLast: true });
    });
    deps.repo.upsertSprints = vi.fn();
    return deps;
  }
  const built = async (deps) => {
    for (const part of ['sprint', 'comments']) await deps.state.progress.setPart(part, { readyAt: 1, finishedAt: 1 });
  };
  const run = (deps, indexing, limit) => withPoints(limit, () => indexing.reconcileIndex(), { scope: 'pass', lane: 'reconcile' });
  async function hours(deps, limit, most = 12) {
    const indexing = createIndexing(deps);
    const results = [];
    for (let hour = 0; hour < most && (results.length === 0 || (await deps.state.recentIndex.get())?.run); hour += 1) {
      results.push(await run(deps, indexing, limit));
      deps.advance(60 * 60 * 1000);
    }
    return results;
  }
  it('reads slices that fit what the points have left, by id', async () => {
    const deps = realDeps(500);
    await built(deps);
    await run(deps, createIndexing(deps), 800);
    expect(deps.searched[0].maxResults).toBeLessThanOrEqual(Math.floor(800 / INDEX_ISSUE_POINTS));
    expect(deps.searched[0].jql).toContain('ORDER BY id ASC');
  });
  it('goes on after the last issue it read, never by a page token, and reads each issue once even when tokens expire', async () => {
    const deps = realDeps(500);
    await built(deps);
    const results = await hours(deps, 800);
    expect([(await deps.state.recentIndex.get()).run, results.length > 1, deps.searched.every((b) => !b.nextPageToken)]).toEqual([null, true, true]);
    expect([new Set(deps.read).size, deps.read.length]).toEqual([500, 500]);
  });
  it('finishes a window spread over many projects by halving a slice the points stop', async () => {
    const deps = realDeps(500, { projects: 200 });
    await built(deps);
    await hours(deps, 800, 24);
    expect([(await deps.state.recentIndex.get()).run, new Set(deps.read).size]).toEqual([null, 500]);
  });
  it('starts over from the window, logging it, when Jira rejects the saved query', async () => {
    const deps = realDeps(10);
    await built(deps);
    await deps.state.recentIndex.set({ at: null, run: { since: T0 - 7200000, startedAt: T0, after: 'x' } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const indexing = createIndexing(deps);
    const first = await run(deps, indexing, 800);
    error.mockRestore();
    expect([first.failed, (await deps.state.recentIndex.get()).run]).toEqual([true, null]);
  });
  it('reads the whole window when Jira returns pages shorter than asked', async () => {
    const deps = realDeps(500, { fieldCap: 100 });
    await built(deps);
    await hours(deps, 800);
    expect([(await deps.state.recentIndex.get()).run, new Set(deps.read).size]).toEqual([null, 500]);
  });
  it('still reads issue slices while preparing many boards a part at a time', async () => {
    const deps = realDeps(300, { boards: 100, sprintsPer: 10 });
    await built(deps);
    const indexing = createIndexing(deps);
    for (let hour = 0; hour < 3; hour += 1) {
      await run(deps, indexing, 200);
      deps.advance(60 * 60 * 1000);
    }
    expect([deps.read.length > 0, (await deps.state.prepared.get()).sprint.progress.listAt > 0]).toEqual([true, true]);
    for (let hour = 0; hour < 24 && !((await deps.state.prepared.get()).sprint.at > 0); hour += 1) {
      await run(deps, indexing, 200);
      deps.advance(60 * 60 * 1000);
    }
    expect((await deps.state.prepared.get()).sprint.at).toBeGreaterThan(0);
  });
  it('grows a halved slice back after slices that went through', async () => {
    const deps = realDeps(300);
    await built(deps);
    await deps.state.recentIndex.set({ at: null, run: { since: T0 - 7200000, startedAt: T0, after: null, cap: 10 } });
    await run(deps, createIndexing(deps), 900);
    expect(deps.searched.slice(0, 3).map((b) => b.maxResults)).toEqual([10, 20, 40]);
  });
  it('reads issue slices every hour while a list of a thousand boards is read a page at a time', async () => {
    const deps = realDeps(300, { boards: 1000, sprintsPer: 1 });
    await built(deps);
    const indexing = createIndexing(deps);
    const perHour = [];
    for (let hour = 0; hour < 4; hour += 1) {
      const before = deps.read.length;
      await run(deps, indexing, 200);
      perHour.push(deps.read.length - before);
      deps.advance(60 * 60 * 1000);
    }
    expect(perHour.every((n) => n > 0)).toBe(true);
    expect((await deps.state.prepared.get()).sprint.progress.listAt).toBeGreaterThan(0);
  });
  it('goes on with the recent issues when a project kept for later is gone from Jira', async () => {
    const deps = realDeps(20);
    await built(deps);
    await deps.state.waiting.add('sprint', [{ id: '99', key: 'GONE' }]);
    deps.jira.projects = async () => [{ id: '10', key: 'P0' }];
    deps.jira.approximateCount = async () => { throw Object.assign(new Error('gone'), { name: 'JiraError', status: 400 }); };
    const results = [];
    for (let hour = 0; hour < 3; hour += 1) {
      results.push(await run(deps, createIndexing(deps), 800));
      deps.advance(60 * 60 * 1000);
    }
    expect([results[0].reindexed, await deps.state.waiting.get('sprint')]).toEqual([20, []]);
  });
  it('goes past a board deleted while the boards are prepared, without stopping the reconcile', async () => {
    const goneBoards = new Set();
    const deps = realDeps(10, { boards: 100, sprintsPer: 1, goneBoards });
    await built(deps);
    const indexing = createIndexing(deps);
    await run(deps, indexing, 300);
    const next = (await deps.state.prepared.get()).sprint.progress.next;
    goneBoards.add(next + 1);
    for (let hour = 0; hour < 24 && !((await deps.state.prepared.get()).sprint.at > 0); hour += 1) {
      deps.advance(60 * 60 * 1000);
      await run(deps, indexing, 300);
    }
    expect((await deps.state.prepared.get()).sprint.at).toBeGreaterThan(0);
  });
  it('logs a failure while preparing the boards without its text and goes on with the reconcile', async () => {
    const deps = realDeps(10, { boards: 5, sprintsPer: 1 });
    await built(deps);
    deps.jira.boardPage = async () => { throw Object.assign(new Error('secret board name'), { name: 'JiraError', status: 500 }); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await run(deps, createIndexing(deps), 300);
    expect(error.mock.calls.map((c) => c.join(' ')).some((l) => l.includes('secret'))).toBe(false);
    error.mockRestore();
    expect([result.reindexed, (await deps.state.errors())[0].message]).toEqual([10, 'Index boards could not be read']);
  });
});
