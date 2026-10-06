import { describe, expect, it, vi } from 'vitest';
import { BUDGET_AT, makeDeps, never, spend, withBudget } from './makeDeps.js';
import { brakeNear } from '../../src/handlers/brake.js';
import { computeGroup, costOf, createFunctionHandlers, fragmentFor, handleFunction, licenceInput } from '../../src/handlers/functions.js';
import { FUNCTIONS } from '../../src/core/catalog.js';
import { createBoardCompute } from '../../src/compute/boards.js';
import { createFieldCompute } from '../../src/compute/fields.js';
import { createHierarchyCompute } from '../../src/compute/hierarchy.js';
import { createJira } from '../../src/infra/jira.js';
import { fakeJira } from '../fakeJira.js';
import { NEAR_FN_POINTS, PAGE_CACHE_MS, POINTS_OVERRUN, QUEUE_DELAY_MAX_S } from '../../src/core/limits.js';

const fnDeps = (compute, extra = {}) => makeDeps({ compute, ...extra });
const ids = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const payload = (...args) => ({ clause: { field: 'issue', operator: 'in', arguments: args } });
const notIn = (...args) => ({ clause: { field: 'issue', operator: 'not in', arguments: args } });
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
  it('still shows the argument error when the error log cannot be written', async () => {
    const deps = fnDeps({});
    deps.state.recordError = async () => { throw Object.assign(new Error('Limits for the current installation have been exceeded'), { name: 'ForgeKvsError' }); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await handleFunction(deps, 'subtasksOf', payload(), DEV)).toEqual({ error: 'Usage: subtasksOf(subquery)', storeErrorAsPrecomputation: false });
    expect(error.mock.calls.flat().join(' ')).not.toContain('subquery)');
    error.mockRestore();
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
  it('queues the computation after 10 s, inside the 15 s Jira waits for an answer', async () => {
    const slept = [];
    const deps = fnDeps({ subtasksOf: never }, { sleep: async (ms) => { slept.push(ms); } });
    await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV);
    expect(slept).toEqual([10000]);
  });
  it('still answers Computing when the queue refuses the job', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = fnDeps({ subtasksOf: never }, { sleep: async () => {}, queue: { push: async () => { throw new Error('400 Bad Request'); } } });
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ error: 'Computing, retry in a minute', storeErrorAsPrecomputation: false });
    error.mockRestore();
    expect((await deps.state.jobs(1000000)).map((j) => j.key)).toEqual([SUBTASK_GROUP]);
  });
  it('still answers Computing when the job record cannot be stored', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = fnDeps({ subtasksOf: never }, { sleep: async () => {} });
    deps.state.addJob = async () => { throw new Error('KVS down'); };
    expect((await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).error).toBe('Computing, retry in a minute');
    error.mockRestore();
  });
  it('answers Computing and queues the computation instead of throwing on an unexpected failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = fnDeps({}, { ready: async () => { throw new Error('KVS down'); } });
    expect(await handleFunction(deps, 'parentsOf', payload('q'), DEV)).toEqual({ error: 'Computing, retry in a minute', storeErrorAsPrecomputation: false });
    error.mockRestore();
    expect(deps.pushed).toEqual([[{ kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] }, null]]);
  });
  it('answers Computing, pauses the background until the reset and queues no computation when Jira rate-limits the call', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const limited = Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429, retryAt: 1000000 + 425000 });
    const deps = fnDeps({ subtasksOf: async () => { throw limited; } });
    expect((await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).error).toBe('Computing, retry in a minute');
    error.mockRestore();
    expect([await deps.state.brake.get(), deps.pushed]).toEqual([{ until: 1000000 + 425000, reason: 'rate' }, [[{ kind: 'wake' }, Math.min(425, QUEUE_DELAY_MAX_S)]]]);
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
    for (const key of [...deps.kvs.data.keys()].filter((k) => k.startsWith(`v:${SUBTASK_GROUP}:k`))) deps.kvs.data.delete(key);
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

