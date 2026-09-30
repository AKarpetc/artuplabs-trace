import { describe, expect, it } from 'vitest';
import { contextShape, entryFromContext, entryLabel, entryProject, jqlForEntry, withOrder } from '../../src/core/entry.js';

describe('entryFromContext', () => {
  it('takes the JQL of the issue navigator', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT' })).toEqual({ kind: 'jql', jql: 'project = RPT' });
  });
  it('builds a key list when the navigator only passes issue keys', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', issueKeys: ['RPT-1', 'bad key', 'rpt-2'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)', selected: true });
  });
  it('lets the selected issues win over the JQL', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', issueKeys: ['RPT-1', 'rpt-2'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)', selected: true });
  });
  it('falls back to the JQL when no selected key is valid', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', issueKeys: ['bad key'] })).toEqual({ kind: 'jql', jql: 'project = RPT' });
  });
  it('de-duplicates selected keys', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', issueKeys: ['RPT-1', 'rpt-1', 'RPT-2'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)', selected: true });
  });
  it('ignores non-array keys without throwing', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', issueKeys: 'RPT-1' })).toEqual({ kind: 'jql', jql: 'project = RPT' });
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', issues: { length: 1 } })).toEqual({ kind: 'none' });
  });
  it.each([
    ['issues[].key', { issues: [{ key: 'RPT-1' }, { key: 'RPT-2' }] }],
    ['selectedIssueKeys', { selectedIssueKeys: ['RPT-1', 'RPT-2'] }],
    ['selectedIssues[].key', { selectedIssues: [{ id: '10001', key: 'RPT-1' }, { id: '10002', key: 'RPT-2' }] }],
    ['selectedIssues as keys', { selectedIssues: ['RPT-1', 'RPT-2'] }],
  ])('reads selected keys from %s', (_name, fields) => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', ...fields })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)', selected: true });
  });
  it.each([
    ['issueIds', { issueIds: ['10001', 10002] }],
    ['selectedIssueIds', { selectedIssueIds: ['10001', '10002'] }],
    ['issues[].id', { issues: [{ id: '10001' }, { id: 10002 }] }],
    ['selectedIssues[].id', { selectedIssues: [{ id: '10001' }, { id: '10002' }] }],
  ])('builds an id list from %s when no key is passed', (_name, fields) => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', ...fields })).toEqual({ kind: 'jql', jql: 'id in (10001, 10002)', selected: true });
  });
  it('keeps the saved filter id with the JQL', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', filterId: '10034' })).toEqual({ kind: 'jql', jql: 'project = RPT', filterId: 10034 });
  });
  it('queries the saved filter when the navigator passes no JQL', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', filterId: 10034 })).toEqual({ kind: 'jql', jql: 'filter = 10034', filterId: 10034 });
  });
  it('drops the filter id when issues are selected and ignores system filters', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', filterId: '10034', issueKeys: ['RPT-1'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1)', selected: true });
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'assignee = currentUser()', filterId: '-1' })).toEqual({ kind: 'jql', jql: 'assignee = currentUser()' });
  });
  it('rejects ids that are not plain positive integers', () => {
    const ids = ['1e21', true, [7], 1e21, '7.5', '-3', ' 7'];
    expect(ids.map((id) => entryFromContext({ type: 'jira:boardAction', board: { id } }))).toEqual(ids.map(() => ({ kind: 'none' })));
  });
  it('reads board and backlog ids', () => {
    expect(entryFromContext({ type: 'jira:boardAction', board: { id: '7' } })).toEqual({ kind: 'board', boardId: 7 });
    expect(entryFromContext({ type: 'jira:backlogAction', board: { id: 7 } })).toEqual({ kind: 'board', boardId: 7 });
  });
  it('carries the project key of a board', () => {
    expect(entryFromContext({ type: 'jira:boardAction', board: { id: 7 }, project: { key: 'RPT' } })).toEqual({ kind: 'board', boardId: 7, projectKey: 'RPT' });
  });
  it('carries the project key of a sprint', () => {
    expect(entryFromContext({ type: 'jira:sprintAction', sprint: { id: 12 }, board: { id: 7 }, project: { key: 'RPT' } })).toEqual({ kind: 'sprint', sprintId: 12, boardId: 7, projectKey: 'RPT' });
  });
  it('carries the project key of an issue', () => {
    expect(entryFromContext({ type: 'jira:issueAction', issue: { key: 'RPT-9' }, project: { key: 'RPT' } })).toEqual({ kind: 'issue', key: 'RPT-9', projectKey: 'RPT' });
  });
  it('ignores a malformed project key', () => {
    expect(entryFromContext({ type: 'jira:issueAction', issue: { key: 'RPT-9' }, project: { key: 'x" OR 1=1' } })).toEqual({ kind: 'issue', key: 'RPT-9' });
  });
  it('reads the sprint id', () => {
    expect(entryFromContext({ type: 'jira:sprintAction', sprint: { id: 12 }, board: { id: 7 } })).toEqual({ kind: 'sprint', sprintId: 12, boardId: 7 });
  });
  it('reads the issue key', () => {
    expect(entryFromContext({ type: 'jira:issueAction', issue: { key: 'RPT-9', id: '10009' } })).toEqual({ kind: 'issue', key: 'RPT-9' });
  });
  it('returns none for the global page and for malformed input', () => {
    expect(entryFromContext({ type: 'jira:globalPage' })).toEqual({ kind: 'none' });
    expect(entryFromContext({ type: 'jira:issueAction', issue: { key: 'x" OR 1=1' } })).toEqual({ kind: 'none' });
    expect(entryFromContext(undefined)).toEqual({ kind: 'none' });
  });
});

