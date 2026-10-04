import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ prepared: [] }));
vi.mock('@forge/sql', () => ({
  sql: {
    prepare(query) {
      const statement = { query, params: [] };
      h.prepared.push(statement);
      return {
        bindParams(...params) {
          statement.params = params;
          return this;
        },
        execute: async () => ({ rows: [{ ok: 1 }] }),
      };
    },
  },
}));
const { createIndexRepo, execute } = await import('../../src/infra/indexRepo.js');

function recorder(rows = []) {
  const calls = [];
  const run = async (query, params) => {
    calls.push([query.replace(/\s+/g, ' ').trim(), params]);
    return { rows: rows.shift() ?? [] };
  };
  return { calls, run };
}

describe('index repo', () => {
  it('inserts sprint events idempotently with short kinds', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).addSprintEvents([
      { issueId: '7', projectId: '1', sprintId: '5', kind: 'added', at: 10, changeId: '100' },
      { issueId: '7', projectId: '1', sprintId: '5', kind: 'removed', at: 20, changeId: '101' },
    ]);
    expect(calls).toEqual([[
      'INSERT IGNORE INTO sprint_event (issue_id, project_id, sprint_id, kind, at, change_id) VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)',
      ['7', '1', '5', 'a', 10, '100', '7', '1', '5', 'r', 20, '101'],
    ]]);
  });
  it('upserts sprints', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).upsertSprints([{ id: '5', boardId: '2', name: 'S5', state: 'closed', startAt: 1, completeAt: 2 }]);
    expect(calls[0][0]).toMatch(/^INSERT INTO sprint .* ON DUPLICATE KEY UPDATE board_id = VALUES\(board_id\)/);
    expect(calls[0][1]).toEqual(['5', '2', 'S5', 'closed', 1, 2]);
  });
  it('reads the events of a sprint back in the shape of the core', async () => {
    const { run } = recorder([[{ issue_id: 7, sprint_id: 5, kind: 'a', at: '10', change_id: 100 }]]);
    expect(await createIndexRepo(run).sprintEventsOf('5')).toEqual([{ issueId: '7', sprintId: '5', kind: 'added', at: 10, changeId: '100' }]);
  });
  it('reads a removal back and an empty answer as no events', async () => {
    const { run } = recorder([[{ issue_id: 8, sprint_id: 5, kind: 'r', at: 3, change_id: 4 }]]);
    expect(await createIndexRepo(run).sprintEventsOf('5')).toEqual([{ issueId: '8', sprintId: '5', kind: 'removed', at: 3, changeId: '4' }]);
    expect(await createIndexRepo(async () => ({})).sprintEventsOf('5')).toEqual([]);
  });
  it('reads status events per issue in chunks of 500', async () => {
    const { calls, run } = recorder([[{ issue_id: 1, at: 5, from_cat: 'new', to_cat: 'done', change_id: 9 }], [], []]);
    const ids = Array.from({ length: 1200 }, (_, i) => String(i + 1));
    const map = await createIndexRepo(run).statusEventsOf(ids);
    expect(calls).toHaveLength(3);
    expect([...map.entries()]).toEqual([['1', [{ issueId: '1', at: 5, from: 'new', to: 'done', changeId: '9' }]]]);
  });
  it('groups several status events of one issue and reads an empty answer', async () => {
    const { run } = recorder([[{ issue_id: 1, at: 5, from_cat: 'new', to_cat: 'done', change_id: 9 }, { issue_id: 1, at: 6, from_cat: 'done', to_cat: 'new', change_id: 10 }]]);
    const map = await createIndexRepo(run).statusEventsOf(['1']);
    expect(map.get('1').map((e) => e.changeId)).toEqual(['9', '10']);
    expect((await createIndexRepo(async () => ({})).statusEventsOf(['1'])).size).toBe(0);
  });
  it('stores status events and writes rows in inserts of at most 500', async () => {
    const { calls, run } = recorder();
    const events = Array.from({ length: 501 }, (_, i) => ({ issueId: String(i), projectId: '1', at: i, from: 'new', to: 'done', changeId: String(i) }));
    await createIndexRepo(run).addStatusEvents(events);
    expect(calls.map(([q, p]) => [q.startsWith('INSERT IGNORE INTO status_event (issue_id, project_id, at, from_cat, to_cat, change_id) VALUES'), p.length])).toEqual([[true, 3000], [true, 6]]);
  });
  it('sends nothing for no rows', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).addSprintEvents([]);
    expect(calls).toEqual([]);
  });
  it('deletes an issue from the given tables', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).deleteIssue('7', ['sprint_event', 'status_event']);
    expect(calls).toEqual([['DELETE FROM sprint_event WHERE issue_id = ?', ['7']], ['DELETE FROM status_event WHERE issue_id = ?', ['7']]]);
  });
  it('deletes a sprint, a project and whole tables', async () => {
    const { calls, run } = recorder();
    const repo = createIndexRepo(run);
    await repo.deleteSprint('5');
    await repo.deleteProject('10', ['sprint_event']);
    await repo.clear(['sprint_event', 'status_event']);
    expect(calls).toEqual([
      ['DELETE FROM sprint WHERE sprint_id = ?', ['5']],
      ['DELETE FROM sprint_event WHERE project_id = ?', ['10']],
      ['DELETE FROM sprint_event', undefined],
      ['DELETE FROM status_event', undefined],
    ]);
  });
  it('runs a prepared statement with its parameters on Forge SQL', async () => {
    expect(await execute('SELECT 1 WHERE a = ?', [3])).toEqual({ rows: [{ ok: 1 }] });
    await execute('DELETE FROM sprint');
    expect(h.prepared).toEqual([{ query: 'SELECT 1 WHERE a = ?', params: [3] }, { query: 'DELETE FROM sprint', params: [] }]);
  });
});

