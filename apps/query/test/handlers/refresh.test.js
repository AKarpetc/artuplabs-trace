import { describe, expect, it, vi } from 'vitest';
import { BUDGET_AT, ids, makeDeps, RECENT, spend, withBudget } from './makeDeps.js';
import { createLedger, newProcessPoints } from '../../src/infra/points.js';
import { beginsWith } from '../fakeKvs.js';
import { onRefresh, pushRefresh, refreshOnce, rewrite } from '../../src/handlers/refresh.js';
import { handOff, writeGroups } from '../../src/handlers/groups.js';
import { handleFunction } from '../../src/handlers/functions.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { createFieldCompute } from '../../src/compute/fields.js';
import { REWRITE_ALL_KIND } from '../../src/core/affected.js';
import { laneRoom, passInterval } from '../../src/core/points.js';
import { ERR } from '../../src/core/errors.js';
import { HEAVY_ATTEMPTS, HEAVY_QUEUED_STALE_MS, REFRESH_GROUP_BUDGET_MS, REFRESH_RETRY_DELAY_S, WORKER_BUDGET_MS } from '../../src/core/limits.js';

const deadlineError = () => Object.assign(new Error('Computation deadline passed'), { name: 'DeadlineError' });
/** Runs the compute job of a parentsOf call that a function deferred just now (it records the job before queuing it). */
async function deferred(deps) {
  await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: deps.now() });
  return onRefresh(deps, { body: { kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] } });
}
const jiraError = (status) => Object.assign(new Error(`Jira answered ${status}`), { name: 'JiraError', status });