describe('jqlForEntry', () => {
  it('quotes issue keys and orders sprints by rank', () => {
    expect(jqlForEntry({ kind: 'issue', key: 'RPT-9' })).toBe('key = "RPT-9"');
    expect(jqlForEntry({ kind: 'sprint', sprintId: 12 })).toBe('sprint = 12 ORDER BY Rank ASC');
    expect(jqlForEntry({ kind: 'board', boardId: 7 })).toBeNull();
  });
});

describe('withOrder', () => {
  it('appends an order only when the JQL has none', () => {
    expect(withOrder('project = RPT')).toBe('project = RPT ORDER BY key ASC');
    expect(withOrder('project = RPT order by created DESC')).toBe('project = RPT order by created DESC');
  });
});

describe('entryLabel', () => {
  it('names entries for file names', () => {
    expect([entryLabel({ kind: 'issue', key: 'RPT-9' }), entryLabel({ kind: 'sprint', sprintId: 12 }), entryLabel({ kind: 'board', boardId: 7 }), entryLabel({ kind: 'jql', jql: 'x', label: 'My filter' }), entryLabel({ kind: 'jql', jql: 'x' })]).toEqual(['RPT-9', 'sprint-12', 'board-7', 'My filter', '']);
  });
  it('names a saved filter by its id until its name is known', () => {
    expect(entryLabel({ kind: 'jql', jql: 'x', filterId: 10034 })).toBe('filter-10034');
    expect(entryLabel({ kind: 'jql', jql: 'x', filterId: 10034, label: 'Filter for RPT board' })).toBe('Filter for RPT board');
  });
});

describe('entryProject', () => {
  it.each([
    [{ kind: 'board', boardId: 7, projectKey: 'RPT' }, 'RPT'],
    [{ kind: 'jql', jql: 'project = RPT' }, 'RPT'],
    [{ kind: 'jql', jql: 'project = "RPT" AND status = Done ORDER BY key' }, 'RPT'],
    [{ kind: 'jql', jql: 'key in (RPT-1, RPT-2)', selected: true }, 'RPT'],
    [{ kind: 'jql', jql: 'key in (RPT-1, ABC-2)', selected: true }, ''],
    [{ kind: 'jql', jql: 'project = RPT OR project = ABC' }, ''],
    [{ kind: 'jql', jql: 'project = RPT OR assignee = currentUser()' }, ''],
    [{ kind: 'jql', jql: 'project in (RPT, ABC)' }, ''],
    [{ kind: 'jql', jql: 'project = "My Reports"' }, ''],
    [{ kind: 'jql', jql: 'assignee = currentUser()' }, ''],
    [{ kind: 'issue', key: 'RPT-9' }, 'RPT'],
    [{ kind: 'none' }, ''],
  ])('%j gives %s', (entry, expected) => {
    expect(entryProject(entry)).toBe(expected);
  });
});

describe('contextShape', () => {
  it('names the fields with their types, never their values', () => {
    const shape = contextShape({
      type: 'jira:issueNavigatorAction', jql: 'project = SECRET', filterId: '10034', issueKeys: [], issues: [{ id: '1', key: 'SECRET-1' }], project: { key: 'SECRET' }, count: 3, flag: null,
    });
    expect(shape).toBe('type:string jql:string filterId:string issueKeys:array(0) issues:array(1)[id,key] project:object{key} count:number flag:null');
    expect(shape).not.toContain('SECRET');
  });
  it('describes a missing extension', () => {
    expect(contextShape(undefined)).toBe('(no extension)');
  });
});
