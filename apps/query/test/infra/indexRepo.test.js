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
