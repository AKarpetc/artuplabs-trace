import { describe, expect, it, vi } from 'vitest';
import { ids, makeDeps, RECENT } from './makeDeps.js';
import { onRefresh, pushRefresh, refreshOnce, rewrite } from '../../src/handlers/refresh.js';
import { FAILED_ROWS_KEEP_MS, REFRESH_RETRY_DELAY_S, WORKER_BUDGET_MS } from '../../src/core/limits.js';

const jiraError = (status) => Object.assign(new Error(`Jira answered ${status}`), { name: 'JiraError', status });

describe('refreshOnce', () => {
  it('does nothing on an empty journal', async () => {
    expect(await refreshOnce(makeDeps())).toBeNull();
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
  it('counts a group whose live search breaks as failed and keeps the journal', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, searches: { '(q) AND id in (5)': new TypeError('bug') } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await refreshOnce(deps)).failed).toBe(1);
    error.mockRestore();
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('leaves query groups alone when the events touched no issue', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const compute = { parentsOf: vi.fn() };
    const deps = makeDeps({ pcs, compute });
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(0);
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('recomputes every group when the journal page asks for everything', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const seen = [];
    const deps = makeDeps({ pcs, compute: { parentsOf: async (args, ctx) => { seen.push(ctx.reconcile); return { ids: ['1'], field: 'id', watch: [] }; } } });
    await deps.journal.append({ ids: ids(60), kinds: ['issue-updated'] }, 999500);
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
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('drops rows older than the failure window even while a group keeps failing', async () => {
    const pcs = [{ id: 'bad', functionName: 'previousSprint', arguments: ['B'], value: 'sprint = 1', used: RECENT }];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ pcs, compute: { previousSprint: async () => { throw new TypeError('bug'); } } });
    deps.advance(FAILED_ROWS_KEEP_MS);
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999999);
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, deps.now() - 500);
    await refreshOnce(deps);
    error.mockRestore();
    expect((await deps.journal.read(10)).map((r) => r.key)).toEqual([`t:${String(deps.now() - 500).padStart(15, '0')}:0002`]);
    expect((await deps.state.errors())[0].message).toBe('Refresh failed');
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
    expect(await rewrite(deps, group('parentsOf', [], [{ id: 'x', arguments: [], value: 'id in (1)' }]), [])).toEqual([{ id: 'x', error: 'Usage: parentsOf(subquery)' }]);
  });
  it('stores the readiness error while the index is building', async () => {
    const deps = makeDeps({ ready: async () => 'Index is building: 1 of 2 issues' });
    expect(await rewrite(deps, group('hasSubtasks', [], [{ id: 'x', arguments: [], value: 'id in (1)' }]), [])).toEqual([{ id: 'x', error: 'Index is building: 1 of 2 issues' }]);
  });
  it('stores the error a value source answers', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ error: 'Board "B" not found', log: 'Board not found' }) } });
    expect(await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], value: 'sprint = 1' }]), [])).toEqual([{ id: 'x', error: 'Board "B" not found' }]);
  });
  it('writes nothing when the stored value is unchanged', async () => {
    const deps = makeDeps({ compute: { previousSprint: async () => ({ native: 'sprint = 1' }) } });
    expect(await rewrite(deps, group('previousSprint', ['B'], [{ id: 'x', arguments: ['B'], value: 'sprint = 1' }]), [])).toEqual([]);
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
    expect(await deps.state.lastRefresh.get()).toEqual({ at: 1000000, passes: 1, changed: 1, oldestEventMs: 500 });
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
  it('schedules a delayed follow-up refresh when a group failed', async () => {
    const pcs = [{ id: 'bad', functionName: 'previousSprint', arguments: ['B'], value: 'sprint = 1', used: RECENT }];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ pcs, compute: { previousSprint: async () => { throw jiraError(403); } } });
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    error.mockRestore();
    expect(result.passes).toHaveLength(1);
    expect(deps.pushed).toEqual([[{ kind: 'refresh', ts: 1000000 }, REFRESH_RETRY_DELAY_S]]);
    expect(await deps.state.pending.get()).toBe(1000000);
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
    expect(await onRefresh(deps, { body: { kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] } })).toEqual({ computed: 'parentsOf["q"]' });
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
