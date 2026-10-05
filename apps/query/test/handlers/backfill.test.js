import { describe, expect, it, vi } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createJournal } from '../../src/infra/journal.js';
import { createState } from '../../src/infra/state.js';
import { backfillProjects, onBackfill, startBackfill } from '../../src/handlers/backfill.js';
import { REWRITE_ALL_KIND } from '../../src/core/affected.js';
import { createJira, currentPoints, withPoints } from '../../src/infra/jira.js';
import { createLedger, newProcessPoints } from '../../src/infra/points.js';

function makeDeps({ pages, cost = 0 }) {
  let now = 1000;
  const kvs = createFakeKvs();
  kvs.data.set('cfg:excluded', ['X']);
  const pushed = [];
  const indexed = [];
  const counted = [];
  const queued = [];
  const delays = [];
  return {
    state: createState({ kvs }),
    journal: createJournal({ kvs, beginsWith, random: () => 'r' }),
    queue: { push: async (body) => { queued.push(body); } },
    queued,
    jira: {
      projects: async () => [{ id: '1', key: 'A' }, { id: '2', key: 'B' }, { id: '3', key: 'X' }],
      approximateCount: async (jql) => {
        counted.push(jql);
        return jql.includes('"X"') ? 99 : 4500;
      },
      searchPage: async (jql, token, { maxResults = 5000 } = {}) => {
        const all = pages[/project = "([^"]+)"/.exec(jql)[1]] ?? [];
        const from = Number(token ?? 0);
        const next = from + maxResults;
        return { ids: all.slice(from, next), nextPageToken: next < all.length ? String(next) : null };
      },
    },
    indexParts: { sprint: { prepare: vi.fn(async () => {}), index: async (ids, project) => { indexed.push([project.key, ids.length]); now += cost; } } },
    backfillQueue: { push: async (body, delay) => { pushed.push(body); delays.push(delay ?? null); } },
    delays,
    now: () => now,
    pushed,
    indexed,
    counted,
  };
}
const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));
const PAGES = { A: ids(6500), B: ids(10, 9001) };

