import { describe, expect, it, vi } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createJournal } from '../../src/infra/journal.js';
import { createAdminActions } from '../../src/handlers/admin.js';
import { EXCLUDED_KIND } from '../../src/core/affected.js';
import { EXCLUDED_MAX } from '../../src/core/limits.js';

function makeDeps({ admin = true } = {}) {
  const kvs = createFakeKvs();
  const state = createState({ kvs, hash: (s) => s, beginsWith });
  return {
    state,
    isAdmin: async () => admin,
    now: () => 50,
    repo: { deleteProject: vi.fn(async () => {}), clear: vi.fn(async () => {}) },
    jira: { projects: async () => [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], approximateCount: async () => 10 },
    indexParts: { sprint: { tables: ['sprint_event', 'status_event'], prepare: async () => {} } },
    shippedParts: () => ['sprint'],
    backfillQueue: { push: vi.fn(async () => {}) },
    journal: createJournal({ kvs, beginsWith, random: () => 'r' }),
    queue: { push: vi.fn(async () => {}) },
  };
}
const DEV = { environmentType: 'DEVELOPMENT' };

describe('admin actions', () => {
  it('refuses a user who is not a Jira administrator', async () => {
    await expect(createAdminActions(makeDeps({ admin: false })).setExcluded({ projectKeys: ['A'] }, DEV)).rejects.toThrow('forbidden');
  });
  it('excludes projects and deletes their index rows', async () => {
    const deps = makeDeps();
    expect(await createAdminActions(deps).setExcluded({ projectKeys: ['B', 'A', 'B'] }, DEV)).toEqual({ excluded: ['A', 'B'] });
    expect(deps.repo.deleteProject.mock.calls).toEqual([['1', ['sprint_event', 'status_event']], ['2', ['sprint_event', 'status_event']]]);
  });
  it('rejects malformed project keys', async () => {
    await expect(createAdminActions(makeDeps()).setExcluded({ projectKeys: ['a b'] }, DEV)).rejects.toThrow('bad-request');
  });
  it('reindexes one project only when no full fill is running', async () => {
    const deps = makeDeps();
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: null, readyAt: null });
    await expect(createAdminActions(deps).reindexProject({ projectKey: 'A' }, DEV)).rejects.toThrow('busy');
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: 9, readyAt: 9 });
    expect(await createAdminActions(deps).reindexProject({ projectKey: 'A' }, DEV)).toEqual({ started: ['sprint'] });
    expect(deps.repo.deleteProject).toHaveBeenCalledWith('1', ['sprint_event', 'status_event']);
    expect((await deps.state.progress.getPart('sprint')).readyAt).toBe(9);
  });
  it('resets the index and builds it again from scratch', async () => {
    const deps = makeDeps();
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: 9, readyAt: 9 });
    expect(await createAdminActions(deps).resetIndex({}, DEV)).toEqual({ started: ['sprint'] });
    expect(deps.repo.clear).toHaveBeenCalledWith(['sprint_event', 'status_event']);
    expect((await deps.state.progress.getPart('sprint')).readyAt).toBeNull();
  });

  it('refuses every action without a licence, before asking Jira who the user is', async () => {
    const deps = makeDeps();
    deps.isAdmin = vi.fn(async () => true);
    const actions = createAdminActions(deps);
    const prod = { environmentType: 'PRODUCTION', license: { active: false } };
    for (const key of ['adminStatus', 'setExcluded', 'reindexProject', 'resetIndex']) await expect(actions[key]({}, prod)).rejects.toThrow('unlicensed');
    expect(deps.isAdmin).not.toHaveBeenCalled();
  });
  it('refuses every action to a user who is not an administrator, changing nothing', async () => {
    const deps = makeDeps({ admin: false });
    const actions = createAdminActions(deps);
    for (const key of ['adminStatus', 'reindexProject', 'resetIndex']) await expect(actions[key]({ projectKey: 'A' }, DEV)).rejects.toThrow('forbidden');
    expect([deps.repo.clear.mock.calls.length, deps.repo.deleteProject.mock.calls.length, await deps.state.excluded()]).toEqual([0, 0, []]);
  });
  it('reports the excluded projects, the index progress and the shipped parts', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['B']);
    await deps.state.progress.setPart('sprint', { done: 1, total: 2, finishedAt: null });
    expect(await createAdminActions(deps).adminStatus({}, DEV)).toEqual({ excluded: ['B'], progress: { sprint: { done: 1, total: 2, finishedAt: null } }, parts: ['sprint'] });
  });
  it('rejects a list that is not an array or longer than the limit', async () => {
    const actions = createAdminActions(makeDeps());
    await expect(actions.setExcluded({ projectKeys: 'A' }, DEV)).rejects.toThrow('bad-request');
    await expect(actions.setExcluded({}, DEV)).rejects.toThrow('bad-request');
    const many = Array.from({ length: EXCLUDED_MAX + 1 }, (_, i) => `P${i}`);
    await expect(actions.setExcluded({ projectKeys: many }, DEV)).rejects.toThrow('bad-request');
    await expect(actions.setExcluded({ projectKeys: [7] }, DEV)).rejects.toThrow('bad-request');
  });
  it('deletes the rows of every shipped part of a newly excluded project only', async () => {
    const deps = makeDeps();
    deps.indexParts.comments = { tables: ['comment_meta', 'attachment_meta'], prepare: async () => {} };
    deps.shippedParts = () => ['comments', 'sprint'];
    await deps.state.setExcluded(['A']);
    await createAdminActions(deps).setExcluded({ projectKeys: ['A', 'B'] }, DEV);
    expect(deps.repo.deleteProject.mock.calls).toEqual([['2', ['comment_meta', 'attachment_meta']], ['2', ['sprint_event', 'status_event']]]);
  });
  it('rewrites every stored root after a change of the list: journals a change of all groups and queues a refresh', async () => {
    const deps = makeDeps();
    await createAdminActions(deps).setExcluded({ projectKeys: ['A'] }, DEV);
    const rows = await deps.journal.read(10);
    expect(rows.map((r) => r.value)).toEqual([{ ids: [], kinds: [EXCLUDED_KIND] }]);
    expect(deps.queue.push).toHaveBeenCalledWith({ kind: 'refresh', ts: 50 }, undefined);
    expect(await deps.state.pending.get()).toBe(50);
  });
  it('saves the list before journaling, so the refresh reads the new list', async () => {
    const deps = makeDeps();
    const seen = [];
    const append = deps.journal.append;
    deps.journal.append = async (record, ts) => {
      seen.push(await deps.state.excluded());
      return append(record, ts);
    };
    await createAdminActions(deps).setExcluded({ projectKeys: ['B'] }, DEV);
    expect(seen).toEqual([['B']]);
  });
  it('backfills a project that returns to the index when no fill runs', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['A', 'B']);
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: 9, readyAt: 9 });
    await createAdminActions(deps).setExcluded({ projectKeys: ['B'] }, DEV);
    const p = await deps.state.progress.getPart('sprint');
    expect([p.cursor.projects, p.readyAt, p.finishedAt]).toEqual([[{ id: '1', key: 'A' }], 9, null]);
    expect(deps.backfillQueue.push).toHaveBeenCalledWith({ kind: 'backfill', part: 'sprint', generation: 50 });
    expect(deps.repo.deleteProject).not.toHaveBeenCalled();
  });
  it('keeps a returning project for later while a fill of the part runs, without stopping that fill', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['A']);
    const running = { generation: 1, finishedAt: null, readyAt: null, cursor: { projects: [{ id: '2', key: 'B' }], index: 0, token: null, offset: 0 } };
    await deps.state.progress.setPart('sprint', running);
    await createAdminActions(deps).setExcluded({ projectKeys: [] }, DEV);
    expect(await deps.state.progress.getPart('sprint')).toEqual(running);
    expect(await deps.state.waiting.get('sprint')).toEqual([{ id: '1', key: 'A' }]);
    expect(deps.backfillQueue.push).not.toHaveBeenCalled();
  });
  it('answers not-found for a project Jira does not know and bad-request for a malformed key', async () => {
    const actions = createAdminActions(makeDeps());
    await expect(actions.reindexProject({ projectKey: 'ZZ' }, DEV)).rejects.toThrow('not-found');
    await expect(actions.reindexProject({ projectKey: 'a-b' }, DEV)).rejects.toThrow('bad-request');
    await expect(actions.reindexProject({}, DEV)).rejects.toThrow('bad-request');
  });
  it('refuses to reindex an excluded project', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['A']);
    await expect(createAdminActions(deps).reindexProject({ projectKey: 'A' }, DEV)).rejects.toThrow('bad-request');
    expect(deps.repo.deleteProject).not.toHaveBeenCalled();
  });
  it('drops projects kept for later on a reset, whose fill covers them', async () => {
    const deps = makeDeps();
    await deps.state.waiting.add('sprint', [{ id: '1', key: 'A' }]);
    await createAdminActions(deps).resetIndex({}, DEV);
    expect(await deps.state.waiting.get('sprint')).toEqual([]);
    expect((await deps.state.progress.getPart('sprint')).cursor.projects).toEqual([{ id: '1', key: 'A' }, { id: '2', key: 'B' }]);
  });
});
