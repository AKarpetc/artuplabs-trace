import { describe, expect, it } from 'vitest';
import { makeDeps, never } from './makeDeps.js';
import { computeGroup, createFunctionHandlers, fragmentFor, handleFunction, licenceInput } from '../../src/handlers/functions.js';
import { FUNCTIONS } from '../../src/core/catalog.js';
import { createBoardCompute } from '../../src/compute/boards.js';
import { fakeJira } from '../fakeJira.js';
import { PAGE_CACHE_MS } from '../../src/core/limits.js';

const fnDeps = (compute, extra = {}) => makeDeps({ compute, ...extra });
const ids = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const payload = (...args) => ({ clause: { field: 'issue', operator: 'in', arguments: args } });
const DEV = { environmentType: 'DEVELOPMENT' };
const SUBTASK_GROUP = 'subtasksOf["project = A"]';
const jobEntry = (values) => ({ values, watch: values, field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', at: 1000000, source: 'job' });

describe('handleFunction', () => {
  it('returns an id list for a small result', async () => {
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3', '5'], field: 'id', watch: ['9'] }) });
    expect(await handleFunction(deps, 'parentsOf', payload('project = A'), DEV)).toEqual({ jql: 'id in (3,5)' });
  });
  it('answers unlicensed in production without an active licence', async () => {
    const deps = fnDeps({});
    expect(await handleFunction(deps, 'parentsOf', payload('q'), { environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ error: 'ArtUp Query license is not active', storeErrorAsPrecomputation: false });
  });
  it('shows argument errors and logs them without the arguments', async () => {
    const deps = fnDeps({});
    expect(await handleFunction(deps, 'subtasksOf', payload(), DEV)).toEqual({ error: 'Usage: subtasksOf(subquery)', storeErrorAsPrecomputation: false });
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'subtasksOf', message: 'Usage: subtasksOf(subquery)' }]);
  });
  it('turns a Jira 400 on the subquery into the function error', async () => {
    const bad = Object.assign(new Error('Field \'x\' does not exist'), { name: 'JiraError', status: 400 });
    const deps = fnDeps({ subtasksOf: async () => { throw bad; } });
    expect(await handleFunction(deps, 'subtasksOf', payload('x = 1'), DEV)).toEqual({ error: 'subtasksOf: Field \'x\' does not exist', storeErrorAsPrecomputation: false });
  });
  it('logs a rejected subquery with a generic message, never Jira\'s text', async () => {
    const bad = Object.assign(new Error('The value \'Secret project\' does not exist for the field \'project\'.'), { name: 'JiraError', status: 400 });
    const deps = fnDeps({ subtasksOf: async () => { throw bad; } });
    await handleFunction(deps, 'subtasksOf', payload('project = "Secret project"'), DEV);
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'subtasksOf', message: 'Subquery rejected by Jira' }]);
  });
  it('logs several link types without naming them', async () => {
    const deps = fnDeps({});
    const reply = await handleFunction(deps, 'linkedIssuesOf', payload('q', 'Secret one', 'Secret two'), DEV);
    expect(reply.error).toContain('"Secret one"');
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'linkedIssuesOf', message: 'Several link types' }]);
  });
  it('logs a missing board without its name', async () => {
    const deps = fnDeps(createBoardCompute({ jira: fakeJira({ boards: [] }) }));
    expect(await handleFunction(deps, 'nextSprint', payload('Payroll board'), DEV)).toEqual({ error: 'Board "Payroll board" not found', storeErrorAsPrecomputation: false });
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'nextSprint', message: 'Board not found' }]);
  });
  it('logs a generic line for an error that carries no log text', async () => {
    const deps = fnDeps({ parentsOf: async () => ({ error: 'Something about "Secret"' }) });
    await handleFunction(deps, 'parentsOf', payload('q'), DEV);
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'parentsOf', message: 'Function call rejected' }]);
  });
  it('serves a leaf page from the values the root cached', async () => {
    let calls = 0;
    const deps = fnDeps({ linkedIssuesOf: async () => { calls += 1; return { ids: ids(2500), field: 'id', watch: [] }; } });
    const root = await handleFunction(deps, 'linkedIssuesOf', payload('q'), DEV);
    expect(root.jql).toBe('(issue in linkedIssuesOf("q", "__aq:l1") OR issue in linkedIssuesOf("q", "__aq:l2") OR issue in linkedIssuesOf("q", "__aq:l3"))');
    expect(await handleFunction(deps, 'linkedIssuesOf', payload('q', '__aq:l3'), DEV)).toEqual({ jql: `id in (${ids(2500).slice(2000).join(',')})` });
    expect(calls).toBe(1);
  });
  it('recomputes a page once the cache expired', async () => {
    let calls = 0;
    const deps = fnDeps({ linkedIssuesOf: async () => { calls += 1; return { ids: ids(1500), field: 'id', watch: [] }; } });
    await handleFunction(deps, 'linkedIssuesOf', payload('q'), DEV);
    deps.advance(PAGE_CACHE_MS);
    await handleFunction(deps, 'linkedIssuesOf', payload('q', '__aq:l2'), DEV);
    expect(calls).toBe(2);
  });
  it('queues the computation when the budget runs out and says so', async () => {
    const deps = fnDeps({ subtasksOf: never }, { sleep: async () => {} });
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ error: 'Computing, retry in a minute', storeErrorAsPrecomputation: false });
    expect(deps.pushed).toEqual([[{ kind: 'compute', functionName: 'subtasksOf', userArgs: ['project = A'] }, null]]);
    expect((await deps.state.jobs(1000000)).map((j) => j.key)).toEqual([SUBTASK_GROUP]);
    expect(await deps.state.errors()).toEqual([]);
  });
  it('queues the computation when Jira keeps failing', async () => {
    const deps = fnDeps({ subtasksOf: async () => { throw Object.assign(new Error('down'), { name: 'JiraError', status: 503 }); } });
    expect((await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).error).toBe('Computing, retry in a minute');
    expect(deps.pushed).toHaveLength(1);
  });
  it('serves the root from a finished compute job', async () => {
    const deps = fnDeps({ subtasksOf: never });
    await deps.cache.write(SUBTASK_GROUP, jobEntry(['4']));
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ jql: '(issuetype in subTaskIssueTypes()) AND (parent in (4))' });
  });
  it('rereads the cache once when its generation switched during the read', async () => {
    const deps = fnDeps({ subtasksOf: never });
    await deps.cache.write(SUBTASK_GROUP, jobEntry(['4']));
    const old = await deps.cache.meta(SUBTASK_GROUP);
    await deps.cache.write(SUBTASK_GROUP, jobEntry(['8']));
    const live = deps.cache;
    let reads = 0;
    deps.cache = { ...live, meta: async (key) => { reads += 1; return reads === 1 ? old : live.meta(key); } };
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ jql: '(issuetype in subTaskIssueTypes()) AND (parent in (8))' });
  });
  it('recomputes instead of serving a partial list when cached chunks keep missing', async () => {
    const deps = fnDeps({ subtasksOf: async () => ({ ids: ['5'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: ['5'] }) });
    await deps.cache.write(SUBTASK_GROUP, jobEntry(['4']));
    for (const key of [...deps.kvs.data.keys()].filter((k) => k.startsWith(`v:${SUBTASK_GROUP}:c`))) deps.kvs.data.delete(key);
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ jql: '(issuetype in subTaskIssueTypes()) AND (parent in (5))' });
  });
  it('returns native JQL as it is', async () => {
    const deps = fnDeps({ hasLinks: async () => ({ native: 'issueLinkType is not EMPTY' }) });
    expect(await handleFunction(deps, 'hasLinks', payload(), DEV)).toEqual({ jql: 'issueLinkType is not EMPTY' });
  });
  it('answers the index error while the index builds', async () => {
    const deps = fnDeps({}, { ready: async () => 'Index is building: 5 of 10 issues' });
    expect((await handleFunction(deps, 'parentsOf', payload('q'), DEV)).error).toBe('Index is building: 5 of 10 issues');
  });
});

