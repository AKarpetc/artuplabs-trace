import { issuesWith, parseClauses } from '../core/comment-clauses.js';
import { ERR, FAIL, LOG } from '../core/errors.js';
import { sortIds } from '../core/ids.js';
import { quote } from '../core/jql-build.js';

const ACCOUNT = /^[0-9a-f]{24}$|^\d+:[0-9a-f-]{36}$/i;
const result = (ids) => ({ ids, field: 'id', watch: null });
const named = (functionName, failure) => ({ error: ERR.withFunction(functionName, failure.error), log: failure.log });

/** Value sources of the comment and attachment functions over the metadata index; by takes an account id, a name or an email. */
export function createCommentCompute({ jira, repo, state, now }) {
  async function authors(clauses) {
    if (clauses.by === undefined) return { ids: undefined };
    const ids = ACCOUNT.test(clauses.by) ? [clauses.by] : await jira.userIds(clauses.by);
    return ids.length ? { ids } : FAIL.notFound('User', clauses.by);
  }

  async function groupMembers(name) {
    try {
      return { members: new Set(await jira.groupMemberIds(name)) };
    } catch (error) {
      if (error?.name === 'JiraError' && error.status === 404) return FAIL.notFound('Group', name);
      throw error;
    }
  }

  async function roleMembers(name, metas) {
    const byProject = new Map();
    let known = false;
    for (const projectId of new Set(metas.map((m) => String(m.projectId)))) {
      const members = await jira.roleMemberIds(projectId, name);
      known = known || members !== null;
      byProject.set(projectId, new Set(members ?? []));
    }
    return known || !byProject.size ? { byProject } : FAIL.notFound('Role', name);
  }

  async function people(clauses, by, metas) {
    const out = by ? { by: new Set(by) } : {};
    if (clauses.inGroup !== undefined) {
      const g = await groupMembers(clauses.inGroup);
      if (g.error) return g;
      out.inGroup = g.members;
    }
    if (clauses.inRole !== undefined) {
      const r = await roleMembers(clauses.inRole, metas);
      if (r.error) return r;
      out.inRole = r.byProject;
    }
    return { people: out };
  }

  const run = (name, kind, load, last) => async ({ clauses: text = '' }) => {
    const parsed = parseClauses(text, kind, now());
    if (parsed.error) return { error: ERR.withFunction(name, parsed.error), log: LOG.invalidConditions() };
    const by = await authors(parsed.clauses);
    if (by.error) return named(name, by);
    const metas = await load(parsed.clauses, by.ids);
    const p = await people(parsed.clauses, by.ids, metas);
    if (p.error) return named(name, p);
    return result(issuesWith(metas, parsed.clauses, { last, people: p.people }));
  };

  const commentWindow = (c, ids) => ({ after: c.after ?? (c.onStart !== undefined ? c.onStart - 1 : undefined), before: c.before ?? c.onEnd, authors: ids });

  /** "Fewer than n" holds for issues without any comment too, so it is every issue outside those with at least n, as live JQL; the nested call is always an `in` call, negated by NOT. */
  async function fewerThan(n) {
    const atLeast = `NOT (issue in hasComments(${n === 1 ? '' : quote(`+${n - 1}`)}))`;
    const excluded = await state.excluded();
    return { native: excluded.length ? `${atLeast} AND project not in (${excluded.map(quote).join(', ')})` : atLeast };
  }

  return {
    commented: run('commented', 'comment', (c, ids) => repo.commentMetas(commentWindow(c, ids)), false),
    lastComment: run('lastComment', 'comment', () => repo.lastCommentMetas(), true),
    fileAttached: run('fileAttached', 'attachment', (c) => repo.attachmentMetas({ ext: c.ext }), false),
    async hasComments({ count }) {
      if (count?.op === 'fewer') return fewerThan(count.n);
      return result(await repo.issuesWithCommentCount(count ?? { op: 'atLeast', n: 1 }));
    },
    async hasAttachments({ extension }) {
      if (extension === undefined) return { native: 'attachments is not EMPTY' };
      return result(sortIds((await repo.attachmentMetas({ ext: extension })).map((m) => m.issueId)));
    },
  };
}
