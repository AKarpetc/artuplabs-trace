import { describe, expect, it } from 'vitest';
import { entryFromContext, entryLabel, jqlForEntry, withOrder } from '../../src/core/entry.js';

describe('entryFromContext', () => {
  it('takes the JQL of the issue navigator', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT' })).toEqual({ kind: 'jql', jql: 'project = RPT' });
  });
  it('builds a key list when the navigator only passes issue keys', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', issueKeys: ['RPT-1', 'bad key', 'rpt-2'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)' });
  });
  it('lets the selected issues win over the JQL', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', issueKeys: ['RPT-1', 'rpt-2'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)' });
  });
  it('falls back to the JQL when no selected key is valid', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT', issueKeys: ['bad key'] })).toEqual({ kind: 'jql', jql: 'project = RPT' });
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
});