describe('refreshOnce', () => {
  it('does nothing on an empty journal', async () => {
    expect(await refreshOnce(makeDeps())).toBeNull();
  });
  it('rewrites every stored root, used or not, after a change of the excluded projects, and only then drops the row', async () => {
    const OLD = new Date(1000000 - 30 * 24 * 60 * 60 * 1000).toISOString();
    const pcs = [
      { id: 'never', functionName: 'parentsOf', arguments: ['q'], operator: 'in', value: 'id in (4)' },
      { id: 'idle', functionName: 'hasLinks', arguments: [], operator: 'not in', value: 'NOT (id in (5))', used: OLD },
      { id: 'page', functionName: 'parentsOf', arguments: ['q', '__aq:l2'], operator: 'in', value: 'id = -1', used: RECENT },
    ];
    const compute = { parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }), hasLinks: async () => ({ ids: ['6'], field: 'id', watch: null }) };
    let refuse = true;
    const write = async (updates) => {
      if (refuse) throw new Error('Jira answered 503');
      deps.written.push(...updates);
    };
    const deps = makeDeps({ pcs, compute, write });
    await deps.state.setExcluded(['OPS']);
    await deps.journal.append({ ids: [], kinds: [REWRITE_ALL_KIND] }, 999500);
    await expect(refreshOnce(deps)).rejects.toThrow('503');
    expect((await deps.journal.read(10)).length).toBe(1);
    refuse = false;
    deps.advance(1000);
    expect(await refreshOnce(deps)).toMatchObject({ all: true, recomputed: 2, changed: 3 });
    expect([...deps.written].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'idle', value: 'NOT (id in (6))' },
      { id: 'never', value: 'id in (3)' },
      { id: 'page', value: 'id = -1' },
    ]);
    expect(await deps.journal.read(10)).toEqual([]);
  });
  it('skips unused and idle groups on an ordinary change', async () => {
    const pcs = [{ id: 'never', functionName: 'hasLinks', arguments: [], value: 'id in (5)' }];
    const compute = { hasLinks: vi.fn(async () => ({ ids: ['6'], field: 'id', watch: null })) };
    const deps = makeDeps({ pcs, compute });
    await deps.journal.append({ ids: [], kinds: ['unknown'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ groups: 0, recomputed: 0 });
    expect(compute.hasLinks).not.toHaveBeenCalled();
  });
  it('rewrites the root and its pages from one value set', async () => {
    const pcs = [
      { id: 'root', functionName: 'linkedIssuesOf', arguments: ['q'], value: 'id in (1)', used: RECENT },
      { id: 'leaf2', functionName: 'linkedIssuesOf', arguments: ['q', '__aq:l2'], value: 'id = -1', used: RECENT },
    ];
    const deps = makeDeps({ pcs, compute: { linkedIssuesOf: async () => ({ ids: ids(1500), field: 'id', watch: ['5'] }) } });
    await deps.cache.write('linkedIssuesOf["q"]', { values: ['1'], watch: ['5'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['link'] }, 999500);
    const pass = await refreshOnce(deps);
    expect(deps.written).toEqual([
      { id: 'root', value: '(issue in linkedIssuesOf("q", "__aq:l1") OR issue in linkedIssuesOf("q", "__aq:l2"))' },
      { id: 'leaf2', value: `id in (${ids(500, 1001).join(',')})` },
    ]);
    expect(pass).toMatchObject({ touched: ['5'], kinds: ['link'], events: 1, recomputed: 1, changed: 2, stale: false, oldestEventMs: 500 });
    expect(await deps.journal.read(10)).toEqual([]);
  });
  it('still recomputes a group after a pass that died before writing its precomputations', async () => {
    const pcs = [{ id: 'root', functionName: 'subtasksOf', arguments: ['labels = in'], value: 'parent in (5)', used: RECENT }];
    let refuse = true;
    const write = async (updates) => {
      if (refuse) throw Object.assign(new Error('Limits for the current installation have been exceeded'), { name: 'ForgeKvsError' });
      deps.written.push(...updates);
    };
    const compute = { subtasksOf: vi.fn(async () => ({ ids: [], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: [] })) };
    const deps = makeDeps({ pcs, compute, write });
    await deps.cache.write('subtasksOf["labels = in"]', { values: ['5'], watch: ['5'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    await expect(refreshOnce(deps)).rejects.toThrow('Limits');
    refuse = false;
    deps.advance(1000);
    expect(await refreshOnce(deps)).toMatchObject({ recomputed: 1, changed: 1 });
    expect(compute.subtasksOf).toHaveBeenCalledTimes(2);
    expect(await deps.cache.watch('subtasksOf["labels = in"]')).toEqual(new Set());
  });
  it('keeps the cache of a group as Jira has it when a later pass already wrote', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { parentsOf: async () => ({ ids: ['2'], field: 'id', watch: [] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: ['5'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.state.lastWrittenStart.set(2000000);
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ stale: true });
    expect(await deps.cache.watch('parentsOf["q"]')).toEqual(new Set(['5']));
  });
  it('skips a group the touched issues cannot affect', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const compute = { parentsOf: vi.fn() };
    const deps = makeDeps({ pcs, compute });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: ['7'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(0);
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('recomputes a group whose subquery now matches a touched issue', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, searches: { '(q) AND id in (5)': ['5'] }, compute: { parentsOf: async () => ({ ids: ['2'], field: 'id', watch: ['5'] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'root', value: 'id in (2)' }]);
  });
  it('counts only touched issues among the live search hits', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const compute = { parentsOf: vi.fn() };
    const deps = makeDeps({ pcs, compute, searches: { '(q) AND id in (5)': ['7'] } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: ['8'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(0);
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('asks the live search to reconcile the touched issues', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { parentsOf: vi.fn() } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: ['8'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['6', '5'], kinds: ['issue-updated'] }, 999500);
    await refreshOnce(deps);
    expect(deps.searched).toEqual([['(q) AND id in (5,6)', ['5', '6']]]);
  });
  it('recomputes when the live search fails in Jira', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, searches: { '(q) AND id in (5)': jiraError(503) }, compute: { parentsOf: async () => ({ ids: ['2'], field: 'id', watch: [] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(1);
  });
  it('counts a group whose live search breaks as failed and hands it to the heavy lane', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, searches: { '(q) AND id in (5)': new TypeError('bug') } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await refreshOnce(deps)).failed).toBe(1);
    error.mockRestore();
    expect([(await deps.state.heavy.get('parentsOf["q"]'))?.key, await deps.journal.read(10)]).toEqual(['parentsOf["q"]', []]);
  });
  it('leaves query groups alone when the events touched no issue', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const compute = { parentsOf: vi.fn() };
    const deps = makeDeps({ pcs, compute });
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(0);
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('repairs a group whose stored value still carries an error although the events do not touch it', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', error: 'Computing, retry in a minute', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { parentsOf: async () => ({ ids: ['1'], field: 'id', watch: ['7'] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: ['7'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(1);
    expect(deps.written).toEqual([{ id: 'root', value: 'id in (1)', error: null }]);
  });
  it('checks 60 touched issues against a query group in searches of 50 and leaves it when none matter', async () => {
    const pcs = [{ id: 'root', functionName: 'subtasksOf', arguments: ['key = A-1'], value: 'parent in (1)', used: RECENT }];
    const compute = { subtasksOf: vi.fn() };
    const deps = makeDeps({ pcs, compute });
    await deps.cache.write('subtasksOf["key = A-1"]', { values: ['1'], watch: ['1'], field: 'parent', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ids(60, 100), kinds: ['issue-updated'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ all: false, recomputed: 0 });
    expect(compute.subtasksOf).not.toHaveBeenCalled();
    expect(deps.searched).toEqual([[`(key = A-1) AND id in (${ids(50, 100).join(',')})`, ids(50, 100)], [`(key = A-1) AND id in (${ids(10, 150).join(',')})`, ids(10, 150)]]);
  });
  it('recomputes a query group when a later search of touched issues matches', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, searches: { [`(q) AND id in (${ids(10, 150).join(',')})`]: ['155'] }, compute: { parentsOf: async () => ({ ids: ['2'], field: 'id', watch: [] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ids(60, 100), kinds: ['issue-updated'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(1);
  });
  it('recomputes every group when the journal page asks for everything', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const seen = [];
    const deps = makeDeps({ pcs, compute: { parentsOf: async (args, ctx) => { seen.push(ctx.reconcile); return { ids: ['1'], field: 'id', watch: [] }; } } });
    await deps.journal.append({ ids: ids(201), kinds: ['issue-updated'] }, 999500);
    const pass = await refreshOnce(deps);
    expect([pass.all, pass.recomputed, deps.searched]).toEqual([true, 1, []]);
    expect(seen).toEqual([ids(50)]);
  });
  it('recomputes hasLinks on a new link', async () => {
    const pcs = [{ id: 'l', functionName: 'hasLinks', arguments: ['blocks'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasLinks: async () => ({ ids: ['1', '9'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: ['9'], kinds: ['link'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'l', value: 'id in (1,9)' }]);
  });
  it('recomputes hasSubtasks on a new issue but not on a new link', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const compute = { hasSubtasks: vi.fn(async () => ({ ids: ['1', '2'], field: 'id', watch: null })) };
    const deps = makeDeps({ pcs, compute });
    await deps.journal.append({ ids: ['9'], kinds: ['link'] }, 999500);
    await refreshOnce(deps);
    expect(compute.hasSubtasks).not.toHaveBeenCalled();
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999600);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (1,2)' }]);
  });
  it('recomputes previousSprint when a sprint starts or closes', async () => {
    const pcs = [{ id: 'p', functionName: 'previousSprint', arguments: ['DEMO board'], value: 'sprint = 1', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { previousSprint: async () => ({ native: 'sprint = 2' }) } });
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'p', value: 'sprint = 2' }]);
  });
  it('recomputes a whole attachment or comment family on an event that names no issue', async () => {
    const pcs = [
      { id: 'a', functionName: 'hasAttachments', arguments: [], value: 'id in (1)', used: RECENT },
      { id: 'c', functionName: 'hasComments', arguments: [], value: 'id in (1)', used: RECENT },
    ];
    const deps = makeDeps({ pcs, compute: { hasAttachments: async () => ({ ids: ['3'], field: 'id', watch: null }), hasComments: async () => ({ ids: ['4'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: [], kinds: ['attachment'] }, 999500);
    await deps.journal.append({ ids: [], kinds: ['comment'] }, 999600);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'a', value: 'id in (3)' }, { id: 'c', value: 'id in (4)' }]);
  });
  it('does not refresh a precomputation Jira has not used yet', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)' }];
    const compute = { hasSubtasks: vi.fn(async () => ({ ids: ['2'], field: 'id', watch: null })) };
    const deps = makeDeps({ pcs, compute });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ groups: 0, recomputed: 0 });
    expect(compute.hasSubtasks).not.toHaveBeenCalled();
  });
  it('keeps the journal rows when the write fails', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) }, write: async () => { throw new Error('503'); } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await expect(refreshOnce(deps)).rejects.toThrow('503');
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('does not overwrite a pass that started later', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.lastWrittenStart.set(2000000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect((await refreshOnce(deps)).stale).toBe(true);
    expect(deps.written).toEqual([]);
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('a group failing with 403 does not block the others', async () => {
    const pcs = [
      { id: 'bad', functionName: 'previousSprint', arguments: ['Secret board'], value: 'sprint = 1', used: RECENT },
      { id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT },
    ];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ pcs, compute: { previousSprint: async () => { throw jiraError(403); }, hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created', 'sprint'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ failed: 1, changed: 1 });
    error.mockRestore();
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'previousSprint', message: 'Refresh failed: Jira answered 403' }]);
    expect(await deps.journal.read(10)).toEqual([]);
  });
  it('keeps the cache of a deferred computation fresh before Jira stores its root', async () => {
    const compute = { linkedIssuesOf: vi.fn(async () => ({ ids: ['8'], field: 'id', watch: ['5'] })) };
    const deps = makeDeps({ compute });
    await deps.state.addJob({ key: 'linkedIssuesOf["q"]', functionName: 'linkedIssuesOf', userArgs: ['q'], at: 999000 });
    await deps.cache.write('linkedIssuesOf["q"]', { values: ['1'], watch: ['5'], field: 'id', rootFilter: null, at: 999000, source: 'job' });
    await deps.journal.append({ ids: ['5'], kinds: ['link'] }, 999500);
    await refreshOnce(deps);
    expect(await deps.cache.values('linkedIssuesOf["q"]', await deps.cache.meta('linkedIssuesOf["q"]'), 0, 10)).toEqual(['8']);
    expect((await deps.cache.meta('linkedIssuesOf["q"]')).source).toBe('job');
  });
  it('keeps watching a deferred computation for as long as its refreshed cache lives', async () => {
    const deps = makeDeps({ compute: { linkedIssuesOf: async () => ({ ids: ['8'], field: 'id', watch: ['5'] }) } });
    await deps.state.addJob({ key: 'linkedIssuesOf["q"]', functionName: 'linkedIssuesOf', userArgs: ['q'], at: 999000 });
    await deps.cache.write('linkedIssuesOf["q"]', { values: ['1'], watch: ['5'], field: 'id', rootFilter: null, at: 999000, source: 'job' });
    await deps.journal.append({ ids: ['5'], kinds: ['link'] }, 999500);
    await refreshOnce(deps);
    expect((await deps.state.jobs(1000000)).map((j) => j.at)).toEqual([1000000]);
  });
  it('refreshes a deferred computation once Jira uses its root through the precomputation', async () => {
    const pcs = [{ id: 'root', functionName: 'linkedIssuesOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const compute = { linkedIssuesOf: vi.fn(async () => ({ ids: ['8'], field: 'id', watch: ['5'] })) };
    const deps = makeDeps({ pcs, compute });
    await deps.state.addJob({ key: 'linkedIssuesOf["q"]', functionName: 'linkedIssuesOf', userArgs: ['q'], at: 999000 });
    await deps.journal.append({ ids: ['5'], kinds: ['link'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ groups: 1, recomputed: 1 });
    expect(compute.linkedIssuesOf).toHaveBeenCalledTimes(1);
  });
});

describe('rewrite', () => {
  const group = (functionName, userArgs, items) => ({ key: `${functionName}${JSON.stringify(userArgs)}`, functionName, family: 'query', userArgs, items });
  it('stores the argument error of a group whose arguments no longer parse', async () => {
    const deps = makeDeps();
    expect((await rewrite(deps, group('parentsOf', [], [{ id: 'x', arguments: [], value: 'id in (1)' }]), [])).updates).toEqual([{ id: 'x', error: 'Usage: parentsOf(subquery)' }]);
  });
  it('stores the readiness error while the index is building', async () => {
    const deps = makeDeps({ ready: async () => 'Index is building: 1 of 2 issues' });
    expect((await rewrite(deps, group('hasSubtasks', [], [{ id: 'x', arguments: [], value: 'id in (1)' }]), [])).updates).toEqual([{ id: 'x', error: 'Index is building: 1 of 2 issues' }]);
  });
  it('stores the error a value source answers', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ error: 'Board "B" not found', log: 'Board not found' }) } });
    expect((await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], value: 'sprint = 1' }]), [])).updates).toEqual([{ id: 'x', error: 'Board "B" not found' }]);
  });
  it('clears the error Jira kept next to a value when the value is written', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ native: 'sprint = 1' }) } });
    expect((await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], value: 'sprint = 1', error: 'Computing, retry in a minute' }]), [])).updates).toEqual([{ id: 'x', value: 'sprint = 1', error: null }]);
  });
  it('replaces a stored error with the value and clears the error', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ native: 'sprint = 2' }) } });
    expect((await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], error: 'Board "B" not found' }]), [])).updates).toEqual([{ id: 'x', value: 'sprint = 2', error: null }]);
  });
  it('writes each precomputation in the form of its operator from one computation', async () => {
    const compute = { parentsOf: vi.fn(async () => ({ ids: ['4'], field: 'id', watch: [] })) };
    const deps = makeDeps({ compute });
    const items = [{ id: 'a', arguments: ['q'], operator: 'in', value: 'id in (1)' }, { id: 'b', arguments: ['q'], operator: 'not in', value: 'id in (1)' }, { id: 'c', arguments: ['q'], operator: 'NOT_IN', value: 'NOT (id in (4))' }];
    expect((await rewrite(deps, group('parentsOf', ['q'], items), [])).updates).toEqual([{ id: 'a', value: 'id in (4)' }, { id: 'b', value: 'NOT (id in (4))' }]);
    expect(compute.parentsOf).toHaveBeenCalledTimes(1);
  });
  it('stores roots filtered by the app, with no project clause, under both operators', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => ({ ids: ['4', '5'], field: 'id', watch: [] }) }, exclude: async (r) => ({ ...r, ids: ['4'] }) });
    await deps.state.setExcluded(['OPS']);
    const items = [{ id: 'a', arguments: ['q'], operator: 'in' }, { id: 'b', arguments: ['q'], operator: 'not in' }];
    expect((await rewrite(deps, group('parentsOf', ['q'], items), [])).updates).toEqual([
      { id: 'a', value: 'id in (4)' },
      { id: 'b', value: 'NOT (id in (4))' },
    ]);
  });
  it('stores the same error for a not in precomputation as for in', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ error: 'Board "B" not found', log: 'Board not found' }) } });
    expect((await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], operator: 'not in', value: 'NOT (sprint = 1)' }]), [])).updates).toEqual([{ id: 'x', error: 'Board "B" not found' }]);
  });
  it('stores Jira\'s parser error for a subquery that became invalid', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => ({ ids: [], field: 'id', watch: [] }) }, invalid: { 'x = 1': 'Field \'x\' does not exist' } });
    const items = [{ id: 'a', arguments: ['x = 1'], operator: 'in', value: 'id in (4)' }];
    expect(await rewrite(deps, group('parentsOf', ['x = 1'], items), [])).toEqual({ updates: [{ id: 'a', error: 'parentsOf: Field \'x\' does not exist' }], entry: null, keepIfSame: false });
  });
  it('writes nothing when the stored value is unchanged', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ native: 'sprint = 1' }) } });
    expect((await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], value: 'sprint = 1' }]), [])).updates).toEqual([]);
  });
});

