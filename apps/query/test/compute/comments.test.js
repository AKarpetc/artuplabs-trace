import { describe, expect, it, vi } from 'vitest';
import { createCommentCompute } from '../../src/compute/comments.js';

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86400000;
const A = '5b10ac8d82e05b22cc7d4ef5';
const B = '5b10ac8d82e05b22cc7d4ef6';
const C = '5b10ac8d82e05b22cc7d4ef7';

/**
 * Visible comments of a small index: issue 10 has A then B, issue 11 has B; restricted comments are not in this list because the
 * repo never returns them, which the repo tests assert in SQL.
 */
const VISIBLE = [
  { issueId: '10', projectId: '1', author: A, createdAt: NOW - DAY, id: 1 },
  { issueId: '11', projectId: '2', author: B, createdAt: NOW - 10 * DAY, id: 2 },
  { issueId: '10', projectId: '1', author: B, createdAt: NOW - 3600000, id: 3 },
];
const COUNTS = { atLeast: { 1: ['10', '11'], 2: ['10'] }, exactly: { 1: ['11'], 2: ['10'] }, more: { 1: ['10'] } };

function fakeRepo() {
  const pass = (m, f) => (f.projectId === undefined || m.projectId === f.projectId) && (f.after === undefined || m.createdAt > f.after)
    && (f.before === undefined || m.createdAt < f.before) && (!f.authors || f.authors.includes(m.author));
  const latest = () => [...new Map([...VISIBLE].sort((x, y) => x.createdAt - y.createdAt || x.id - y.id).map((m) => [m.issueId, m])).values()];
  return {
    issuesWithComments: vi.fn(async (f = {}) => [...new Set((f.last ? latest() : VISIBLE).filter((m) => pass(m, f)).map((m) => m.issueId))].sort()),
    commentProjects: vi.fn(async () => ['1', '2']),
    issuesWithCommentCount: vi.fn(async ({ op, n }) => COUNTS[op]?.[n] ?? []),
    issuesWithAttachments: vi.fn(async (f = {}) => ((!f.ext || f.ext === 'pdf') && pass({ author: A, createdAt: NOW - 1000 }, f) ? ['12'] : [])),
  };
}

function make(extra = {}) {
  const repo = fakeRepo();
  const jira = {
    userIds: async (q) => (q === 'Ann' ? [A] : []),
    groupMemberIds: vi.fn(async () => [B]),
    roleMemberIds: vi.fn(async (projectId) => (projectId === '1' ? [A] : [C])),
    ...extra,
  };
  return { compute: createCommentCompute({ jira, repo, now: () => NOW }), repo, jira };
}
const compute = (extra) => make(extra).compute;