describe('backfill', () => {
  it('starts with the projects that are not excluded (X) and keeps an earlier readyAt', async () => {
    const deps = makeDeps({ pages: PAGES });
    await deps.state.progress.setPart('sprint', { readyAt: 7 });
    const p = await startBackfill(deps, 'sprint');
    expect(p).toEqual({ generation: 1000, startedAt: 1000, done: 0, total: 4500, cursor: { projects: [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], index: 0, token: null, offset: 0 }, finishedAt: null, readyAt: 7 });
    expect(deps.counted).toEqual(['project in ("A", "B")']);
    expect(deps.indexParts.sprint.prepare).toHaveBeenCalled();
    expect(deps.pushed).toEqual([{ kind: 'backfill', part: 'sprint', generation: 1000 }]);
  });
  it('walks pages and projects in slices of 1 000 and marks the part ready', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ finished: true, done: 6510 });
    expect(deps.indexed).toEqual([['A', 1000], ['A', 1000], ['A', 1000], ['A', 1000], ['A', 1000], ['A', 1000], ['A', 500], ['B', 10]]);
    const p = await deps.state.progress.getPart('sprint');
    expect([p.finishedAt, p.readyAt, p.cursor]).toEqual([1000, 1000, null]);
  });
  it('saves the cursor and queues itself when the budget is spent', async () => {
    const deps = makeDeps({ pages: PAGES, cost: 100000 });
    await startBackfill(deps, 'sprint');
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ continued: true, done: 3000 });
    const saved = await deps.state.progress.getPart('sprint');
    expect(saved.cursor).toEqual({ projects: [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], index: 0, token: '3000', offset: 0 });
    expect(saved.savedAt).toBe(301000);
    expect(deps.pushed.at(-1)).toEqual({ kind: 'backfill', part: 'sprint', generation: 1000 });
  });
  it('resumes from the saved cursor on the next run', async () => {
    const deps = makeDeps({ pages: PAGES, cost: 100000 });
    await startBackfill(deps, 'sprint');
    await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } });
    deps.indexed.length = 0;
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ continued: true, done: 6000 });
    expect(deps.indexed).toEqual([['A', 1000], ['A', 1000], ['A', 1000]]);
    expect((await deps.state.progress.getPart('sprint')).cursor).toMatchObject({ index: 0, token: '6000', offset: 0 });
  });
  it('ignores a job of an older generation', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 5 } })).toEqual({ skipped: true });
  });
  it('stops without saving when a newer backfill started during the run', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    deps.indexParts.sprint.index = async () => {
      await deps.state.progress.setPart('sprint', { generation: 2000, done: 0 });
    };
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ skipped: true });
    expect(await deps.state.progress.getPart('sprint')).toEqual({ generation: 2000, done: 0 });
  });
  it('skips a finished part, an unknown part and a job without a body', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } });
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ skipped: true });
    await deps.state.progress.setPart('comments', { generation: 1, cursor: { projects: [], index: 0, token: null, offset: 0 } });
    expect(await onBackfill(deps, { body: { part: 'comments', generation: 1 } })).toEqual({ skipped: true });
    expect(await onBackfill(deps, undefined)).toEqual({ skipped: true });
  });
  it('asks a refresh of the groups that read the part once it is ready', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } });
    expect((await deps.journal.read(10)).map((r) => r.value)).toEqual([{ ids: [], kinds: ['index-sprint'] }]);
    expect([deps.queued, await deps.state.pending.get()]).toEqual([[{ kind: 'refresh', ts: 1000 }], 1000]);
  });
  it('still finishes, with a log line free of values, when the refresh cannot be asked', async () => {
    const deps = makeDeps({ pages: PAGES });
    deps.journal.append = async () => { throw Object.assign(new Error('JQLG secret'), { status: 503 }); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startBackfill(deps, 'sprint');
    const out = await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } });
    const lines = error.mock.calls.map((c) => c.join(' '));
    error.mockRestore();
    expect([out, (await deps.state.progress.getPart('sprint')).readyAt, lines]).toEqual([{ finished: true, done: 6510 }, 1000, ['Refresh after the index build was not queued']]);
  });
  it('stops without saving when another copy of the same job finished the part during the slice', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    const finished = { generation: 1000, done: 6510, cursor: null, finishedAt: 1000, readyAt: 1000 };
    deps.indexParts.sprint.index = async () => {
      await deps.state.progress.setPart('sprint', finished);
    };
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ skipped: true });
    expect(await deps.state.progress.getPart('sprint')).toEqual(finished);
  });
  it('fills only the given projects and finishes at once without any', async () => {
    const deps = makeDeps({ pages: PAGES });
    const p = await startBackfill(deps, 'sprint', { projects: [] });
    expect([p.total, p.cursor.projects, deps.counted]).toEqual([0, [], []]);
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ finished: true, done: 0 });
    expect((await startBackfill(deps, 'sprint', { projects: [{ id: '2', key: 'B' }] })).total).toBe(4500);
    expect(deps.counted).toEqual(['project in ("B")']);
  });
  it('skips a project excluded after the fill started', async () => {
    const deps = makeDeps({ pages: PAGES });
    deps.repo = { deleteProject: vi.fn(async () => {}) };
    deps.indexParts.sprint.tables = ['sprint_event'];
    await startBackfill(deps, 'sprint');
    await deps.state.setExcluded(['A', 'X']);
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ finished: true, done: 10 });
    expect(deps.indexed).toEqual([['B', 10]]);
    expect(deps.repo.deleteProject).not.toHaveBeenCalled();
  });
  it('deletes what it wrote of a project excluded while its slice was being written', async () => {
    const deps = makeDeps({ pages: { B: ids(10, 9001) } });
    deps.repo = { deleteProject: vi.fn(async () => {}) };
    deps.indexParts.sprint.tables = ['sprint_event', 'status_event'];
    await startBackfill(deps, 'sprint', { projects: [{ id: '2', key: 'B' }] });
    deps.indexParts.sprint.index = async () => {
      await deps.state.setExcluded(['B', 'X']);
    };
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ finished: true, done: 0 });
    expect(deps.repo.deleteProject.mock.calls).toEqual([['2', ['sprint_event', 'status_event']]]);
  });
  it('starts the projects kept for later once the running fill finishes', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint', { projects: [{ id: '1', key: 'A' }] });
    await deps.state.waiting.add('sprint', [{ id: '2', key: 'B' }]);
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ finished: true, done: 6500 });
    const next = await deps.state.progress.getPart('sprint');
    expect([next.cursor.projects, next.finishedAt, next.readyAt]).toEqual([[{ id: '2', key: 'B' }], null, 1000]);
    expect(deps.pushed.at(-1)).toEqual({ kind: 'backfill', part: 'sprint', generation: 1000 });
    expect(await deps.state.waiting.get('sprint')).toEqual([]);
  });
  it('fills the projects kept for later now when no fill of the part runs, else keeps them once each', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint', { projects: [{ id: '1', key: 'A' }] });
    expect(await backfillProjects(deps, 'sprint', [{ id: '2', key: 'B' }])).toBeNull();
    expect(await backfillProjects(deps, 'sprint', [{ id: '2', key: 'B' }, { id: '3', key: 'C' }])).toBeNull();
    expect(await deps.state.waiting.get('sprint')).toEqual([{ id: '2', key: 'B' }, { id: '3', key: 'C' }]);
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: 5, readyAt: 5 });
    expect((await backfillProjects(deps, 'sprint', [{ id: '2', key: 'B' }])).cursor.projects).toEqual([{ id: '2', key: 'B' }]);
  });
  it('asks a rewrite of every stored root once a fill of chosen projects finishes', async () => {
    const deps = makeDeps({ pages: PAGES });
    const p = await startBackfill(deps, 'sprint', { projects: [{ id: '2', key: 'B' }] });
    expect(p.partial).toBe(true);
    await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } });
    expect((await deps.journal.read(10)).map((r) => r.value)).toEqual([{ ids: [], kinds: [REWRITE_ALL_KIND] }]);
  });
  it('waits with its slice while the background is paused for the Jira rate limit, then goes on from the saved cursor', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    await deps.state.brake.set(1000 + 120000);
    deps.indexed.length = 0;
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ braked: 121000 });
    expect([deps.indexed, deps.pushed.at(-1), deps.delays.at(-1)]).toEqual([[], { kind: 'backfill', part: 'sprint', generation: 1000 }, 120]);
  });
  it('pauses the background and queues itself for the reset when a 429 stops a slice, without throwing', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    deps.jira.searchPage = async () => { throw Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429, retryAt: 1000 + 300000 }); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } });
    error.mockRestore();
    expect([result, await deps.state.brake.get(), deps.pushed.at(-1), deps.delays.at(-1)]).toEqual([{ braked: true, done: 0 }, { until: 301000, reason: 'rate' }, { kind: 'backfill', part: 'sprint', generation: 1000 }, 300]);
  });
});

