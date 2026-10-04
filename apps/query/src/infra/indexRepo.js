import { sql } from '@forge/sql';
import { sortIds } from '../core/ids.js';
import { SQL_IN_CHUNK } from '../core/limits.js';

const marks = (n) => new Array(n).fill('?').join(',');
const chunks = (list) => Array.from({ length: Math.ceil(list.length / SQL_IN_CHUNK) }, (_, i) => list.slice(i * SQL_IN_CHUNK, (i + 1) * SQL_IN_CHUNK));

const COUNT_COMPARE = { atLeast: '>=', exactly: '=', more: '>' };
const LAST_COMMENT = 'comment_meta c JOIN (SELECT x.issue_id, MAX(x.comment_id) AS id FROM comment_meta x JOIN (SELECT issue_id, MAX(created_at) AS m FROM comment_meta WHERE vis_type IS NULL GROUP BY issue_id) l ON x.issue_id = l.issue_id AND x.created_at = l.m WHERE x.vis_type IS NULL GROUP BY x.issue_id) t ON c.comment_id = t.id';

/** One prepared statement on the app's Forge SQL database. */
export const execute = (query, params = []) => sql.prepare(query).bindParams(...params).execute();

/** Index rows: sprints, sprint and status events, comment and attachment metadata. */
export function createIndexRepo(run = execute) {
  async function insert(table, cols, rows, onDuplicate = '') {
    for (const part of chunks(rows)) {
      await run(`INSERT ${onDuplicate ? '' : 'IGNORE '}INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${marks(cols.length)})`).join(', ')}${onDuplicate}`, part.flat());
    }
  }

  /** Distinct issue ids of one SELECT whose filters with an undefined value are left out; an author list is asked in chunks, an empty one matches nothing. */
  async function distinctIssues(select, filters, authorColumn, authors) {
    if (authors && !authors.length) return [];
    const used = filters.filter((f) => f.length === 1 || f[1] !== undefined);
    const where = used.map(([sql]) => sql);
    const params = used.filter((f) => f.length > 1).map(([, value]) => value);
    const out = [];
    for (const part of authors ? chunks(authors) : [null]) {
      const clauses = part ? [...where, `${authorColumn} IN (${marks(part.length)})`] : where;
      const { rows } = await run(`${select}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`, part ? [...params, ...part] : params);
      out.push(...(rows ?? []).map((r) => r.issue_id));
    }
    return sortIds(out);
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
    upsertComments: (metas) => insert('comment_meta', ['comment_id', 'issue_id', 'project_id', 'author', 'created_at', 'updated_at', 'vis_type', 'vis_value'],
      metas.map((m) => [m.id, m.issueId, m.projectId, m.author, m.createdAt, m.updatedAt ?? m.createdAt, m.visType ?? null, m.visValue ?? null]),
      ' ON DUPLICATE KEY UPDATE author = VALUES(author), updated_at = VALUES(updated_at), vis_type = VALUES(vis_type), vis_value = VALUES(vis_value)'),
    deleteComment: (id) => run('DELETE FROM comment_meta WHERE comment_id = ?', [id]),
    upsertAttachments: (metas) => insert('attachment_meta', ['attachment_id', 'issue_id', 'project_id', 'author', 'created_at', 'ext'],
      metas.map((m) => [m.id, m.issueId, m.projectId, m.author, m.createdAt, m.ext]), ' ON DUPLICATE KEY UPDATE ext = VALUES(ext)'),
    deleteAttachment: (id) => run('DELETE FROM attachment_meta WHERE attachment_id = ?', [id]),
    /** Issues with a comment visible to everyone that passes the filters; with `last`, only each issue's latest visible comment (the larger id on a tie) is checked. */
    issuesWithComments: ({ last = false, after, before, authors, projectId } = {}) => {
      const from = last ? LAST_COMMENT : 'comment_meta c';
      const filters = [['c.vis_type IS NULL'], ['c.project_id = ?', projectId], ['c.created_at > ?', after], ['c.created_at < ?', before]];
      return distinctIssues(`SELECT DISTINCT c.issue_id FROM ${from}`, filters, 'c.author', authors);
    },
    issuesWithAttachments: ({ ext, after, before, authors } = {}) => distinctIssues('SELECT DISTINCT issue_id FROM attachment_meta', [['ext = ?', ext || undefined], ['created_at > ?', after], ['created_at < ?', before]], 'author', authors),
    async commentProjects() {
      const { rows } = await run('SELECT DISTINCT project_id FROM comment_meta WHERE vis_type IS NULL', []);
      return sortIds((rows ?? []).map((r) => r.project_id));
    },
    /** Issues with at least, exactly or more than n comments visible to everyone; "fewer than n" also holds for issues without comments, which no index list can name. */
    async issuesWithCommentCount({ op, n }) {
      const compare = COUNT_COMPARE[op];
      if (!compare) throw new Error(`Comment count ${op} cannot be read from the index`);
      const { rows } = await run(`SELECT issue_id FROM comment_meta WHERE vis_type IS NULL GROUP BY issue_id HAVING COUNT(*) ${compare} ?`, [n]);
      return sortIds((rows ?? []).map((r) => r.issue_id));
    },
    async commentBounds(issueIds) {
      const out = new Map();
      for (const part of chunks(issueIds)) {
        const { rows } = await run(`SELECT issue_id, MIN(created_at) AS f, MAX(created_at) AS l FROM comment_meta WHERE vis_type IS NULL AND issue_id IN (${marks(part.length)}) GROUP BY issue_id`, part);
        for (const r of rows ?? []) out.set(String(r.issue_id), { first: Number(r.f), last: Number(r.l) });
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