describe('comment compute', () => {
  it('commented resolves a user name to account ids and asks SQL for those authors in the window', async () => {
    const { compute: c, repo } = make();
    expect(await c.commented({ clauses: 'by Ann after -2d' }, {})).toEqual({ ids: ['10'], field: 'id', watch: null });
    expect(repo.issuesWithComments).toHaveBeenCalledWith({ last: false, after: NOW - 2 * DAY, before: undefined, authors: [A] });
  });
  it('commented reads the day of an on clause as a window', async () => {
    const { compute: c, repo } = make();
    await c.commented({ clauses: 'on 2026-10-07' }, {});
    expect(repo.issuesWithComments).toHaveBeenCalledWith({ last: false, after: Date.UTC(2026, 9, 7) - 1, before: Date.UTC(2026, 9, 8), authors: undefined });
  });
  it('commented without clauses means any visible comment', async () => {
    expect((await compute().commented({}, {})).ids).toEqual(['10', '11']);
  });
  it('intersects by with the members of a group before asking SQL', async () => {
    const { compute: c, repo } = make();
    expect((await c.commented({ clauses: `by ${A} inGroup devs` }, {})).ids).toEqual([]);
    expect(repo.issuesWithComments).not.toHaveBeenCalled();
    expect((await c.commented({ clauses: 'inGroup devs' }, {})).ids).toEqual(['10', '11']);
    expect(repo.issuesWithComments).toHaveBeenLastCalledWith({ last: false, after: undefined, before: undefined, authors: [B] });
  });
  it('asks the role members of each project with comments by its id, once per project, with one group cache for the call', async () => {
    const { compute: c, jira, repo } = make();
    expect((await c.commented({ clauses: 'inRole Developers' }, {})).ids).toEqual(['10']);
    expect(jira.roleMemberIds.mock.calls.map(([p, r]) => [p, r])).toEqual([['1', 'Developers'], ['2', 'Developers']]);
    expect(jira.roleMemberIds.mock.calls[0][2].groups).toBe(jira.roleMemberIds.mock.calls[1][2].groups);
    expect(repo.issuesWithComments.mock.calls.map(([f]) => [f.projectId, f.authors])).toEqual([['1', [A]], ['2', [C]]]);
  });
  it('lastComment checks only the latest visible comment of each issue, in SQL', async () => {
    const { compute: c, repo } = make();
    expect((await c.lastComment({ clauses: 'inGroup devs' }, {})).ids).toEqual(['10', '11']);
    expect((await c.lastComment({ clauses: `by ${A}` }, {})).ids).toEqual([]);
    expect(repo.issuesWithComments.mock.calls.every(([f]) => f.last === true)).toBe(true);
  });
  it('names a user nobody matches, without the name in the log', async () => {
    expect(await compute().commented({ clauses: 'by Nobody' }, {})).toEqual({ error: 'commented: User "Nobody" not found', log: 'User not found' });
  });
  it('names a group Jira does not know', async () => {
    const missing = Object.assign(new Error('no group'), { name: 'JiraError', status: 404 });
    const c = compute({ groupMemberIds: async () => { throw missing; } });
    expect(await c.commented({ clauses: 'inGroup ghosts' }, {})).toEqual({ error: 'commented: Group "ghosts" not found', log: 'Group not found' });
  });
  it('lets other Jira failures of a group lookup through', async () => {
    const failed = Object.assign(new Error('boom'), { name: 'JiraError', status: 500 });
    await expect(compute({ groupMemberIds: async () => { throw failed; } }).commented({ clauses: 'inGroup devs' }, {})).rejects.toBe(failed);
  });
  it('names a role that no project with comments has', async () => {
    expect(await compute({ roleMemberIds: async () => null }).commented({ clauses: 'inRole Ghosts' }, {})).toEqual({ error: 'commented: Role "Ghosts" not found', log: 'Role not found' });
  });
  it('passes clause errors through with the function name and logs them without the text', async () => {
    expect(await compute().commented({ clauses: 'text x' }, {})).toEqual({ error: 'commented: Unknown clause "text"; use by, after, before, on, inRole, inGroup', log: 'Invalid conditions' });
    expect(await compute().fileAttached({ clauses: 'after someday' }, {})).toEqual({ error: 'fileAttached: Invalid date "someday"', log: 'Invalid conditions' });
  });
  it('answers comment visibility clauses as not available yet', async () => {
    expect(await compute().commented({ clauses: 'roleLevel Administrators' }, {})).toEqual({ error: 'commented: Clause "roleLevel" is not available yet', log: 'Invalid conditions' });
    expect(await compute().lastComment({ clauses: 'groupLevel staff' }, {})).toEqual({ error: 'lastComment: Clause "groupLevel" is not available yet', log: 'Invalid conditions' });
  });
  it('hasComments without a count means any visible comment', async () => {
    const { compute: c, repo } = make();
    expect((await c.hasComments({}, {})).ids).toEqual(['10', '11']);
    expect(repo.issuesWithCommentCount).toHaveBeenCalledWith({ op: 'atLeast', n: 1 });
  });
  it('hasComments counts exactly n and more than n in SQL', async () => {
    expect((await compute().hasComments({ count: { op: 'exactly', n: 1 } }, {})).ids).toEqual(['11']);
    expect((await compute().hasComments({ count: { op: 'more', n: 1 } }, {})).ids).toEqual(['10']);
  });
  it('hasComments fewer than n is every issue outside the issues with at least n comments, so issues without comments match', async () => {
    const { compute: c, repo } = make();
    expect(await c.hasComments({ count: { op: 'fewer', n: 3 } }, {})).toEqual({ native: 'NOT (issue in hasComments("+2"))' });
    expect(await c.hasComments({ count: { op: 'fewer', n: 1 } }, {})).toEqual({ native: 'NOT (issue in hasComments())' });
    expect(repo.issuesWithCommentCount).not.toHaveBeenCalled();
  });
  it('hasAttachments without an extension is native JQL, with one it asks SQL', async () => {
    const { compute: c, repo } = make();
    expect(await c.hasAttachments({}, {})).toEqual({ native: 'attachments is not EMPTY' });
    expect((await c.hasAttachments({ extension: 'pdf' }, {})).ids).toEqual(['12']);
    expect(repo.issuesWithAttachments).toHaveBeenCalledWith({ ext: 'pdf' });
  });
  it('fileAttached applies attachment clauses in SQL', async () => {
    const { compute: c, repo } = make();
    expect((await c.fileAttached({ clauses: 'ext pdf after -1d by Ann' }, {})).ids).toEqual(['12']);
    expect(repo.issuesWithAttachments).toHaveBeenCalledWith({ ext: 'pdf', after: NOW - DAY, before: undefined, authors: [A] });
    expect((await c.fileAttached({ clauses: 'ext png' }, {})).ids).toEqual([]);
  });
});
