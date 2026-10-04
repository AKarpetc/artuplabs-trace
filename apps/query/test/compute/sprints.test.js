import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { fakeJira } from '../fakeJira.js';
import { createSprintCompute } from '../../src/compute/sprints.js';
import { parseArgs } from '../../src/core/args.js';

const SPRINTS = [
  { id: 1, name: 'S1', state: 'closed', startDate: '2026-01-01T00:00:00Z', completeDate: '2026-01-14T00:00:00Z' },
  { id: 2, name: 'S2', state: 'active', startDate: '2026-01-15T00:00:00Z' },
];
const T = (d) => Date.UTC(2026, 0, d);
const EVENTS = { 1: [{ issueId: '10', sprintId: '1', kind: 'added', at: T(3), changeId: '1' }, { issueId: '11', sprintId: '1', kind: 'removed', at: T(4), changeId: '2' }], 2: [{ issueId: '12', sprintId: '2', kind: 'added', at: T(16), changeId: '3' }] };

function make({ searches = {}, issues = {} } = {}) {
  const jira = fakeJira({ boards: [{ id: 7, name: 'DEMO board', location: { projectKey: 'DEMO' } }], sprints: { 7: SPRINTS }, searches: { 'sprint = 1': ['10', '13'], 'sprint = 2': ['12'], ...searches } });
  jira.bulkIssues = async (ids) => ids.map((id) => issues[id] ?? { id, fields: { status: { statusCategory: { key: id === '13' ? 'new' : 'done' } } } });
  const repo = { sprintEventsOf: async (id) => EVENTS[id] ?? [], statusEventsOf: async () => new Map() };
  const state = createState({ kvs: createFakeKvs() });
  return { compute: createSprintCompute({ jira, repo, state, now: () => T(20) }), state, jira };
}

describe('sprint compute', () => {
  it('addedAfterSprintStart reads a named sprint', async () => {
    expect(await make().compute.addedAfterSprintStart({ board: 'DEMO board', sprint: 'S1' })).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('addedAfterSprintStart without a sprint uses the active one', async () => {
    expect((await make().compute.addedAfterSprintStart({ board: '7' })).ids).toEqual(['12']);
  });
  it('removedAfterSprintStart without a sprint uses the active one too', async () => {
    expect((await make().compute.removedAfterSprintStart({ board: '7' })).ids).toEqual([]);
  });
  it('requires the sprint of completeInSprint and incompleteInSprint', () => {
    expect([parseArgs('completeInSprint', ['DEMO board']).error, parseArgs('incompleteInSprint', ['DEMO board']).error].every(Boolean)).toBe(true);
    expect(parseArgs('addedAfterSprintStart', ['DEMO board']).error).toBeUndefined();
  });
  it('removedAfterSprintStart lists removals not undone', async () => {
    expect((await make().compute.removedAfterSprintStart({ board: 'DEMO board', sprint: '1' })).ids).toEqual(['11']);
  });
  it('complete and incomplete split the members at the close', async () => {
    const { compute } = make();
    expect((await compute.completeInSprint({ board: 'DEMO board', sprint: 'S1' })).ids).toEqual(['10']);
    expect((await compute.incompleteInSprint({ board: 'DEMO board', sprint: 'S1' })).ids).toEqual(['13']);
  });
  it('counts an issue the closed sprint kept in its Sprint field, and one of unknown status, as not done', async () => {
    const { compute } = make({ searches: { 'sprint = 1': ['10', '13', '14'] }, issues: { 14: { id: '14', fields: {} } } });
    expect((await compute.incompleteInSprint({ board: 'DEMO board', sprint: 'S1' })).ids).toEqual(['13', '14']);
  });
  it('counts an issue that bulk fetch no longer returns as not done', async () => {
    const { compute, jira } = make();
    jira.bulkIssues = async () => [];
    expect((await compute.incompleteInSprint({ board: 'DEMO board', sprint: 'S1' })).ids).toEqual(['10', '13']);
  });
  it('counts an issue created inside the running sprint as added at its creation time', async () => {
    const { compute } = make({ searches: { 'sprint = 2': ['12', '15', '16'] }, issues: { 15: { id: '15', fields: { created: '2026-01-17T09:00:00.000+0000' } }, 16: { id: '16', fields: { created: '2026-01-10T09:00:00.000+0000' } } } });
    expect((await compute.addedAfterSprintStart({ board: 'DEMO board' })).ids).toEqual(['12', '15']);
  });
  it('asks the creation time only of issues that joined the sprint without a sprint change', async () => {
    const { compute, jira } = make({ searches: { 'sprint = 2': ['12'] } });
    const asked = [];
    jira.bulkIssues = async (ids, fields) => {
      asked.push([ids, fields]);
      return [];
    };
    await compute.addedAfterSprintStart({ board: 'DEMO board' });
    expect(asked).toEqual([]);
  });
  it('explains a board without an active sprint and a board of an excluded project', async () => {
    const { compute, state } = make();
    const jira2 = fakeJira({ boards: [{ id: 8, name: 'B', location: { projectKey: 'B' } }], sprints: { 8: [] } });
    const noActive = createSprintCompute({ jira: jira2, repo: { sprintEventsOf: async () => [] }, state, now: () => 0 });
    expect(await noActive.addedAfterSprintStart({ board: 'B' })).toEqual({ error: 'Active sprint of board "B" not found', log: 'Active sprint of board not found' });
    await state.setExcluded(['DEMO']);
    expect(await compute.addedAfterSprintStart({ board: 'DEMO board', sprint: 'S1' })).toEqual({ error: 'Project DEMO is excluded from the ArtUp Query index', log: 'Project is excluded' });
  });
  it('passes on an unknown board or sprint with a log line free of the value', async () => {
    const { compute } = make();
    expect(await compute.completeInSprint({ board: 'Nope', sprint: 'S1' })).toEqual({ error: 'Board "Nope" not found', log: 'Board not found' });
    expect(await compute.removedAfterSprintStart({ board: 'DEMO board', sprint: 'S9' })).toEqual({ error: 'Sprint "S9" not found', log: 'Sprint not found' });
  });
  it('reads a board without a location', async () => {
    const jira = fakeJira({ boards: [{ id: 9, name: 'Loose' }], sprints: { 9: SPRINTS }, searches: { 'sprint = 1': [] } });
    jira.bulkIssues = async () => [];
    const compute = createSprintCompute({ jira, repo: { sprintEventsOf: async (id) => EVENTS[id] ?? [] }, state: createState({ kvs: createFakeKvs() }), now: () => T(20) });
    expect((await compute.addedAfterSprintStart({ board: 'Loose', sprint: 'S1' })).ids).toEqual(['10']);
  });
});