describe('pushRefresh', () => {
  it('marks the refresh as pending and pushes it', async () => {
    const deps = makeDeps();
    expect(await pushRefresh(deps, 5)).toBe(true);
    expect([await deps.state.pending.get(), deps.pushed]).toEqual([5, [[{ kind: 'refresh', ts: 5 }, null]]]);
  });
});

describe('onRefresh', () => {
  it('leaves at once while another worker holds the lease', async () => {
    const deps = makeDeps();
    await deps.state.lease.set(999990);
    expect(await onRefresh(deps, { body: { kind: 'refresh', ts: 1 } })).toEqual({ busy: true });
  });
  it('runs passes until the journal is empty, then pushes one delayed verify', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.pending.set(999000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    expect(result.passes).toHaveLength(1);
    expect([await deps.state.pending.get(), await deps.state.lease.get()]).toEqual([null, null]);
    expect(deps.pushed).toEqual([[{ kind: 'refresh', ts: 1000000, verify: ['9'], kinds: ['issue-created'] }, 20]]);
  });
  it('finishes its passes when the queue refuses the verify job', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) }, queue: { push: async () => { throw new Error('400 Bad Request'); } } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect((await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } })).passes).toHaveLength(1);
    error.mockRestore();
    expect(await deps.state.lastRefresh.get()).toMatchObject({ passes: 1, changed: 1 });
  });
  it('records the last refresh', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    expect(await deps.state.lastRefresh.get()).toEqual({ at: 1000000, passes: 1, changed: 1, oldestEventMs: 500, overhead: 0 });
  });
  it('turns a verify job into a journal record and pushes no further verify', async () => {
    const deps = makeDeps();
    await onRefresh(deps, { body: { kind: 'refresh', ts: 1, verify: ['9'], kinds: ['link'] } });
    expect(deps.pushed).toEqual([]);
  });
  it('journals a verify job even while another worker holds the lease', async () => {
    const deps = makeDeps();
    await deps.state.lease.set(999990);
    await onRefresh(deps, { body: { kind: 'refresh', ts: 1, verify: ['9'] } });
    expect((await deps.journal.read(10)).map((r) => r.value)).toEqual([{ ids: ['9'], kinds: ['issue-updated'] }]);
  });
  it('pushes another refresh when the budget ends before the journal does', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs });
    deps.compute.hasSubtasks = async () => {
      deps.advance(WORKER_BUDGET_MS);
      await deps.journal.append({ ids: ['10'], kinds: ['issue-created'] }, deps.now());
      return { ids: ['2'], field: 'id', watch: null };
    };
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    expect(result.passes).toHaveLength(1);
    expect(deps.pushed[0]).toEqual([{ kind: 'refresh', ts: 1000000 + WORKER_BUDGET_MS }, null]);
    expect(await deps.state.pending.get()).toBe(1000000 + WORKER_BUDGET_MS);
  });
  it('stops after a stale pass and pushes a refresh for the rows it kept', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.lastWrittenStart.set(2000000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect((await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } })).passes).toHaveLength(1);
    expect(deps.pushed[0]).toEqual([{ kind: 'refresh', ts: 1000000 }, REFRESH_RETRY_DELAY_S]);
  });
  it('pushes no follow-up refresh for a group that failed, as the heavy lane retries it', async () => {
    const pcs = [{ id: 'bad', functionName: 'previousSprint', arguments: ['B'], value: 'sprint = 1', used: RECENT }];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ pcs, compute: { previousSprint: async () => { throw jiraError(403); } } });
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    error.mockRestore();
    expect(result.passes).toHaveLength(1);
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
  });
  it('releases the lease when a pass fails', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs });
    deps.jira.precomputations = async () => { throw new Error('down'); };
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await expect(onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } })).rejects.toThrow('down');
    expect(await deps.state.lease.get()).toBeNull();
  });
  it('runs a compute job into the cache', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => ({ ids: ['4'], field: 'id', watch: [] }) } });
    expect(await deferred(deps)).toEqual({ computed: 'parentsOf["q"]', changed: 0 });
    expect((await deps.cache.meta('parentsOf["q"]')).source).toBe('job');
  });
  it('keeps watching a compute job from the moment it completes', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => { deps.advance(60000); return { ids: ['4'], field: 'id', watch: [] }; } } });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: 1000000 });
    await onRefresh(deps, { body: { kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] } });
    expect(await deps.state.jobs(1060000)).toEqual([{ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: 1060000 }]);
  });
  it('answers the argument error of a compute job without computing', async () => {
    const deps = makeDeps();
    expect(await onRefresh(deps, { body: { kind: 'compute', functionName: 'parentsOf', userArgs: [] } })).toEqual({ error: 'Usage: parentsOf(subquery)' });
  });
});