describe('handleFunction with not in', () => {
  it('answers a computed id list with its complement', async () => {
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3', '5'], field: 'id', watch: [] }) });
    expect(await handleFunction(deps, 'parentsOf', notIn('project = A'), DEV)).toEqual({ jql: 'NOT (id in (3,5))' });
  });
  it('answers a tree root with filter and a native result with their complement', async () => {
    const deps = fnDeps({ subtasksOf: async () => ({ ids: ['1'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: [] }), hasAttachments: async () => ({ native: 'attachments is not EMPTY' }) });
    expect(await handleFunction(deps, 'subtasksOf', notIn('project = A'), DEV)).toEqual({ jql: 'NOT ((issuetype in subTaskIssueTypes()) AND (parent in (1)))' });
    expect(await handleFunction(deps, 'hasAttachments', notIn(), DEV)).toEqual({ jql: 'NOT (attachments is not EMPTY)' });
  });
  it('answers an empty result with every issue', async () => {
    const deps = fnDeps({ parentsOf: async () => ({ ids: [], field: 'id', watch: [] }) });
    expect(await handleFunction(deps, 'parentsOf', notIn('project = A'), DEV)).toEqual({ jql: 'NOT (id = -1)' });
  });
  it('negates the fewer-comments fragment back to the issues with at least n comments', async () => {
    const deps = fnDeps({ hasComments: async () => ({ native: 'NOT (issue in hasComments("+2"))' }) });
    expect(await handleFunction(deps, 'hasComments', notIn('-3'), DEV)).toEqual({ jql: 'NOT (NOT (issue in hasComments("+2")))' });
  });
  it('leaves the issues of excluded projects out of the computed set, with no project clause, so not in is its exact complement', async () => {
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3', '4'], field: 'id', watch: [] }) }, { exclude: async (r) => ({ ...r, ids: r.ids.filter((id) => id !== '4') }) });
    await deps.state.setExcluded(['OPS']);
    expect(await handleFunction(deps, 'parentsOf', payload('q'), DEV)).toEqual({ jql: 'id in (3)' });
    expect(await handleFunction(deps, 'parentsOf', notIn('q'), DEV)).toEqual({ jql: 'NOT (id in (3))' });
    expect(await deps.cache.values('parentsOf["q"]', await deps.cache.meta('parentsOf["q"]'), 0, 10)).toEqual(['3']);
  });
  it('answers Computing when the excluded projects cannot be read, never an unfiltered result', async () => {
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) }, { exclude: async () => { throw new Error('kvs down'); } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await handleFunction(deps, 'parentsOf', notIn('q'), DEV)).toEqual({ error: 'Computing, retry in a minute', storeErrorAsPrecomputation: false });
    error.mockRestore();
  });
  it('answers a cached page with its complement too', async () => {
    const deps = fnDeps({});
    await deps.cache.write(SUBTASK_GROUP, jobEntry(ids(1500)));
    const leaf = await handleFunction(deps, 'subtasksOf', notIn('project = A', '__aq:l2'), DEV);
    expect(leaf.jql.startsWith('NOT (parent in (1001,')).toBe(true);
  });
  it('gives the same error and the same Computing answer as for in, never every issue', async () => {
    const deps = fnDeps({ nextSprint: async () => ({ error: 'Board "B" not found', log: 'Board not found' }), parentsOf: never });
    expect(await handleFunction(deps, 'nextSprint', notIn('B'), DEV)).toEqual({ error: 'Board "B" not found', storeErrorAsPrecomputation: false });
    const deferred = handleFunction({ ...deps, sleep: async () => {} }, 'parentsOf', notIn('q'), DEV);
    expect(await deferred).toEqual({ error: 'Computing, retry in a minute', storeErrorAsPrecomputation: false });
    expect(await handleFunction(deps, 'subtasksOf', notIn(), DEV)).toEqual({ error: 'Usage: subtasksOf(subquery)', storeErrorAsPrecomputation: false });
  });
});

