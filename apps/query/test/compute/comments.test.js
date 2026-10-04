import { describe, expect, it, vi } from 'vitest';
import { createCommentCompute } from '../../src/compute/comments.js';

const NOW = Date.UTC(2026, 9, 8);
const meta = (id, issueId, author, createdAt, extra = {}) => ({ id, issueId, projectId: '1', author, createdAt, visType: null, visValue: null, ext: '', ...extra });
const A = '5b10ac8d82e05b22cc7d4ef5';
const B = '5b10ac8d82e05b22cc7d4ef6';
const METAS = [meta('1', '10', A, NOW - 86400000), meta('2', '11', B, NOW - 10 * 86400000), meta('3', '10', B, NOW - 3600000)];
const COUNTS = { atLeast: { 1: ['10', '11'], 2: ['10'] }, exactly: { 1: ['11'], 2: ['10'] }, more: { 1: ['10'] } };

function make(extra = {}, { excluded = [] } = {}) {
  const repo = {
    commentMetas: vi.fn(async () => METAS),
    lastCommentMetas: async () => [METAS[1], METAS[2]],
    issuesWithCommentCount: vi.fn(async ({ op, n }) => COUNTS[op]?.[n] ?? []),
    attachmentMetas: async ({ ext }) => [meta('9', '12', A, NOW - 1000, { ext: 'pdf' })].filter((m) => !ext || m.ext === ext),
  };
  const jira = {
    userIds: async (q) => (q === 'Ann' ? [A] : []),
    groupMemberIds: async () => [B],
    roleMemberIds: vi.fn(async () => [A]),
    ...extra,
  };
  const state = { excluded: async () => excluded };
  return { compute: createCommentCompute({ jira, repo, state, now: () => NOW }), repo, jira };
}
const compute = (extra, options) => make(extra, options).compute;

describe('comment compute', () => {
  it('commented resolves a user name to account ids', async () => {
    expect(await compute().commented({ clauses: 'by Ann after -2d' }, {})).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('commented reads only the comments of the named authors inside the date window', async () => {
    const { compute: c, repo } = make();
    await c.commented({ clauses: 'by Ann after -2d before -1h' }, {});
    expect(repo.commentMetas).toHaveBeenCalledWith({ after: NOW - 2 * 86400000, before: NOW - 3600000, authors: [A] });
  });
  it('commented reads the day of an on clause', async () => {
    const { compute: c, repo } = make();
    await c.commented({ clauses: 'on 2026-10-07' }, {});
    expect(repo.commentMetas).toHaveBeenCalledWith({ after: Date.UTC(2026, 9, 7) - 1, before: Date.UTC(2026, 9, 8), authors: undefined });
  });
  it('commented without clauses means any comment', async () => {
    expect((await compute().commented({}, {})).ids).toEqual(['10', '11']);
  });
  it('lastComment checks only the latest comment of each issue', async () => {
    expect((await compute().lastComment({ clauses: 'inGroup devs' }, {})).ids).toEqual(['10', '11']);
    expect((await compute().lastComment({ clauses: `by ${A}` }, {})).ids).toEqual([]);
  });
  it('asks the role members of each project by its id', async () => {
    const { compute: c, jira } = make();
    expect((await c.commented({ clauses: 'inRole Developers' }, {})).ids).toEqual(['10']);
    expect(jira.roleMemberIds.mock.calls).toEqual([['1', 'Developers']]);
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
  it('names a role that no project of the comments has', async () => {
    expect(await compute({ roleMemberIds: async () => null }).commented({ clauses: 'inRole Ghosts' }, {})).toEqual({ error: 'commented: Role "Ghosts" not found', log: 'Role not found' });
  });
  it('passes clause errors through with the function name and logs them without the text', async () => {
    expect(await compute().commented({ clauses: 'text x' }, {})).toEqual({
      error: 'commented: Unknown clause "text"; use by, after, before, on, inRole, inGroup, roleLevel, groupLevel',
      log: 'Invalid conditions',
    });
    expect(await compute().fileAttached({ clauses: 'after someday' }, {})).toEqual({ error: 'fileAttached: Invalid date "someday"', log: 'Invalid conditions' });
  });
  it('hasComments without a count means any comment', async () => {
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
    expect(await c.hasComments({ count: { op: 'fewer', n: 3 } }, {})).toEqual({ native: 'issue not in hasComments("+2")' });
    expect(await c.hasComments({ count: { op: 'fewer', n: 1 } }, {})).toEqual({ native: 'issue not in hasComments()' });
    expect(repo.issuesWithCommentCount).not.toHaveBeenCalled();
  });
  it('hasComments fewer than n leaves out the projects outside the index', async () => {
    expect(await compute({}, { excluded: ['OPS', 'HR'] }).hasComments({ count: { op: 'fewer', n: 2 } }, {})).toEqual({ native: 'issue not in hasComments("+1") AND project not in ("OPS", "HR")' });
  });
  it('hasAttachments without an extension is native JQL, with one it reads the index', async () => {
    expect(await compute().hasAttachments({}, {})).toEqual({ native: 'attachments is not EMPTY' });
    expect((await compute().hasAttachments({ extension: 'pdf' }, {})).ids).toEqual(['12']);
  });
  it('fileAttached applies attachment clauses', async () => {
    expect((await compute().fileAttached({ clauses: 'ext pdf after -1d' }, {})).ids).toEqual(['12']);
    expect((await compute().fileAttached({ clauses: 'ext png' }, {})).ids).toEqual([]);
  });
});
