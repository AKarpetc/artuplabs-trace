import { sql } from '@forge/sql';
import { SQL_IN_CHUNK } from '../core/limits.js';

const marks = (n) => new Array(n).fill('?').join(',');
const chunks = (list) => Array.from({ length: Math.ceil(list.length / SQL_IN_CHUNK) }, (_, i) => list.slice(i * SQL_IN_CHUNK, (i + 1) * SQL_IN_CHUNK));

/** One prepared statement on the app's Forge SQL database. */
export const execute = (query, params = []) => sql.prepare(query).bindParams(...params).execute();

/** Index rows: sprints, sprint and status events; comment and attachment metadata are added with the comment part. */
export function createIndexRepo(run = execute) {
  async function insert(table, cols, rows, onDuplicate = '') {
    for (const part of chunks(rows)) {
      await run(`INSERT ${onDuplicate ? '' : 'IGNORE '}INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${marks(cols.length)})`).join(', ')}${onDuplicate}`, part.flat());
    }
  }

  return {
    insert,
    run,
    upsertSprints: (rows) => insert('sprint', ['sprint_id', 'board_id', 'name', 'state', 'start_at', 'complete_at'], rows.map((s) => [s.id, s.boardId, s.name, s.state, s.startAt, s.completeAt]),
      ' ON DUPLICATE KEY UPDATE board_id = VALUES(board_id), name = VALUES(name), state = VALUES(state), start_at = VALUES(start_at), complete_at = VALUES(complete_at)'),
    deleteSprint: (id) => run('DELETE FROM sprint WHERE sprint_id = ?', [id]),
    addSprintEvents: (events) => insert('sprint_event', ['issue_id', 'project_id', 'sprint_id', 'kind', 'at', 'change_id'], events.map((e) => [e.issueId, e.projectId, e.sprintId, e.kind === 'added' ? 'a' : 'r', e.at, e.changeId])),
    addStatusEvents: (events) => insert('status_event', ['issue_id', 'project_id', 'at', 'from_cat', 'to_cat', 'change_id'], events.map((e) => [e.issueId, e.projectId, e.at, e.from, e.to, e.changeId])),
    async sprintEventsOf(sprintId) {
      const { rows } = await run('SELECT issue_id, sprint_id, kind, at, change_id FROM sprint_event WHERE sprint_id = ?', [sprintId]);
      return (rows ?? []).map((r) => ({ issueId: String(r.issue_id), sprintId: String(r.sprint_id), kind: r.kind === 'a' ? 'added' : 'removed', at: Number(r.at), changeId: String(r.change_id) }));
    },
    async statusEventsOf(issueIds) {
      const out = new Map();
      for (const part of chunks(issueIds)) {
        const { rows } = await run(`SELECT issue_id, at, from_cat, to_cat, change_id FROM status_event WHERE issue_id IN (${marks(part.length)})`, part);
        for (const r of rows ?? []) {
          const id = String(r.issue_id);
          out.set(id, [...(out.get(id) ?? []), { issueId: id, at: Number(r.at), from: r.from_cat, to: r.to_cat, changeId: String(r.change_id) }]);
        }
      }
      return out;
    },
    async deleteIssue(issueId, tables) {
      for (const table of tables) await run(`DELETE FROM ${table} WHERE issue_id = ?`, [issueId]);
    },
    async deleteProject(projectId, tables) {
      for (const table of tables) await run(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
    },
    async clear(tables) {
      for (const table of tables) await run(`DELETE FROM ${table}`);
    },
  };
}