describe('budget timer of a function call', () => {
  it('stops the timer once the answer is in', async () => {
    let signal;
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) }, { sleep: (ms, options) => { signal = options?.signal; return never(); } });
    await handleFunction(deps, 'parentsOf', payload('q'), DEV);
    expect(signal?.aborted).toBe(true);
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

describe('subquery validation', () => {
  const FIELD_MISSING = 'Field \'projekt\' does not exist or you do not have permission to view it.';
  const liveJira = (errors) => createJira(async (path) => {
    const body = path.startsWith('/rest/api/3/jql/parse') ? { queries: [{ query: 'q', errors }] } : { issues: [], isLast: true };
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  });
  const liveDeps = (errors) => {
    const jira = liveJira(errors);
    return fnDeps(createHierarchyCompute({ jira }), { jira });
  };
  it('shows Jira\'s parser error for a subquery that the search answers with an empty list', async () => {
    const deps = liveDeps([FIELD_MISSING]);
    expect(await handleFunction(deps, 'subtasksOf', payload('projekt = JQLG'), DEV)).toEqual({ error: `subtasksOf: ${FIELD_MISSING}`, storeErrorAsPrecomputation: false });
  });
  it('logs a subquery the parser rejects without Jira\'s text', async () => {
    const deps = liveDeps([FIELD_MISSING]);
    await handleFunction(deps, 'subtasksOf', payload('projekt = JQLG'), DEV);
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'subtasksOf', message: 'Subquery rejected by Jira' }]);
  });
  it('caches no value for a subquery the parser rejects', async () => {
    const deps = liveDeps([FIELD_MISSING]);
    await handleFunction(deps, 'subtasksOf', payload('projekt = JQLG'), DEV);
    expect(await deps.cache.meta('subtasksOf["projekt = JQLG"]')).toBeNull();
  });
  it('validates the subquery before running the value source', async () => {
    const compute = { parentsOf: vi.fn(async () => ({ ids: ['3'], field: 'id', watch: [] })) };
    const deps = fnDeps(compute, { invalid: { 'x = 1': 'Bad field' } });
    expect(await computeGroup(deps, 'parentsOf', { subquery: 'x = 1' }, ['x = 1'])).toEqual({ error: 'parentsOf: Bad field', log: 'Subquery rejected by Jira' });
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('validates the subquery of each subquery function once per computation', async () => {
    const deps = fnDeps({ linkedIssuesOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) });
    await computeGroup(deps, 'linkedIssuesOf', { subquery: 'project = A', linkType: null }, ['project = A']);
    expect(deps.validated).toEqual(['project = A']);
  });
  it('does not validate anything for a function without a subquery', async () => {
    const deps = fnDeps({ hasSubtasks: async () => ({ ids: [], field: 'id', watch: null }) });
    await computeGroup(deps, 'hasSubtasks', {}, []);
    expect(deps.validated).toEqual([]);
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

describe('handleFunction for dateCompare and expression', () => {
  const fieldCompute = () => createFieldCompute({
    jira: {
      fields: async () => [{ id: 'duedate', name: 'Due date' }, { id: 'resolutiondate', name: 'Resolved' }, { id: 'timespent', name: 'Time Spent' }],
      searchIds: async () => ['1', '2', '3'],
      bulkIssues: async () => [
        { id: '1', fields: { duedate: '2026-01-05', resolutiondate: '2026-01-07T00:00:00.000+0000', timespent: 36000 } },
        { id: '2', fields: { duedate: '2026-01-10', resolutiondate: '2026-01-07T00:00:00.000+0000', timespent: 60 } },
        { id: '3', fields: {} },
      ],
    },
    repo: null,
    commentsShipped: () => false,
  });

  it('answers in with the matching issues and not in with their complement', async () => {
    const deps = fnDeps(fieldCompute());
    expect(await handleFunction(deps, 'dateCompare', payload('q', 'resolutiondate > duedate'), DEV)).toEqual({ jql: 'id in (1)' });
    expect(await handleFunction(deps, 'dateCompare', notIn('q', 'resolutiondate > duedate'), DEV)).toEqual({ jql: 'NOT (id in (1))' });
    expect(await handleFunction(deps, 'expression', notIn('q', 'timespent > 1h'), DEV)).toEqual({ jql: 'NOT (id in (1))' });
  });
  it('returns no project clause under either operator when projects are excluded', async () => {
    const deps = fnDeps(fieldCompute());
    await deps.state.setExcluded(['OPS']);
    expect(await handleFunction(deps, 'expression', payload('q', 'timespent > 1h'), DEV)).toEqual({ jql: 'id in (1)' });
    expect(await handleFunction(deps, 'expression', notIn('q', 'timespent > 1h'), DEV)).toEqual({ jql: 'NOT (id in (1))' });
  });
  it('shows an unknown field under not in and logs it without the name', async () => {
    const deps = fnDeps(fieldCompute());
    expect(await handleFunction(deps, 'expression', notIn('q', 'timespent > "Secret field"'), DEV)).toEqual({ error: 'expression: Field "Secret field" not found', storeErrorAsPrecomputation: false });
    expect((await deps.state.errors()).map((e) => e.message)).toEqual(['Field not found']);
  });
  it('shows a parse error under in and logs it without the expression', async () => {
    const deps = fnDeps(fieldCompute());
    expect(await handleFunction(deps, 'dateCompare', payload('q', 'duedate < secretword ('), DEV)).toEqual({ error: 'dateCompare: Unexpected "(" at 22', storeErrorAsPrecomputation: false });
    expect((await deps.state.errors()).map((e) => e.message)).toEqual(['Invalid expression']);
  });
  it('shows comment times without the comment index under not in, never every issue', async () => {
    const deps = fnDeps(fieldCompute());
    expect(await handleFunction(deps, 'dateCompare', notIn('q', 'duedate < firstCommented'), DEV)).toEqual({ error: 'dateCompare: firstCommented needs the comment index, which this site does not have', storeErrorAsPrecomputation: false });
    expect((await deps.state.errors()).map((e) => e.message)).toEqual(['Comment index not shipped']);
  });
});

describe('function call under the Jira points budget', () => {
  const expression = (spending) => ({ expression: async () => { for (const n of spending) await spend(n); return { ids: ['3'], field: 'id', watch: [] }; } });
  const quiet = async (task) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      return await task();
    } finally {
      error.mockRestore();
    }
  };
  it('answers an error with its numbers, stored, and computes nothing when the estimate passes the group limit', async () => {
    const compute = { expression: vi.fn() };
    const deps = withBudget(fnDeps(compute), { count: 4000 });
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({
      error: "expression: the subquery has about 4,000 issues and needs about 8,020 Jira API points; on this site ArtUp Query may spend at most 2,000 on one function (Jira's rate limit for apps). Narrow the subquery to about 990 issues.",
      storeErrorAsPrecomputation: true,
    });
    expect([compute.expression.mock.calls.length, deps.counted, (await deps.state.errors())[0].message]).toEqual([0, ['project = A'], 'Too expensive for the Jira rate limit']);
  });
  it('takes the points the group last cost instead of counting its subquery', async () => {
    const deps = withBudget(fnDeps(expression([])));
    await deps.cache.write('expression["project = A","a > b"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: BUDGET_AT - PAGE_CACHE_MS, source: 'function', pts: 3000 });
    expect((await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).error).toContain('needs about 3,000 Jira API points');
    expect(deps.counted).toEqual([]);
  });
  it('takes the points a stopped computation spent as a lower bound', async () => {
    const deps = withBudget(fnDeps(expression([])));
    await deps.state.addJob({ key: 'expression["project = A","a > b"]', functionName: 'expression', userArgs: ['project = A', 'a > b'], at: 1, pts: 2000, floor: true });
    expect((await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).error).toContain('needs at least 2,000 Jira API points');
  });
  it('answers that the hourly allowance is used, not stored, when the function reserve cannot hold the estimate before half past', async () => {
    const deps = withBudget(fnDeps(expression([])), { count: 10 });
    await deps.points.add('fn', 1490);
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({
      error: "ArtUp Query has used this site's Jira API allowance for this hour; retry after 07:30 UTC.",
      storeErrorAsPrecomputation: false,
    });
    expect((await deps.state.errors())[0].message).toEqual('Hourly Jira allowance used');
  });
  it('computes within its reserve and keeps the points the group cost in the cache', async () => {
    const deps = withBudget(fnDeps(expression([30])), { count: 10 });
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({ jql: 'id in (3)' });
    expect((await deps.cache.meta('expression["project = A","a > b"]')).pts).toEqual(30);
  });
  it('releases the reserved estimate once the computation ends', async () => {
    const deps = withBudget(fnDeps(expression([30])), { count: 10 });
    await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV);
    expect((await deps.points.siteSpent('2026100507')).byLane).toEqual({});
  });
  it('answers an error with its numbers when the computation reaches the group limit', async () => {
    const deps = withBudget(fnDeps(expression([2000, 1])), { at: Date.parse('2026-10-05T07:40:00Z') });
    expect(await quiet(() => handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV))).toEqual({
      error: "expression: the result needs more than 2,000 Jira API points; on this site ArtUp Query may spend at most 2,000 on one function (Jira's rate limit for apps). Narrow the subquery.",
      storeErrorAsPrecomputation: true,
    });
    expect(deps.pushed).toEqual([]);
  });
  it('answers that the hourly allowance is used when the computation reaches what the function reserve has left', async () => {
    const deps = withBudget(fnDeps(expression([1500, 1])));
    expect((await quiet(() => handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV))).error).toEqual("ArtUp Query has used this site's Jira API allowance for this hour; retry after 07:30 UTC.");
    expect(deps.pushed).toEqual([]);
  });
  it('borrows what the hour has left from half past', async () => {
    const deps = withBudget(fnDeps(expression([30])), { at: Date.parse('2026-10-05T07:40:00Z'), count: 10 });
    await deps.points.add('fn', 1500);
    await deps.points.add('refresh', 7000);
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({ jql: 'id in (3)' });
  });
  it('still computes a cheap function while Jira warns that the pool is nearly used', async () => {
    const deps = withBudget(fnDeps(expression([30])), { count: 100 });
    await brakeNear(deps);
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({ jql: 'id in (3)' });
  });
  it('answers that the allowance is used for a dearer function while Jira warns that the pool is nearly used', async () => {
    const deps = withBudget(fnDeps(expression([30])), { count: 200 });
    await brakeNear(deps);
    expect((await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).error).toEqual("ArtUp Query has used this site's Jira API allowance for this hour; retry after 08:00 UTC.");
  });
  it('answers a cached result without counting or reading the ledger', async () => {
    const deps = withBudget(fnDeps({ subtasksOf: async () => ({ ids: ['3'], field: 'parent', watch: [] }) }));
    await deps.cache.write(SUBTASK_GROUP, { ...jobEntry(['3']), at: BUDGET_AT });
    const queries = deps.kvs.calls.queries;
    expect((await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).jql).toContain('3');
    expect([deps.counted, deps.kvs.calls.queries]).toEqual([[], queries]);
  });
  it('counts nothing for a function whose cost does not follow a query', async () => {
    const deps = withBudget(fnDeps(createBoardCompute({ jira: fakeJira({ boards: [{ id: 1, name: 'B' }], sprints: { 1: [] } }) })));
    await handleFunction(deps, 'previousSprint', payload('B'), DEV);
    expect(deps.counted).toEqual([]);
  });
  it('shows the parser error of Jira for an invalid subquery instead of counting it', async () => {
    const deps = withBudget(fnDeps(expression([])), { count: 10 });
    deps.jira.validateJql = async () => { throw Object.assign(new Error('bad jql'), { name: 'JiraError', status: 400 }); };
    expect(await handleFunction(deps, 'expression', payload('x = 1', 'a > b'), DEV)).toEqual({ error: 'expression: bad jql', storeErrorAsPrecomputation: false });
    expect([deps.counted, deps.pushed]).toEqual([[], []]);
  });
  it('computes a group whose last run passed the limit by no more than one request round', async () => {
    const deps = withBudget(fnDeps(expression([30])), { at: Date.parse('2026-10-05T07:40:00Z') });
    await deps.cache.write('expression["project = A","a > b"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'function', pts: 2001 + POINTS_OVERRUN });
    expect((await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).error).toContain('needs about');
    await deps.cache.write('expression["project = A","a > b"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 2, source: 'function', pts: 2000 + POINTS_OVERRUN, startedAt: 1 });
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({ jql: 'id in (3)' });
  });
  it('stops a computation at the near-limit allowance while Jira warns that the pool is nearly used', async () => {
    const deps = withBudget(fnDeps(expression([NEAR_FN_POINTS, 1])));
    await brakeNear(deps);
    expect(await quiet(() => handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV))).toEqual({
      error: "ArtUp Query has used this site's Jira API allowance for this hour; retry after 08:00 UTC.",
      storeErrorAsPrecomputation: false,
    });
    expect(await deps.cache.meta('expression["project = A","a > b"]')).toBe(null);
  });
  it('defers the call when preparing the budget takes the whole function time', async () => {
    const deps = withBudget(fnDeps(expression([])), { count: 10 });
    deps.jira.approximateCount = never;
    deps.sleep = async () => {};
    expect((await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).error).toEqual('Computing, retry in a minute');
    expect(deps.pushed).toHaveLength(1);
  });
  it('computes with an unknown size when the count fails', async () => {
    const deps = withBudget(fnDeps(expression([30])));
    deps.jira.approximateCount = async () => { throw Object.assign(new Error('busy'), { name: 'JiraError', status: 503 }); };
    expect(await handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV)).toEqual({ jql: 'id in (3)' });
  });
  it('answers that the allowance is used when what the function lane has left equals the group limit and runs out', async () => {
    const deps = withBudget(fnDeps(expression([2000, 1])), { at: Date.parse('2026-10-05T07:40:00Z') });
    await deps.points.add('refresh', 8000);
    expect(await quiet(() => handleFunction(deps, 'expression', payload('project = A', 'a > b'), DEV))).toEqual({
      error: "ArtUp Query has used this site's Jira API allowance for this hour; retry after 08:00 UTC.",
      storeErrorAsPrecomputation: false,
    });
  });
});

