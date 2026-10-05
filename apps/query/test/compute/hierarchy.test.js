import { describe, expect, it } from 'vitest';
import { fakeJira, issue } from '../fakeJira.js';
import { createHierarchyCompute } from '../../src/compute/hierarchy.js';

const ISSUES = [
  issue(1, { level: 1 }),
  issue(10, { parent: [1, 1], subtasks: [100, 101] }),
  issue(11, { parent: [1, 1] }),
  issue(100, { level: -1, parent: [10, 0] }),
  issue(101, { level: -1, parent: [10, 0] }),
  issue(12),
];
const ctx = { reconcile: [] };
const make = (searches) => createHierarchyCompute({ jira: fakeJira({ issues: ISSUES, searches }) });

describe('hierarchy compute', () => {
  it('subtasksOf keeps the inner issues as parents under the subtask filter and watches them in id order', async () => {
    expect(await make({ S: ['11', '10'] }).subtasksOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['10', '11'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: ['10', '11'] });
  });
  it('subtasksOf keeps only parents with subtasks above 1 000 inner issues', async () => {
    const extra = Array.from({ length: 1001 }, (_, i) => issue(5000 + i));
    const jira = fakeJira({ issues: [...ISSUES, ...extra], searches: { S: [...extra.map((x) => x.id), '10', '11', '12'] } });
    const result = await createHierarchyCompute({ jira }).subtasksOf({ subquery: 'S' }, ctx);
    expect(result.ids).toEqual(['10']);
  });
  it('subtasksOf reads the subtasks within the search of its subquery, with no bulkfetch at any size', async () => {
    const extra = Array.from({ length: 1001 }, (_, i) => issue(5000 + i));
    const jira = fakeJira({ issues: [...ISSUES, ...extra], searches: { S: [...extra.map((x) => x.id), '10'], T: ['11', '10'] } });
    await createHierarchyCompute({ jira }).subtasksOf({ subquery: 'S' }, ctx);
    await createHierarchyCompute({ jira }).subtasksOf({ subquery: 'T' }, ctx);
    expect(jira.calls).toEqual([['search', 'S', [], ['subtasks']], ['search', 'T', [], ['subtasks']]]);
  });
  it('reads the fields of the subquery within its search for parentsOf, issuesInEpics and hasSubtasks', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['100', '11', '1'] } });
    const compute = createHierarchyCompute({ jira });
    await compute.parentsOf({ subquery: 'S' }, ctx);
    await compute.issuesInEpics({ subquery: 'S' }, ctx);
    await compute.hasSubtasks({}, ctx);
    expect(jira.calls.map(([kind, , , fields]) => [kind, fields])).toEqual([['search', ['parent', 'issuetype']], ['search', ['issuetype']], ['search', ['parent']]]);
  });
  it('epicsOf fetches only the parents its subquery search did not return', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['100', '12'] } });
    await createHierarchyCompute({ jira }).epicsOf({ subquery: 'S' }, ctx);
    expect(jira.calls.map(([kind, what]) => [kind, what])).toEqual([['search', 'S'], ['bulk', 1]]);
  });
  it('childIssuesOf reads the parent of each child within the search for the children', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['1'] } });
    await createHierarchyCompute({ jira }).childIssuesOf({ subquery: 'S' }, ctx);
    expect(jira.calls.filter(([kind]) => kind === 'bulk')).toEqual([]);
  });
  it('parentsOf returns direct parents of any level', async () => {
    expect(await make({ S: ['100', '11', '12'] }).parentsOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['1', '10'], field: 'id', watch: ['11', '12', '100'] });
  });
  it('epicsOf loads the story above a subtask to reach the epic', async () => {
    const result = await make({ S: ['100', '12'] }).epicsOf({ subquery: 'S' }, ctx);
    expect(result).toEqual({ ids: ['1'], field: 'id', watch: ['1', '10', '12', '100'] });
  });
  it('issuesInEpics keeps the epics of the subquery as parents', async () => {
    expect(await make({ S: ['10', '1'] }).issuesInEpics({ subquery: 'S' }, ctx)).toEqual({ ids: ['1'], field: 'parent', watch: ['1', '10'] });
  });
  it('childIssuesOf walks all levels by default and stops at the depth', async () => {
    const compute = make({ S: ['1'] });
    expect(await compute.childIssuesOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['1', '10'], field: 'parent', watch: ['1', '10', '11', '100', '101'] });
    expect(await compute.childIssuesOf({ subquery: 'S', depth: 1 }, ctx)).toEqual({ ids: ['1'], field: 'parent', watch: ['1', '10', '11'] });
  });
  it('hasSubtasks returns the parents of all subtasks', async () => {
    expect(await make({}).hasSubtasks({}, ctx)).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('passes touched issues to the inner search for read-after-write', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['10'] } });
    await createHierarchyCompute({ jira }).parentsOf({ subquery: 'S' }, { reconcile: ['10'] });
    expect(jira.calls[0].slice(0, 3)).toEqual(['search', 'S', ['10']]);
  });
});