describe('licence of a function call', () => {
  const answer = { parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) };
  it('reads the environment from the app context', async () => {
    const deps = fnDeps(answer, { appContext: () => ({ environmentType: 'DEVELOPMENT' }) });
    expect(await handleFunction(deps, 'parentsOf', payload('q'), {})).toEqual({ jql: 'id in (3)' });
  });
  it('treats a call with no known environment as production', async () => {
    const deps = fnDeps(answer, { appContext: () => null });
    expect((await handleFunction(deps, 'parentsOf', payload('q'), {})).error).toBe('ArtUp Query license is not active');
  });
  it('is unlicensed in production when Jira sends no licence', async () => {
    const deps = fnDeps(answer, { appContext: () => ({ environmentType: 'PRODUCTION' }) });
    expect((await handleFunction(deps, 'parentsOf', payload('q'), {})).error).toBe('ArtUp Query license is not active');
  });
  it('is licensed in production with an active licence in the handler context', async () => {
    const deps = fnDeps(answer, { appContext: () => ({ environmentType: 'PRODUCTION' }) });
    expect(await handleFunction(deps, 'parentsOf', payload('q'), { license: { active: true } })).toEqual({ jql: 'id in (3)' });
  });
  it('takes the app context environment over the handler context', () => {
    expect(licenceInput({}, { environmentType: 'DEVELOPMENT' }, { environmentType: 'PRODUCTION', license: { active: true } })).toEqual({ environmentType: 'PRODUCTION', license: { active: true } });
  });
});

describe('computeGroup', () => {
  it('passes the reconcile context to the value source and caches the list under the given source', async () => {
    const seen = [];
    const deps = fnDeps({ parentsOf: async (args, ctx) => { seen.push([args, ctx]); return { ids: ['3'], field: 'id', watch: ['9'] }; } });
    await computeGroup(deps, 'parentsOf', { subquery: 'q' }, ['q'], { reconcile: ['7'], source: 'job' });
    expect(seen).toEqual([[{ subquery: 'q' }, { reconcile: ['7'] }]]);
    expect(await deps.cache.meta('parentsOf["q"]')).toMatchObject({ n: 1, source: 'job', field: 'id', at: 1000000 });
  });
  it('passes an empty reconcile list when none is given', async () => {
    const seen = [];
    const deps = fnDeps({ hasSubtasks: async (args, ctx) => { seen.push(ctx); return { ids: [], field: 'id', watch: null }; } });
    await computeGroup(deps, 'hasSubtasks', {}, []);
    expect(seen).toEqual([{ reconcile: [] }]);
  });
  it('rethrows errors that are not a rejected subquery', async () => {
    const deps = fnDeps({ parentsOf: async () => { throw new TypeError('boom'); } });
    await expect(computeGroup(deps, 'parentsOf', { subquery: 'q' }, ['q'])).rejects.toThrow('boom');
  });
});

describe('fragmentFor', () => {
  it('passes an error through', () => {
    expect(fragmentFor('parentsOf', ['q'], null, { error: 'x' }, 1)).toEqual({ error: 'x' });
  });
});

describe('createFunctionHandlers', () => {
  it('has one handler per catalog function', () => {
    expect(Object.keys(createFunctionHandlers(fnDeps({})))).toEqual(FUNCTIONS.map((f) => f.name));
  });
});