describe('heavy groups in a refresh pass', () => {
  const heavyPcs = [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', used: RECENT }];
  const lightPcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
  it('gives each group a deadline inside the pass and the worker budget', async () => {
    const deps = makeDeps({ pcs: lightPcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps, { deadline: 1000000 + 5000 });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999600);
    await refreshOnce(deps);
    expect(deps.deadlines).toEqual([1005000, 1000000 + REFRESH_GROUP_BUDGET_MS]);
  });
  it('hands a group that runs out of its pass budget to the heavy lane and drops the rows', async () => {
    const deps = makeDeps({ pcs: [...heavyPcs, ...lightPcs], compute: { childIssuesOf: async () => { throw deadlineError(); }, hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const pass = await refreshOnce(deps);
    expect(pass).toMatchObject({ recomputed: 1, handed: 1, failed: 0, changed: 1 });
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
    expect(await deps.state.heavy.get('childIssuesOf["q"]')).toEqual({ key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'], at: 1000000, since: 1000000 });
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
    expect(await deps.journal.read(10)).toEqual([]);
  });
  it('keeps a light group the worker budget cut short out of the heavy lane and keeps the rows for the next refresh', async () => {
    const deps = makeDeps({ pcs: lightPcs, compute: { hasSubtasks: async () => { throw deadlineError(); } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const pass = await refreshOnce(deps, { deadline: 1000000 + 2000 });
    expect(pass).toMatchObject({ recomputed: 0, handed: 0, postponed: 1, failed: 0 });
    expect([await deps.state.heavy.get('hasSubtasks[]'), deps.pushed]).toEqual([null, []]);
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('pushes the next refresh at once for rows a pass kept because the worker budget ran out', async () => {
    let deps;
    const write = async () => {
      deps.advance(WORKER_BUDGET_MS - 1000);
      await deps.journal.append({ ids: ['10'], kinds: ['issue-created'] }, deps.now());
    };
    deps = makeDeps({ pcs: lightPcs, write });
    deps.compute.hasSubtasks = async () => {
      if (deps.now() > 1000000) throw deadlineError();
      return { ids: ['2'], field: 'id', watch: null };
    };
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    expect(result.passes.map((p) => p.postponed)).toEqual([0, 1]);
    expect(deps.pushed[0]).toEqual([{ kind: 'refresh', ts: 1000000 + WORKER_BUDGET_MS - 1000 }, null]);
    expect(await deps.state.heavy.get('hasSubtasks[]')).toBeNull();
  });
  it('pushes the heavy runner once for several groups handed in one pass', async () => {
    const pcs = [
      { id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', used: RECENT },
      { id: 'd', functionName: 'childIssuesOf', arguments: ['r'], value: 'parent in (1)', used: RECENT },
    ];
    const deps = makeDeps({ pcs, compute: { childIssuesOf: async () => { throw deadlineError(); } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect((await refreshOnce(deps)).handed).toBe(2);
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
  });
  it('hands a group known to be slow to the heavy lane without computing it', async () => {
    const compute = { childIssuesOf: vi.fn() };
    const deps = makeDeps({ pcs: heavyPcs, compute });
    await deps.cache.write('childIssuesOf["q"]', { values: ['1'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: REFRESH_GROUP_BUDGET_MS });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-updated'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ recomputed: 0, handed: 1 });
    expect(compute.childIssuesOf).not.toHaveBeenCalled();
  });
  it('does not compute a group that waits in the heavy lane', async () => {
    const compute = { childIssuesOf: vi.fn() };
    const deps = makeDeps({ pcs: heavyPcs, compute });
    await deps.state.heavy.put({ key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'], at: 990000 });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ recomputed: 0, handed: 1 });
    expect(compute.childIssuesOf).not.toHaveBeenCalled();
  });
  it('does not queue a heavy group again while it waits in the lane', async () => {
    const deps = makeDeps({ pcs: heavyPcs, compute: { childIssuesOf: async () => { throw deadlineError(); } } });
    await deps.state.heavy.put({ key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'], at: 990000 });
    await deps.state.heavy.lease.set(999000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect([deps.pushed, (await deps.state.heavy.get('childIssuesOf["q"]')).at]).toEqual([[], 990000]);
  });
  it('restarts an idle heavy lane when a pass meets a group waiting in it', async () => {
    const deps = makeDeps({ pcs: heavyPcs, compute: { childIssuesOf: vi.fn() } });
    await deps.state.heavy.put({ key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'], at: 990000 });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
  });
  it('leaves a running heavy lane alone when a pass meets a group waiting in it', async () => {
    const deps = makeDeps({ pcs: heavyPcs, compute: { childIssuesOf: vi.fn() } });
    await deps.state.heavy.put({ key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'], at: 990000 });
    await deps.state.heavy.lease.set(999000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect(deps.pushed).toEqual([]);
  });
  it('queues a heavy group again when its lane entry is too old to be trusted', async () => {
    const deps = makeDeps({ pcs: heavyPcs, compute: { childIssuesOf: async () => { throw deadlineError(); } } });
    await deps.state.heavy.put({ key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'], at: 1000000 - HEAVY_QUEUED_STALE_MS });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect([deps.pushed, (await deps.state.heavy.get('childIssuesOf["q"]')).at]).toEqual([[[{ kind: 'heavy' }, null]], 1000000]);
  });
  it('skips the updates of a group a later computation already wrote and writes the others', async () => {
    const deps = makeDeps({ pcs: [...heavyPcs, ...lightPcs], compute: { childIssuesOf: async () => ({ ids: ['3'], field: 'parent', watch: ['9'] }), hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.groupWrite.set('childIssuesOf["q"]', 1000001);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ changed: 1, stale: false });
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
    expect([await deps.state.groupWrite.get('hasSubtasks[]'), await deps.state.groupWrite.get('childIssuesOf["q"]')]).toEqual([1000000, 1000001]);
    expect(await deps.journal.read(10)).toEqual([]);
  });
  it('does not let an older computation overwrite a group a newer one found unchanged', async () => {
    const deps = makeDeps({ pcs: lightPcs });
    await writeGroups(deps, 2000, [['hasSubtasks[]', { updates: [], entry: { values: ['1'], watch: null, field: 'id', rootFilter: null, at: 2000, source: 'refresh', startedAt: 2000 } }]]);
    const changed = await writeGroups(deps, 1000, [['hasSubtasks[]', { updates: [{ id: 'h', value: 'id in (9)' }], entry: { values: ['9'], watch: null, field: 'id', rootFilter: null, at: 1000, source: 'refresh', startedAt: 1000 } }]]);
    expect([changed, deps.written, await deps.state.groupWrite.get('hasSubtasks[]')]).toEqual([0, [], 2000]);
  });
  it('remembers how long a group took to compute', async () => {
    const deps = makeDeps({ pcs: lightPcs });
    deps.compute.hasSubtasks = async () => { deps.advance(1500); return { ids: ['2'], field: 'id', watch: null }; };
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect((await deps.cache.meta('hasSubtasks[]')).ms).toBe(1500);
  });
});

describe('onRefresh heavy lane', () => {
  const pcs = [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', error: 'Computing, retry in a minute', used: RECENT }];
  const queued = (key, at) => ({ key: `childIssuesOf[${JSON.stringify(key)}]`, functionName: 'childIssuesOf', userArgs: [key], at });
  it('runs the oldest waiting group, writes its precomputations and clears their error', async () => {
    const deps = makeDeps({ pcs, compute: { childIssuesOf: async () => ({ ids: ['3'], field: 'parent', watch: ['9'] }) } });
    await deps.state.heavy.put(queued('q', 990000));
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ heavy: { computed: 'childIssuesOf["q"]', changed: 1 } });
    expect(deps.written).toEqual([{ id: 'c', value: 'parent in (3)', error: null }]);
    expect([await deps.state.heavy.oldest(), await deps.state.heavy.lease.get(), deps.pushed]).toEqual([null, null, []]);
    expect(deps.deadlines).toEqual([1000000 + WORKER_BUDGET_MS]);
  });
  it('stores a heavy group in the cache only after its precomputations are written', async () => {
    const write = async () => { throw new Error('write refused'); };
    const deps = makeDeps({ pcs, write, compute: { childIssuesOf: async () => ({ ids: ['3'], field: 'parent', watch: ['9'] }) } });
    await deps.state.heavy.put(queued('q', 990000));
    await expect(onRefresh(deps, { body: { kind: 'heavy' } })).rejects.toThrow('write refused');
    expect(await deps.cache.meta('childIssuesOf["q"]')).toBeNull();
  });
  it('keeps a group in the lane until its precomputations are written', async () => {
    const write = async () => { throw new Error('write refused'); };
    const deps = makeDeps({ pcs, write, compute: { childIssuesOf: async () => ({ ids: ['3'], field: 'parent', watch: ['9'] }) } });
    await deps.state.heavy.put(queued('q', 990000));
    await expect(onRefresh(deps, { body: { kind: 'heavy' } })).rejects.toThrow('write refused');
    expect(await deps.state.heavy.oldest()).toMatchObject({ key: 'childIssuesOf["q"]', tries: 1 });
    expect(await deps.state.heavy.lease.get()).toBeNull();
  });
  it('moves a group whose run failed behind the other waiting groups', async () => {
    const deps = makeDeps({ compute: { childIssuesOf: async () => { throw new Error('KVS limit'); } } });
    await deps.state.heavy.put(queued('a', 990000));
    await deps.state.heavy.put(queued('b', 995000));
    await expect(onRefresh(deps, { body: { kind: 'heavy' } })).rejects.toThrow('KVS limit');
    expect((await deps.state.heavy.oldest()).key).toBe('childIssuesOf["b"]');
  });
  it('runs a group again when it was handed to the lane while it ran', async () => {
    const deps = makeDeps({ pcs });
    deps.compute.childIssuesOf = async () => {
      deps.advance(1000);
      await handOff(deps, { key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'] });
      return { ids: ['3'], field: 'parent', watch: ['9'] };
    };
    await deps.state.heavy.put(queued('q', 990000));
    await onRefresh(deps, { body: { kind: 'heavy' } });
    expect(await deps.state.heavy.oldest()).toMatchObject({ key: 'childIssuesOf["q"]', at: 1001000 });
    expect(deps.pushed).toEqual([[{ kind: 'heavy' }, null]]);
  });
  it('keeps the points of a waiting entry it queues again', async () => {
    const deps = makeDeps();
    await deps.state.heavy.put({ ...queued('q', 990000), runningSince: 990000, pts: 450, floor: true });
    await handOff(deps, { key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'] });
    expect(await deps.state.heavy.get('childIssuesOf["q"]')).toMatchObject({ at: 1000000, pts: 450, floor: true });
  });
  it('stores the points it is handed a group with', async () => {
    const deps = makeDeps();
    await deps.state.heavy.put({ ...queued('q', 990000), runningSince: 990000, pts: 450, floor: true });
    await handOff(deps, { key: 'childIssuesOf["q"]', functionName: 'childIssuesOf', userArgs: ['q'] }, { pts: 1200, floor: false });
    expect(await deps.state.heavy.get('childIssuesOf["q"]')).toMatchObject({ pts: 1200, floor: false });
  });
  it('pushes itself again while more groups wait', async () => {
    const deps = makeDeps({ compute: { childIssuesOf: async () => ({ ids: ['3'], field: 'parent', watch: ['9'] }) } });
    await deps.state.heavy.put(queued('b', 995000));
    await deps.state.heavy.put(queued('a', 990000));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy.computed).toBe('childIssuesOf["a"]');
    expect([(await deps.state.heavy.oldest()).key, deps.pushed]).toEqual(['childIssuesOf["b"]', [[{ kind: 'heavy' }, null]]]);
  });
  it('leaves at once while another runner holds the lane', async () => {
    const deps = makeDeps({ compute: { childIssuesOf: vi.fn() } });
    await deps.state.heavy.put(queued('a', 990000));
    await deps.state.heavy.lease.set(999000);
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ busy: true });
    expect(deps.compute.childIssuesOf).not.toHaveBeenCalled();
  });
  it('logs a group that runs past the worker budget and leaves its precomputations as they are', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ pcs, compute: { childIssuesOf: async () => { throw deadlineError(); } } });
    await deps.state.heavy.put(queued('q', 990000));
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ heavy: { computed: 'childIssuesOf["q"]', timedOut: true } });
    error.mockRestore();
    expect(deps.written).toEqual([]);
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'childIssuesOf', message: 'Refresh ran out of time' }]);
    expect(await deps.state.heavy.lease.get()).toBeNull();
  });
  it('tries a group that runs past the worker budget again after the others, then gives it up', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ pcs, compute: { childIssuesOf: async () => { throw deadlineError(); } } });
    await deps.state.heavy.put(queued('q', 990000));
    const tries = [];
    for (let i = 0; i < HEAVY_ATTEMPTS; i += 1) {
      await onRefresh(deps, { body: { kind: 'heavy' } });
      tries.push((await deps.state.heavy.oldest())?.tries ?? null);
      deps.advance(REFRESH_RETRY_DELAY_S * 1000);
    }
    error.mockRestore();
    expect(tries).toEqual([...Array.from({ length: HEAVY_ATTEMPTS - 1 }, (_, i) => i + 1), null]);
  });
  it('does not overwrite a group that a later computation wrote while it ran', async () => {
    const deps = makeDeps({ pcs });
    deps.compute.childIssuesOf = async () => { await deps.state.groupWrite.set('childIssuesOf["q"]', 1000001); return { ids: ['3'], field: 'parent', watch: ['9'] }; };
    await deps.state.heavy.put(queued('q', 990000));
    expect((await onRefresh(deps, { body: { kind: 'heavy' } })).heavy.changed).toBe(0);
    expect(deps.written).toEqual([]);
  });
});

describe('onRefresh compute job precomputations', () => {
  it('writes the value of a deferred group over the Computing error Jira stored', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], error: 'Computing, retry in a minute', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { parentsOf: async () => ({ ids: ['4'], field: 'id', watch: [] }) } });
    expect(await deferred(deps)).toEqual({ computed: 'parentsOf["q"]', changed: 1 });
    expect(deps.written).toEqual([{ id: 'root', value: 'id in (4)', error: null }]);
  });
  it('filters a deferred group written by the job through the exclusion', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], operator: 'not in', error: 'Computing, retry in a minute', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { parentsOf: async () => ({ ids: ['4', '6'], field: 'id', watch: [] }) }, exclude: async (r) => ({ ...r, ids: ['4'] }) });
    await deps.state.setExcluded(['OPS']);
    await deferred(deps);
    expect(deps.written).toEqual([{ id: 'root', value: 'NOT (id in (4))', error: null }]);
  });
  it('writes the complement over the Computing error of a deferred not in call', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], operator: 'not in', error: 'Computing, retry in a minute', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { parentsOf: async () => ({ ids: ['4'], field: 'id', watch: [] }) } });
    await deferred(deps);
    expect(deps.written).toEqual([{ id: 'root', value: 'NOT (id in (4))', error: null }]);
  });
});

describe('refresh of the fields group', () => {
  const fieldDeps = (pcs, issues, bounds = new Map()) => {
    const jira = {
      fields: async () => [{ id: 'duedate', name: 'Due date' }, { id: 'resolutiondate', name: 'Resolved' }],
      searchIds: async () => ['1', '2'],
      bulkIssues: async () => issues(),
    };
    const compute = createFieldCompute({ jira, repo: { commentBounds: async () => bounds }, commentsShipped: () => true });
    return makeDeps({ pcs, compute });
  };
  const issue = (id, due) => ({ id, fields: { duedate: due, resolutiondate: '2026-01-07T00:00:00.000+0000' } });

  it('recomputes a dateCompare result when a field of a watched issue changes, and stores the complement for not in', async () => {
    const pcs = [
      { id: 'in', functionName: 'dateCompare', arguments: ['q', 'resolutiondate > duedate'], operator: 'in', value: 'id in (1)', used: RECENT },
      { id: 'out', functionName: 'dateCompare', arguments: ['q', 'resolutiondate > duedate'], operator: 'not in', value: 'NOT (id in (1))', used: RECENT },
    ];
    let due2 = '2026-01-10';
    const deps = fieldDeps(pcs, () => [issue('1', '2026-01-05'), issue('2', due2)]);
    await deps.cache.write('dateCompare["q","resolutiondate > duedate"]', { values: ['1'], watch: ['1', '2'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    due2 = '2026-01-06';
    await deps.journal.append({ ids: ['2'], kinds: ['issue-updated'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'in', value: 'id in (1,2)' }, { id: 'out', value: 'NOT (id in (1,2))' }]);
  });
  it('recomputes an expression reading comment times on a comment change that names no issue, and leaves other expressions alone', async () => {
    const pcs = [
      { id: 'c', functionName: 'dateCompare', arguments: ['q', 'lastCommented > resolutiondate'], value: 'id = -1', used: RECENT },
      { id: 'd', functionName: 'dateCompare', arguments: ['q', 'resolutiondate > duedate'], value: 'id = -1', used: RECENT },
    ];
    const deps = fieldDeps(pcs, () => [issue('1', '2026-01-05'), issue('2', '2026-01-10')], new Map([['2', { first: Date.UTC(2026, 0, 8), last: Date.UTC(2026, 0, 9) }]]));
    await deps.cache.write('dateCompare["q","lastCommented > resolutiondate"]', { values: [], watch: ['1', '2'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.cache.write('dateCompare["q","resolutiondate > duedate"]', { values: [], watch: ['1', '2'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: [], kinds: ['comment'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'c', value: 'id in (2)' }]);
  });
});

describe('journal cut under the points budget', () => {
  const USED = new Date(BUDGET_AT - 1000).toISOString();
  const H = 'hasSubtasks[]';
  const L = 'hasLinks["blocks"]';
  const HALF = Date.parse('2026-10-05T07:30:00Z');
  const sitePcs = [
    { id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: USED },
    { id: 'l', functionName: 'hasLinks', arguments: ['blocks'], value: 'id in (1)', used: USED },
  ];
  const spending = (list) => vi.fn(async () => {
    for (const n of list) await spend(n);
    return { ids: ['2'], field: 'id', watch: null };
  });
  const meta = (pts) => ({ values: ['1'], watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh', ...(pts === null ? {} : { pts }) });
  async function budgetDeps({ compute, refreshSpent = 0, pcs = sitePcs, write, at, pts = [10, 20], touched = ['9'], searches } = {}) {
    const deps = withBudget(makeDeps({ pcs, compute, write, searches }), { at });
    if (refreshSpent) await deps.points.add('refresh', refreshSpent);
    await deps.cache.write(H, meta(pts[0]));
    await deps.cache.write(L, meta(pts[1]));
    await deps.journal.append({ ids: touched, kinds: ['issue-created', 'link'] }, BUDGET_AT - 500);
    deps.rowKey = (await deps.journal.read(1))[0].key;
    return deps;
  }
  it('writes the groups it computed, keeps the rows and cuts the journal when the pass budget runs out', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([40]), hasLinks: spending([30, 1]) }, refreshSpent: 2930 });
    expect(await refreshOnce(deps)).toMatchObject({ budgeted: HALF });
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
    expect(await deps.journal.read(10)).toHaveLength(1);
    expect(await deps.state.cut.get()).toEqual({ key: deps.rowKey, startedAt: BUDGET_AT, done: [H] });
  });
  it('computes only the groups the cut has not done, then drops its rows and the cut', async () => {
    const compute = { hasSubtasks: spending([40]), hasLinks: spending([30, 1]) };
    const deps = await budgetDeps({ compute, refreshSpent: 2930 });
    await refreshOnce(deps);
    deps.advance(21 * 60 * 1000);
    await refreshOnce(deps);
    expect([compute.hasSubtasks.mock.calls.length, compute.hasLinks.mock.calls.length]).toEqual([1, 2]);
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }, { id: 'l', value: 'id in (2)' }]);
    expect([await deps.journal.read(10), await deps.state.cut.get()]).toEqual([[], null]);
  });
  it('leaves rows journaled after the cut for the next pass', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([40]), hasLinks: spending([30, 1]) }, refreshSpent: 2930 });
    await refreshOnce(deps);
    await deps.journal.append({ ids: ['7'], kinds: ['issue-created'] }, BUDGET_AT + 100);
    deps.advance(21 * 60 * 1000);
    const pass = await refreshOnce(deps);
    expect(pass.events).toEqual(1);
    expect((await deps.journal.read(10)).map((r) => r.value.ids)).toEqual([['7']]);
  });
  it('writes nothing, keeps the rows and leaves no cut when Jira rate-limits the write of a stopped pass', async () => {
    const limited = Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429, retryAt: null });
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([40]), hasLinks: spending([30, 1]) }, refreshSpent: 2930, write: async () => { throw limited; } });
    await expect(refreshOnce(deps)).rejects.toMatchObject({ name: 'RateLimitError' });
    expect([await deps.state.cut.get(), (await deps.journal.read(10)).length]).toEqual([null, 1]);
  });
  it('drops a cut no journal row falls under and reads the journal as usual', async () => {
    const compute = { hasSubtasks: spending([40]), hasLinks: spending([30]) };
    const deps = await budgetDeps({ compute });
    await deps.state.cut.set({ key: 't:000000000000001:x', startedAt: 1, done: [H] });
    await refreshOnce(deps);
    expect([compute.hasSubtasks.mock.calls.length, await deps.state.cut.get(), await deps.journal.read(10)]).toEqual([1, null, []]);
  });
  it('adds its groups to the cut of another pass without taking it over', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([40]), hasLinks: spending([30, 1]) }, refreshSpent: 2930 });
    await deps.state.cut.set({ key: deps.rowKey, startedAt: 5, done: ['other'] });
    await refreshOnce(deps);
    expect(await deps.state.cut.get()).toEqual({ key: deps.rowKey, startedAt: 5, done: ['other', H] });
  });
  it('verifies every touched issue of a finished cut, in bodies of 50', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([10]), hasLinks: spending([10]) }, touched: ids(120) });
    await deps.state.cut.set({ key: deps.rowKey, startedAt: 5, done: [] });
    await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT } });
    const verify = deps.pushed.filter(([body]) => body.verify).map(([body]) => body.verify);
    expect(verify).toEqual([ids(50), ids(50, 51), ids(20, 101)]);
  });
  const linesOf = (log, start) => log.mock.calls.map(([line]) => line).filter((line) => line.startsWith(start));
  it('logs a pass the refresh reserve refuses with the points spent and when it may run again, when requests are logged', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([10]), hasLinks: spending([10]) }, refreshSpent: 3000 });
    deps.logKvs = { requests: true };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await refreshOnce(deps);
    expect(linesOf(log, 'refresh pass refused')).toEqual(['refresh pass refused by the points budget: refresh 3000, site 3000, rows 1, retry 07:30Z']);
    log.mockRestore();
  });
  it('logs the cut a stopped pass writes with its done groups and the rows under its key, when requests are logged', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([40]), hasLinks: spending([30, 1]) }, refreshSpent: 2930 });
    deps.logKvs = { requests: true };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await refreshOnce(deps);
    expect(linesOf(log, 'refresh cut')).toEqual(['refresh cut: done 1, rows 1 under its key']);
    log.mockRestore();
  });
  it('logs the raw last use Jira reports for each group a pass computes, by function name only, when requests are logged', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([10]), hasLinks: spending([10]) } });
    deps.logKvs = { requests: true };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await refreshOnce(deps);
    expect(linesOf(log, 'refresh used')).toEqual([`refresh used: hasSubtasks ${USED}, hasLinks ${USED}`]);
    log.mockRestore();
  });
  it('logs the pause the passes set by their overhead, when requests are logged', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([10]), hasLinks: spending([10]) } });
    deps.logKvs = { requests: true };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT } });
    const { interval, overhead } = await deps.state.lastRefresh.get();
    expect(linesOf(log, 'refresh interval')).toEqual([`refresh interval ${interval} s after overhead ${overhead}`]);
    log.mockRestore();
  });
  describe('after half past', () => {
    const LATE = Date.parse('2026-10-05T07:40:00Z');
    const linkPcs = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, functionName: 'hasLinks', arguments: [`t${i}`], value: 'id in (1)', used: USED }));
    it('claims no more than the group limit beyond its own reserve, so other lanes keep their reserves while the pass runs', async () => {
      let seen = null;
      const compute = { hasLinks: vi.fn(async () => {
        const { byLane } = await createLedger({ kvs: deps.kvs, beginsWith, clock: () => LATE, own: newProcessPoints('other') }).siteSpent('2026100507');
        seen = { refresh: byLane.refresh, eventRoom: laneRoom('index-event', byLane, LATE, 10000) };
        return { ids: ['2'], field: 'id', watch: null };
      }) };
      const deps = await budgetDeps({ compute, refreshSpent: 3000, pcs: linkPcs(1), at: LATE });
      await refreshOnce(deps);
      expect(seen.refresh).toEqual(3000 + 2000);
      expect(seen.eventRoom).toBeGreaterThanOrEqual(1000);
    });
    it('goes on with the next pass instead of waiting for the hour when only the cap of its claim stopped it', async () => {
      const compute = { hasLinks: spending([450]) };
      const deps = await budgetDeps({ compute, refreshSpent: 3000, pcs: linkPcs(10), at: LATE });
      const pass = await refreshOnce(deps);
      expect([pass.budgeted ?? null, pass.capped]).toEqual([null, true]);
    });
  });
  it('stops the pass at once and cuts the journal when the refresh reserve is spent', async () => {
    const compute = { hasSubtasks: spending([10]), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute, refreshSpent: 3000 });
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT } });
    expect([compute.hasSubtasks.mock.calls.length, await deps.state.cut.get()]).toEqual([0, { key: deps.rowKey, startedAt: BUDGET_AT, done: [] }]);
    expect(result.budgeted).toEqual(HALF);
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, 300]]);
  });
  it('hands a group without a known cost that passes the light limit to the heavy lane with what it spent as a lower bound', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([499, 2, 1]), hasLinks: spending([10]) }, pts: [null, 20] });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await refreshOnce(deps);
    error.mockRestore();
    expect(await deps.state.heavy.get(H)).toMatchObject({ pts: 501, floor: true });
    expect([deps.written, await deps.journal.read(10)]).toEqual([[{ id: 'l', value: 'id in (2)' }], []]);
  });
  it('hands a group that last cost more than the light limit to the heavy lane without computing it', async () => {
    const compute = { hasSubtasks: spending([10]), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute, pts: [600, 20] });
    await refreshOnce(deps);
    expect([compute.hasSubtasks.mock.calls.length, (await deps.state.heavy.get(H))?.key]).toEqual([0, H]);
  });
  it('writes the error with its numbers for a group that last cost more than the group limit', async () => {
    const compute = { hasSubtasks: spending([10]), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute, pts: [3000, 20] });
    await refreshOnce(deps);
    expect(compute.hasSubtasks).not.toHaveBeenCalled();
    expect(deps.written[0]).toEqual({ id: 'h', error: "hasSubtasks: the result needs about 3,000 Jira API points; on this site ArtUp Query may spend at most 2,000 on one function (Jira's rate limit for apps)." });
  });
  it('does not recompute a background job whose stopped run reached the group limit', async () => {
    const compute = { parentsOf: spending([10]), hasSubtasks: spending([10]), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: BUDGET_AT, pts: 2000, floor: true });
    await refreshOnce(deps);
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('takes the cheapest known groups of a cut first', async () => {
    const order = [];
    const record = (name) => async () => { order.push(name); return { ids: ['2'], field: 'id', watch: null }; };
    const deps = await budgetDeps({ compute: { hasSubtasks: record('hasSubtasks'), hasLinks: record('hasLinks') }, pts: [20, 10] });
    await deps.state.cut.set({ key: deps.rowKey, startedAt: 5, done: [] });
    await refreshOnce(deps);
    expect(order).toEqual(['hasLinks', 'hasSubtasks']);
  });
  it('verifies the touched issues of a cut that a verify job finishes', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([10]), hasLinks: spending([10]) }, touched: ids(3) });
    await deps.state.cut.set({ key: deps.rowKey, startedAt: 5, done: [] });
    await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT, verify: ['999'], kinds: ['issue-updated'] } });
    expect(deps.pushed.filter(([body]) => body.verify).map(([body]) => body.verify)).toEqual([ids(3)]);
  });
  it('finishes a cut whose only open group fails by handing it to the heavy lane, so later rows are read', async () => {
    const compute = { hasSubtasks: vi.fn(async () => { throw jiraError(403); }), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute });
    await deps.state.cut.set({ key: deps.rowKey, startedAt: 5, done: [L] });
    await deps.journal.append({ ids: ['7'], kinds: ['link'] }, BUDGET_AT + 100);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await refreshOnce(deps);
    expect(await deps.state.cut.get()).toBe(null);
    const next = await refreshOnce(deps);
    error.mockRestore();
    expect([next.events, compute.hasLinks.mock.calls.length, (await deps.state.heavy.get(H))?.key]).toEqual([1, 1, H]);
  });
  it('hands a background job whose stopped run passed the light limit to the heavy lane without computing it', async () => {
    const compute = { parentsOf: spending([10]), hasSubtasks: spending([10]), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute, searches: { '(q) AND id in (9)': ['9'] } });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: BUDGET_AT, pts: 600, floor: true });
    await refreshOnce(deps);
    expect(compute.parentsOf).not.toHaveBeenCalled();
    expect(await deps.state.heavy.get('parentsOf["q"]')).toMatchObject({ pts: 600, floor: true });
  });
  it('keeps the higher lower bound of a background job the light limit stopped', async () => {
    const compute = { parentsOf: spending([499, 2, 1]), hasSubtasks: spending([10]), hasLinks: spending([10]) };
    const deps = await budgetDeps({ compute, searches: { '(q) AND id in (9)': ['9'] } });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: BUDGET_AT, pts: 300, floor: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await refreshOnce(deps);
    error.mockRestore();
    expect(await deps.state.heavy.get('parentsOf["q"]')).toMatchObject({ pts: 501, floor: true });
  });
  it('adds nothing to a cut written over rows it did not read', async () => {
    let deps;
    const hasSubtasks = vi.fn(async () => {
      await deps.state.cut.set({ key: 't:999999999999999:z', startedAt: 7, done: ['other'] });
      await spend(40);
      return { ids: ['2'], field: 'id', watch: null };
    });
    deps = await budgetDeps({ compute: { hasSubtasks, hasLinks: spending([30, 1]) }, refreshSpent: 2930 });
    await refreshOnce(deps);
    expect(await deps.state.cut.get()).toEqual({ key: 't:999999999999999:z', startedAt: 7, done: ['other'] });
  });
  it('does not rewrite an unchanged cut while the refresh reserve stays spent', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: spending([10]), hasLinks: spending([10]) }, refreshSpent: 3000 });
    await refreshOnce(deps);
    const writes = deps.kvs.calls.ops.filter((op) => op === 'set q:cut').length;
    await refreshOnce(deps);
    expect(deps.kvs.calls.ops.filter((op) => op === 'set q:cut').length).toEqual(writes);
  });
  it('renews the lease after each group', async () => {
    const deps = await budgetDeps({ compute: { hasSubtasks: vi.fn(async () => { deps.advance(5000); return { ids: ['2'], field: 'id', watch: null }; }), hasLinks: spending([10]) } });
    await refreshOnce(deps);
    expect(await deps.state.lease.get()).toEqual(BUDGET_AT + 5000);
  });
});