describe('backfill under the points budget', () => {
  const AT = Date.parse('2026-10-05T07:01:00Z');
  const big = ids(20000);
  function budgeted({ backfillSpent = 0, at = AT } = {}) {
    const deps = makeDeps({ pages: { A: big } });
    let now = at;
    deps.now = () => now;
    deps.advance = (ms) => { now += ms; };
    deps.siteCap = 9000;
    deps.withPoints = withPoints;
    deps.currentPoints = currentPoints;
    deps.points = createLedger({ kvs: createFakeKvs(), beginsWith, clock: () => now, own: newProcessPoints('b') });
    const request = async (path, init) => {
      const body = JSON.parse(init.body);
      if (path.includes('search/jql')) {
        const from = Number(body.nextPageToken ?? 0);
        const next = from + body.maxResults;
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ issues: big.slice(from, next).map((id) => ({ id })), ...(next < big.length ? { nextPageToken: String(next) } : {}) }) };
      }
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ issueChangeLogs: body.issueIdsOrKeys.map((id) => ({ issueId: id })) }) };
    };
    const jira = createJira(request);
    deps.jira.searchPage = jira.searchPage;
    deps.indexParts.sprint.index = async (slice, project) => {
      deps.indexed.push([project.key, ...slice]);
      await jira.changelogs(slice, ['status']);
    };
    return { deps, ready: async () => { if (backfillSpent) await deps.points.add('backfill', backfillSpent); } };
  }
  const indexedIds = (deps) => deps.indexed.flatMap(([, ...slice]) => slice);
  it('starts no slice once the backfill reserve is spent, keeps its progress fresh and queues itself for just after half past', async () => {
    const { deps, ready } = budgeted({ backfillSpent: 900 });
    await ready();
    const p = await startBackfill(deps, 'sprint');
    deps.pushed.length = 0;
    deps.delays.length = 0;
    deps.advance(1000);
    expect(await onBackfill(deps, { body: { kind: 'backfill', part: 'sprint', generation: p.generation } })).toEqual({ waiting: Date.parse('2026-10-05T07:31:00Z'), done: 0 });
    expect([deps.indexed, deps.pushed, deps.delays, (await deps.state.progress.getPart('sprint')).savedAt]).toEqual([[], [{ kind: 'backfill', part: 'sprint', generation: p.generation }], [300], AT + 1000]);
  });
  it('fills slices that fit its reserve before half past and counts only the issues it indexed', async () => {
    const { deps } = budgeted();
    const p = await startBackfill(deps, 'sprint');
    const result = await onBackfill(deps, { body: { kind: 'backfill', part: 'sprint', generation: p.generation } });
    const saved = await deps.state.progress.getPart('sprint');
    expect(result.done).toBeGreaterThan(0);
    expect([saved.done, saved.cursor.token]).toEqual([indexedIds(deps).length, String(indexedIds(deps).length)]);
  });
  it('never indexes an issue twice across runs of different allowances', async () => {
    const { deps } = budgeted();
    const p = await startBackfill(deps, 'sprint');
    await onBackfill(deps, { body: { kind: 'backfill', part: 'sprint', generation: p.generation } });
    deps.advance(30 * 60 * 1000);
    await onBackfill(deps, { body: { kind: 'backfill', part: 'sprint', generation: p.generation } });
    const all = indexedIds(deps);
    expect([new Set(all).size, (await deps.state.progress.getPart('sprint')).done]).toEqual([all.length, all.length]);
  });
});
