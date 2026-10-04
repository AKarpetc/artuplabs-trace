import { parseClauses } from '../core/comment-clauses.js';
import { ERR, FAIL, LOG } from '../core/errors.js';
import { sortIds } from '../core/ids.js';
import { quote } from '../core/jql-build.js';

const ACCOUNT = /^[0-9a-f]{24}$|^\d+:[0-9a-f-]{36}$/i;
const result = (ids) => ({ ids, field: 'id', watch: null });
const named = (functionName, failure) => ({ error: ERR.withFunction(functionName, failure.error), log: failure.log });
const intersect = (allowed, members) => (allowed ? new Set([...members].filter((m) => allowed.has(m))) : new Set(members));
const windowOf = (c) => ({ after: c.after ?? (c.onStart !== undefined ? c.onStart - 1 : undefined), before: c.before ?? c.onEnd });

/**
 * Value sources of the comment and attachment functions; every filter runs in SQL and only issue ids come back. Comments with restricted
 * visibility never count, because results are shared by all users. `by` takes an account id, a name or an email.
 */
export function createCommentCompute({ jira, repo, now }) {
  async function authorsOf(clauses) {
    if (clauses.by === undefined) return { allowed: null };
    const ids = ACCOUNT.test(clauses.by) ? [clauses.by] : await jira.userIds(clauses.by);
    return ids.length ? { allowed: new Set(ids) } : FAIL.notFound('User', clauses.by);
  }

  async function groupMembers(name) {
    try {
      return { members: await jira.groupMemberIds(name) };
    } catch (error) {
      if (error?.name === 'JiraError' && error.status === 404) return FAIL.notFound('Group', name);
      throw error;
    }
  }

  /** Issues whose comment authors are role members of the comment's own project, one SQL query per project with comments. */
  async function byRole(role, allowed, query) {
    const groups = new Map();
    const out = [];
    let known = false;
    const projects = await repo.commentProjects();
    for (const projectId of projects) {
      const members = await jira.roleMemberIds(projectId, role, { groups });
      known = known || members !== null;
      const authors = [...intersect(allowed, members ?? [])];
      if (authors.length) out.push(...(await query({ projectId, authors })));
    }
    return known || !projects.length ? { ids: sortIds(out) } : FAIL.notFound('Role', role);
  }

  const run = (name, kind, query) => async ({ clauses: text = '' }) => {
    const parsed = parseClauses(text, kind, now());
    if (parsed.error) return { error: ERR.withFunction(name, parsed.error), log: LOG.invalidConditions() };
    const c = parsed.clauses;
    const by = await authorsOf(c);
    if (by.error) return named(name, by);
    let { allowed } = by;
    if (c.inGroup !== undefined) {
      const g = await groupMembers(c.inGroup);
      if (g.error) return named(name, g);
      allowed = intersect(allowed, g.members);
    }
    if (allowed && !allowed.size) return result([]);
    const ask = (extra) => query(c, extra);
    if (c.inRole !== undefined) {
      const r = await byRole(c.inRole, allowed, ask);
      return r.error ? named(name, r) : result(r.ids);
    }
    return result(await ask({ authors: allowed ? [...allowed] : undefined }));
  };

  /** "Fewer than n" holds for issues without any comment too, so it is every issue outside those with at least n, as live JQL; the nested call is always an `in` call, negated by NOT. */
  const fewerThan = (n) => ({ native: `NOT (issue in hasComments(${n === 1 ? '' : quote(`+${n - 1}`)}))` });

  return {
    commented: run('commented', 'comment', (c, extra) => repo.issuesWithComments({ last: false, ...windowOf(c), ...extra })),
    lastComment: run('lastComment', 'comment', (c, extra) => repo.issuesWithComments({ last: true, ...windowOf(c), ...extra })),
    fileAttached: run('fileAttached', 'attachment', (c, extra) => repo.issuesWithAttachments({ ext: c.ext, ...windowOf(c), ...extra })),
    async hasComments({ count }) {
      if (count?.op === 'fewer') return fewerThan(count.n);
      return result(await repo.issuesWithCommentCount(count ?? { op: 'atLeast', n: 1 }));
    },
    async hasAttachments({ extension }) {
      if (extension === undefined) return { native: 'attachments is not EMPTY' };
      return result(await repo.issuesWithAttachments({ ext: extension }));
    },
  };
}