describe('verify after a rate limit', () => {
  it('verifies the touched issues of the passes written before a 429 stopped the next one', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    let calls = 0;
    let deps;
    const hasSubtasks = async () => {
      calls += 1;
      if (calls === 1) {
        await deps.journal.append({ ids: ['8'], kinds: ['issue-created'] }, 1000100);
        return { ids: ['2'], field: 'id', watch: null };
      }
      throw Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429, retryAt: null });
    };
    deps = makeDeps({ pcs, compute: { hasSubtasks } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    error.mockRestore();
    expect(deps.pushed.filter(([body]) => body.verify).map(([body]) => body.verify)).toEqual([['9']]);
  });
});

describe('write decision by the cache meta', () => {
  const slim = (extra = {}) => ({ id: 'h', functionName: 'hasSubtasks', arguments: [], operator: 'in', used: RECENT, value: 'id in (1)', ...extra });
  const result = (ids2) => async () => ({ ids: ids2, field: 'id', watch: null });
  const cached = (values) => ({ values, watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh', lv: 1, posted: true });
  async function pass(pcs, compute, meta) {
    const deps = makeDeps({ pcs, compute: { hasSubtasks: compute } });
    if (meta) await deps.cache.write('hasSubtasks[]', meta);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    return deps;
  }
  it('writes nothing when the result matches the cache meta and every precomputation holds a value alone', async () => {
    const deps = await pass([slim()], result(['2']), cached(['2']));
    expect(deps.written).toEqual([]);
  });
  it('writes every precomputation of the group when the result differs from the cache meta', async () => {
    const deps = await pass([slim(), slim({ id: 'n', operator: 'not in' })], result(['3']), cached(['2']));
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (3)' }, { id: 'n', value: 'NOT (id in (3))' }]);
  });
  it('writes when a precomputation stores an error although the result matches the meta', async () => {
    const deps = await pass([slim({ error: 'Computing, retry in a minute' })], result(['2']), cached(['2']));
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)', error: null }]);
  });
  it('writes the older result a pass computed after the heavy lane wrote a newer one, so Jira holds what the pass saw', async () => {
    const deps = await pass([slim()], result(['1']), cached(['2']));
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (1)' }]);
  });
  it('leaves a group whose precomputations store the too-expensive error', async () => {
    const compute = vi.fn(result(['2']));
    await pass([slim({ value: undefined, error: ERR.tooExpensive('hasSubtasks', { n: null, points: null, limit: 9 }) })], compute, null);
    expect(compute).not.toHaveBeenCalled();
  });
  it('keeps the tree levels in the cache meta', async () => {
    const deps = await pass([slim()], result(['3']), null);
    expect((await deps.cache.meta('hasSubtasks[]')).lv).toEqual(1);
  });
});

describe('pass overhead and the pause between passes', () => {
  const USED = new Date(BUDGET_AT - 1000).toISOString();
  const pcs = [
    { id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: USED },
    { id: 'p', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: USED },
  ];
  async function overheadDeps({ listCost = 300, checkCost = 10, computeCost = 40 } = {}) {
    const compute = async () => { await spend(computeCost); return { ids: ['2'], field: 'id', watch: null }; };
    const deps = withBudget(makeDeps({ pcs, compute: { hasSubtasks: compute, parentsOf: compute } }));
    const list = deps.jira.precomputations;
    deps.jira.precomputations = async () => { await spend(listCost); return list(); };
    deps.jira.searchIds = async () => { await spend(checkCost); return []; };
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, BUDGET_AT - 500);
    return deps;
  }
  it('counts what a pass spent besides reading the list and recomputing', async () => {
    const deps = await overheadDeps();
    expect((await refreshOnce(deps)).overhead).toEqual(10);
  });
  it('records the overhead of the last pass and the pause it sets', async () => {
    const deps = await overheadDeps({ checkCost: 50 });
    await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT } });
    expect(await deps.state.lastRefresh.get()).toMatchObject({ overhead: 50, interval: passInterval(50, 10000) });
  });
  it('runs no pass before the pause after the last one ends and pushes a refresh for its end', async () => {
    const deps = await overheadDeps();
    await deps.state.lastRefresh.set({ at: BUDGET_AT - 1000, passes: 1, changed: 0, oldestEventMs: 0, overhead: 50, interval: 60 });
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT } });
    expect(result).toEqual({ debounced: BUDGET_AT + 59000 });
    expect([deps.pushed, (await deps.journal.read(10)).length]).toEqual([[[{ kind: 'refresh', ts: BUDGET_AT }, 59]], 1]);
  });
  it('runs a pass once the pause has passed', async () => {
    const deps = await overheadDeps();
    await deps.state.lastRefresh.set({ at: BUDGET_AT - 60000, passes: 1, changed: 0, oldestEventMs: 0, overhead: 50, interval: 60 });
    expect((await onRefresh(deps, { body: { kind: 'refresh', ts: BUDGET_AT } })).passes).toHaveLength(1);
  });
});

