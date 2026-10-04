import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createIndexing } from '../../src/handlers/indexing.js';

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
    deps.jira.allBoards = async () => [{ id: 1, type: 'scrum' }, { id: 2, type: 'kanban' }];
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
      return { ids: ['7', '8', '9'], nextPageToken: null };
    };
    deps.jira.bulkIssues = async (ids) => ids.map((id) => ({ id, fields: { project: id === '9' ? { id: '20', key: 'B' } : { id: '10', key: 'A' } } }));
    deps.jira.projects = async () => [{ id: '10', key: 'A' }];
    deps.jira.approximateCount = async () => 3;
    deps.jira.allBoards = async () => [];
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
  it('re-reads recently updated issues project by project outside excluded projects', async () => {
    const deps = reconcileDeps();
    await built(deps);
    await deps.state.setExcluded(['X', 'Y']);
    const indexing = quiet(createIndexing(deps));
    expect(await indexing.reconcileIndex()).toEqual({ started: [], reindexed: 3 });
    expect(deps.searched).toEqual(['updated >= -2h AND project not in ("X", "Y") ORDER BY updated DESC']);
    const perProject = [[['7', '8'], { id: '10', key: 'A' }], [['9'], { id: '20', key: 'B' }]];
    expect([indexing.parts.sprint.index.mock.calls, indexing.parts.comments.index.mock.calls]).toEqual([perProject, perProject]);
  });
  it('re-reads at most 2 000 issues without a project filter when none is excluded', async () => {
    const deps = reconcileDeps();
    await built(deps);
    deps.jira.searchPage = async (jql) => {
      deps.searched.push(jql);
      return { ids: Array.from({ length: 2500 }, (_, i) => String(i)), nextPageToken: 'n' };
    };
    let asked = 0;
    deps.jira.bulkIssues = async (ids) => {
      asked = ids.length;
      return [];
    };
    expect(await createIndexing(deps).reconcileIndex()).toEqual({ started: [], reindexed: 2000 });
    expect([deps.searched, asked]).toEqual([['updated >= -2h ORDER BY updated DESC'], 2000]);
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