describe('precomputation list after a function call', () => {
  const listing = () => {
    const added = [];
    const marked = [];
    return { added, marked, pcList: { add: async (r) => { added.push(r); }, markDirty: async () => { marked.push(1); } } };
  };
  const withId = (body) => ({ ...body, precomputationId: 'pc1' });
  it('adds the precomputation Jira creates from a computed answer to the cached list', async () => {
    const l = listing();
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) }, { pcList: l.pcList });
    await handleFunction(deps, 'parentsOf', withId(notIn('q')), DEV);
    expect(l.added).toEqual([{ id: 'pc1', functionName: 'parentsOf', arguments: ['q'], operator: 'not in', hasValue: true, errorKind: null }]);
  });
  it('adds the precomputation of an answer from the cache', async () => {
    const l = listing();
    const deps = fnDeps({}, { pcList: l.pcList });
    await deps.cache.write(SUBTASK_GROUP, jobEntry(['3']));
    await handleFunction(deps, 'subtasksOf', withId(payload('project = A')), DEV);
    expect(l.added.map((r) => r.id)).toEqual(['pc1']);
  });
  it('adds a stored error as an error of its kind', async () => {
    const l = listing();
    const deps = withBudget(fnDeps({ expression: vi.fn() }, { pcList: l.pcList }), { count: 4000 });
    await handleFunction(deps, 'expression', withId(payload('project = A', 'a > b')), DEV);
    expect(l.added.map((r) => [r.hasValue, r.errorKind])).toEqual([[false, 'tooExpensive']]);
  });
  it('adds nothing for an answer Jira does not store', async () => {
    const l = listing();
    const deps = fnDeps({ subtasksOf: never }, { pcList: l.pcList, sleep: async () => {} });
    await handleFunction(deps, 'subtasksOf', withId(payload('project = A')), DEV);
    expect([l.added, l.marked]).toEqual([[], []]);
  });
  it('marks the cached list stale when the record cannot be added', async () => {
    const l = listing();
    l.pcList.add = async () => { throw new Error('kvs down'); };
    const deps = fnDeps({ parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) }, { pcList: l.pcList });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleFunction(deps, 'parentsOf', withId(payload('q')), DEV);
    error.mockRestore();
    expect(l.marked).toEqual([1]);
  });
});

describe('cost of a group', () => {
  it('takes a lower bound newer than the last finished run, and the finished run over an older one', async () => {
    const deps = withBudget(fnDeps({}));
    await deps.state.addJob({ key: 'k', functionName: 'parentsOf', userArgs: ['q'], at: 1, pts: 700, floor: true, floorAt: 50 });
    const newer = await costOf(deps, 'parentsOf', { subquery: 'q' }, 'k', { pts: 300, startedAt: 10 });
    const older = await costOf(deps, 'parentsOf', { subquery: 'q' }, 'k', { pts: 300, startedAt: 100 });
    expect([newer.points, older.points]).toEqual([700, 300]);
  });
});