describe('the cache meta never runs ahead of Jira', () => {
  const pc = (extra = {}) => ({ id: 'h', functionName: 'hasSubtasks', arguments: [], operator: 'in', used: RECENT, value: 'id in (1)', ...extra });
  const posted = (values, startedAt = 0) => ({ values, watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh', lv: 1, startedAt, posted: true });
  it('writes what a pass computed when another writer changed the meta after the pass read it', async () => {
    let deps;
    const hasSubtasks = async () => {
      await deps.cache.write('hasSubtasks[]', posted(['2'], 500));
      return { ids: ['1'], field: 'id', watch: null };
    };
    deps = makeDeps({ pcs: [pc()], compute: { hasSubtasks } });
    await deps.cache.write('hasSubtasks[]', posted(['1']));
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (1)' }]);
  });
  it('writes every precomputation of a group whose meta a function call wrote', async () => {
    const deps = makeDeps({ pcs: [pc()], compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.cache.write('hasSubtasks[]', { ...posted(['2']), posted: false, source: 'function' });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
  });
  it('marks the meta of a group it wrote as posted', async () => {
    const deps = makeDeps({ pcs: [pc()], compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect((await deps.cache.meta('hasSubtasks[]')).posted).toBe(true);
  });
  it('writes the new value of a background job once a function answer from the cache made Jira store it', async () => {
    const deps = makeDeps({ pcs: [], compute: { subtasksOf: async () => ({ ids: ['5'], field: 'parent', watch: ['5'] }) } });
    await deps.cache.write('subtasksOf["q"]', { values: ['4'], watch: ['4', '5'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', at: 1000000, source: 'job', lv: 1 });
    await deps.pcList.list();
    await handleFunction(deps, 'subtasksOf', { precomputationId: 's1', clause: { field: 'issue', operator: 'in', arguments: ['q'] } }, { environmentType: 'DEVELOPMENT' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 1000100);
    await refreshOnce(deps);
    expect(deps.written.map((u) => u.id)).toEqual(['s1']);
  });
});

describe('reconcile writes what it computes', () => {
  it('writes a group whose result matches its meta', async () => {
    const old = new Date(1000000 - 2 * 3600000).toISOString();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], operator: 'in', value: 'id in (2)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.cache.write('hasSubtasks[]', { values: ['2'], watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh', lv: 1, posted: true });
    await onReconcile(deps);
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
  });
});

describe('groups outside the used window', () => {
  const longAgo = new Date(1000000 - 2 * 24 * 3600000).toISOString();
  it('marks a query group with the pass start on any touched issue, without reading its watch or computing it', async () => {
    const parentsOf = vi.fn();
    const deps = makeDeps({ pcs: [{ id: 'p', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: longAgo }], compute: { parentsOf } });
    deps.cache.watchHit = vi.fn();
    await deps.journal.append({ ids: ['9'], kinds: ['issue-updated'] }, 999500);
    await refreshOnce(deps);
    expect([await deps.state.skip.get('parentsOf["q"]'), parentsOf.mock.calls.length, deps.cache.watchHit.mock.calls.length, (await deps.journal.read(10)).length]).toEqual([1000000, 0, 0, 0]);
  });
  it('keeps the first skip mark of a group', async () => {
    const deps = makeDeps({ pcs: [{ id: 'p', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: longAgo }] });
    await deps.state.skip.set('parentsOf["q"]', 5);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-updated'] }, 999500);
    await refreshOnce(deps);
    expect(await deps.state.skip.get('parentsOf["q"]')).toEqual(5);
  });
  it('marks another family only on the changes it wants', async () => {
    const deps = makeDeps({ pcs: [{ id: 'l', functionName: 'hasLinks', arguments: [], value: 'id in (1)', used: longAgo }] });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await refreshOnce(deps);
    expect(await deps.state.skip.get('hasLinks[]')).toBe(null);
    await deps.journal.append({ ids: ['9'], kinds: ['link'] }, 999600);
    await refreshOnce(deps);
    expect(await deps.state.skip.get('hasLinks[]')).toEqual(1000000);
  });
  it('marks an unused slow group a rewrite of all would hand to the heavy lane', async () => {
    const deps = makeDeps({ pcs: [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'id in (1)', used: longAgo }] });
    await deps.cache.write('childIssuesOf["q"]', { values: ['1'], watch: [], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: 60000 });
    await deps.journal.append({ ids: [], kinds: [REWRITE_ALL_KIND] }, 999500);
    await refreshOnce(deps);
    expect([await deps.state.skip.get('childIssuesOf["q"]'), await deps.state.heavy.get('childIssuesOf["q"]')]).toEqual([1000000, null]);
  });
});

describe('a group that keeps failing', () => {
  it('goes to the heavy lane, so the pass drops its rows and reads the next ones', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => { throw jiraError(403); } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pass = await refreshOnce(deps);
    error.mockRestore();
    expect(pass).toMatchObject({ failed: 1, handed: 1 });
    expect([(await deps.state.heavy.get('hasSubtasks[]'))?.key, await deps.journal.read(10)]).toEqual(['hasSubtasks[]', []]);
    expect((await deps.state.errors())[0].message).toEqual('Refresh failed: Jira answered 403');
  });
});