describe('comment and attachment rows', () => {
  it('upserts comments with their visibility', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).upsertComments([
      { id: '1', issueId: '10', projectId: '2', author: 'a', createdAt: 5, updatedAt: 6, visType: 'role', visValue: 'Developers' },
      { id: '2', issueId: '10', projectId: '2', author: 'b', createdAt: 7 },
    ]);
    expect(calls[0]).toEqual([
      'INSERT INTO comment_meta (comment_id, issue_id, project_id, author, created_at, updated_at, vis_type, vis_value) VALUES (?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE author = VALUES(author), updated_at = VALUES(updated_at), vis_type = VALUES(vis_type), vis_value = VALUES(vis_value)',
      ['1', '10', '2', 'a', 5, 6, 'role', 'Developers', '2', '10', '2', 'b', 7, 7, null, null],
    ]);
  });
  it('upserts attachments with their extension and deletes single comments and attachments', async () => {
    const { calls, run } = recorder();
    const repo = createIndexRepo(run);
    await repo.upsertAttachments([{ id: '9', issueId: '10', projectId: '2', author: 'a', createdAt: 5, ext: 'pdf' }]);
    await repo.deleteComment('1');
    await repo.deleteAttachment('9');
    expect(calls).toEqual([
      ['INSERT INTO attachment_meta (attachment_id, issue_id, project_id, author, created_at, ext) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ext = VALUES(ext)', ['9', '10', '2', 'a', 5, 'pdf']],
      ['DELETE FROM comment_meta WHERE comment_id = ?', ['1']],
      ['DELETE FROM attachment_meta WHERE attachment_id = ?', ['9']],
    ]);
  });
  it('counts only comments visible to everyone per issue in SQL: at least, exactly or more than n', async () => {
    const { calls, run } = recorder([[{ issue_id: 11 }, { issue_id: 10 }], [], []]);
    const repo = createIndexRepo(run);
    expect(await repo.issuesWithCommentCount({ op: 'atLeast', n: 3 })).toEqual(['10', '11']);
    await repo.issuesWithCommentCount({ op: 'exactly', n: 2 });
    await repo.issuesWithCommentCount({ op: 'more', n: 4 });
    expect(calls).toEqual([
      ['SELECT issue_id FROM comment_meta WHERE vis_type IS NULL GROUP BY issue_id HAVING COUNT(*) >= ?', [3]],
      ['SELECT issue_id FROM comment_meta WHERE vis_type IS NULL GROUP BY issue_id HAVING COUNT(*) = ?', [2]],
      ['SELECT issue_id FROM comment_meta WHERE vis_type IS NULL GROUP BY issue_id HAVING COUNT(*) > ?', [4]],
    ]);
  });
  it('refuses a comparison that a list of indexed issues cannot answer', async () => {
    const { calls, run } = recorder();
    await expect(createIndexRepo(run).issuesWithCommentCount({ op: 'fewer', n: 3 })).rejects.toThrow('fewer');
    expect(calls).toEqual([]);
  });
  it('selects distinct issues of visible comments with every filter in SQL', async () => {
    const { calls, run } = recorder([[{ issue_id: 11 }, { issue_id: 10 }], []]);
    const repo = createIndexRepo(run);
    expect(await repo.issuesWithComments({ after: 5, before: 9, authors: ['a', 'b'], projectId: '2' })).toEqual(['10', '11']);
    await repo.issuesWithComments();
    expect(calls).toEqual([
      ['SELECT DISTINCT c.issue_id FROM comment_meta c WHERE c.vis_type IS NULL AND c.project_id = ? AND c.created_at > ? AND c.created_at < ? AND c.author IN (?,?)', ['2', 5, 9, 'a', 'b']],
      ['SELECT DISTINCT c.issue_id FROM comment_meta c WHERE c.vis_type IS NULL', []],
    ]);
  });
  it('picks the latest visible comment of each issue in SQL, the larger id on a tie, and filters only that one', async () => {
    const { calls, run } = recorder([[{ issue_id: 10 }]]);
    expect(await createIndexRepo(run).issuesWithComments({ last: true, authors: ['a'] })).toEqual(['10']);
    expect(calls).toEqual([[
      'SELECT DISTINCT c.issue_id FROM comment_meta c JOIN (SELECT x.issue_id, MAX(x.comment_id) AS id FROM comment_meta x JOIN (SELECT issue_id, MAX(created_at) AS m FROM comment_meta WHERE vis_type IS NULL GROUP BY issue_id) l ON x.issue_id = l.issue_id AND x.created_at = l.m WHERE x.vis_type IS NULL GROUP BY x.issue_id) t ON c.comment_id = t.id WHERE c.vis_type IS NULL AND c.author IN (?)',
      ['a'],
    ]]);
  });
  it('asks authors in chunks of 500 and answers no authors without a query', async () => {
    const { calls, run } = recorder([[{ issue_id: 3 }], [{ issue_id: 1 }, { issue_id: 3 }]]);
    const repo = createIndexRepo(run);
    const authors = Array.from({ length: 501 }, (_, i) => `u${i}`);
    expect(await repo.issuesWithComments({ authors })).toEqual(['1', '3']);
    expect(calls.map(([, p]) => p.length)).toEqual([500, 1]);
    expect(await repo.issuesWithComments({ authors: [] })).toEqual([]);
    expect(await repo.issuesWithAttachments({ authors: [] })).toEqual([]);
    expect(calls).toHaveLength(2);
  });
  it('lists the projects that have visible comments', async () => {
    const { calls, run } = recorder([[{ project_id: 2 }, { project_id: 10 }]]);
    expect(await createIndexRepo(run).commentProjects()).toEqual(['2', '10']);
    expect(calls[0]).toEqual(['SELECT DISTINCT project_id FROM comment_meta WHERE vis_type IS NULL', []]);
  });
  it('selects distinct issues of attachments with the extension, dates and authors in SQL', async () => {
    const { calls, run } = recorder([[{ issue_id: 10 }], []]);
    const repo = createIndexRepo(run);
    expect(await repo.issuesWithAttachments({ ext: 'pdf', after: 1, before: 2, authors: ['a'] })).toEqual(['10']);
    await repo.issuesWithAttachments();
    expect(calls).toEqual([
      ['SELECT DISTINCT issue_id FROM attachment_meta WHERE ext = ? AND created_at > ? AND created_at < ? AND author IN (?)', ['pdf', 1, 2, 'a']],
      ['SELECT DISTINCT issue_id FROM attachment_meta', []],
    ]);
  });
  it('reads the first and last visible comment time of issues', async () => {
    const { calls, run } = recorder([[{ issue_id: 10, f: '3', l: 9 }]]);
    expect([...(await createIndexRepo(run).commentBounds(['10', '11'])).entries()]).toEqual([['10', { first: 3, last: 9 }]]);
    expect(calls[0]).toEqual(['SELECT issue_id, MIN(created_at) AS f, MAX(created_at) AS l FROM comment_meta WHERE vis_type IS NULL AND issue_id IN (?,?) GROUP BY issue_id', ['10', '11']]);
  });
  it('reads issue ids only, never whole rows, from the comment and attachment tables', async () => {
    const { calls, run } = recorder();
    const repo = createIndexRepo(run);
    await repo.issuesWithComments({ after: 1 });
    await repo.issuesWithComments({ last: true });
    await repo.issuesWithAttachments({ ext: 'pdf' });
    await repo.issuesWithCommentCount({ op: 'atLeast', n: 1 });
    await repo.commentProjects();
    for (const [query] of calls) {
      expect(query).not.toMatch(/SELECT \*|SELECT c\.\*|author, created_at/);
      expect(query).toMatch(/^SELECT (DISTINCT )?(c\.)?(issue_id|project_id)\b/);
    }
  });
  it('ignores comments with restricted visibility in every comment read, so a restricted comment changes no shared result', async () => {
    const { calls, run } = recorder();
    const repo = createIndexRepo(run);
    await repo.issuesWithComments();
    await repo.issuesWithComments({ authors: ['a'], after: 1 });
    await repo.issuesWithComments({ projectId: '2', authors: ['a'] });
    await repo.issuesWithComments({ last: true, authors: ['a'] });
    await repo.issuesWithCommentCount({ op: 'more', n: 1 });
    await repo.commentBounds(['1']);
    await repo.commentProjects();
    expect(calls).toHaveLength(7);
    for (const [query] of calls) expect(query.match(/vis_type IS NULL/g).length).toBeGreaterThanOrEqual(query.includes('JOIN') ? 3 : 1);
  });
  it('reads empty answers as no rows', async () => {
    const repo = createIndexRepo(async () => ({}));
    expect([await repo.issuesWithComments(), await repo.issuesWithCommentCount({ op: 'atLeast', n: 1 }), await repo.issuesWithAttachments(), await repo.commentProjects(), (await repo.commentBounds(['1'])).size]).toEqual([[], [], [], [], 0]);
  });
});
