import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createIndexing } from '../../src/handlers/indexing.js';

vi.mock('../../src/core/catalog.js', async (orig) => ({ ...(await orig()), SHIPPED_GROUPS: ['query', 'site', 'board', 'sprint'] }));

function makeDeps() {
  let now = 5000;
  const repo = { addSprintEvents: vi.fn(), addStatusEvents: vi.fn(), upsertSprints: vi.fn(), deleteSprint: vi.fn(), deleteIssue: vi.fn() };
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
    await indexing.indexEvent({ eventType: 'avi:jira:created:issue', issue: { id: '7' } });
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
    expect(indexing.shippedTables()).toEqual(['sprint_event', 'status_event']);
  });
  it('stores a sprint event of the live shape with its Jira offset dates', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent({ eventType: 'avi:jira-software:closed:sprint', sprint: { id: '34', originBoardId: '36', state: 'closed', startDate: '2026-09-30T14:29:46.516+0200', completeDate: '2026-10-01T10:00:00.000+0200' } });
    expect(deps.repo.upsertSprints).toHaveBeenCalledWith([{ id: '34', boardId: '36', name: '', state: 'closed', startAt: Date.UTC(2026, 8, 30, 12, 29, 46, 516), completeAt: Date.UTC(2026, 9, 1, 8) }]);
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

  it('starts a part that was never built instead of re-reading it', async () => {
    const deps = reconcileDeps();
    const indexing = createIndexing(deps);
    deps.indexParts = indexing.parts;
    indexing.parts.sprint.index = vi.fn();
    expect(await indexing.reconcileIndex()).toEqual({ started: ['sprint'], reindexed: 3 });
    expect(deps.migrate).toHaveBeenCalled();
    expect(deps.backfillQueue.push).toHaveBeenCalledWith({ kind: 'backfill', part: 'sprint', generation: 5000 });
    expect(indexing.parts.sprint.index).not.toHaveBeenCalled();
  });
  it('re-reads recently updated issues project by project outside excluded projects', async () => {
    const deps = reconcileDeps();
    await deps.state.progress.setPart('sprint', { readyAt: 1, finishedAt: 1 });
    await deps.state.setExcluded(['X', 'Y']);
    const indexing = createIndexing(deps);
    indexing.parts.sprint.index = vi.fn();
    expect(await indexing.reconcileIndex()).toEqual({ started: [], reindexed: 3 });
    expect(deps.searched).toEqual(['updated >= -2h AND project not in ("X", "Y") ORDER BY updated DESC']);
    expect(indexing.parts.sprint.index.mock.calls).toEqual([[['7', '8'], { id: '10', key: 'A' }], [['9'], { id: '20', key: 'B' }]]);
  });
  it('re-reads at most 2 000 issues without a project filter when none is excluded', async () => {
    const deps = reconcileDeps();
    await deps.state.progress.setPart('sprint', { readyAt: 1, finishedAt: 1 });
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
    await deps.state.progress.setPart('sprint', { generation: 7, startedAt: 0, savedAt: 1000, finishedAt: null, readyAt: null });
    const indexing = createIndexing(deps);
    indexing.parts.sprint.index = vi.fn();
    await indexing.reconcileIndex();
    expect(deps.backfillQueue.push).not.toHaveBeenCalled();
    deps.advance(30 * 60 * 1000);
    await indexing.reconcileIndex();
    expect(deps.backfillQueue.push).toHaveBeenCalledWith({ kind: 'backfill', part: 'sprint', generation: 7 });
  });
});
