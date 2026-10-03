/** Issue as bulkfetch returns it: issuetype level, parent stub with its level, subtasks and links. */
export function issue(id, { level = 0, parent, subtasks = [], links = [] } = {}) {
  return {
    id: String(id),
    fields: {
      issuetype: { hierarchyLevel: level },
      ...(parent ? { parent: { id: String(parent[0]), fields: { issuetype: { hierarchyLevel: parent[1] } } } } : {}),
      subtasks: subtasks.map((s) => ({ id: String(s) })),
      issuelinks: links,
    },
  };
}

/** In-memory Jira: explicit search answers, `parent in (…)` and the subtask search computed from the issues. */
export function fakeJira({ issues = [], searches = {}, linkTypes = [], boards = [], sprints = {} } = {}) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const calls = [];
  return {
    calls,
    async searchIds(jql, options = {}) {
      calls.push(['search', jql, options.reconcile ?? []]);
      if (jql in searches) {
        const answer = searches[jql];
        if (answer instanceof Error) throw answer;
        return answer;
      }
      const parentIn = /^parent in \(([\d,]+)\)$/.exec(jql);
      if (parentIn) {
        const set = new Set(parentIn[1].split(','));
        return issues.filter((i) => set.has(i.fields.parent?.id)).map((i) => i.id);
      }
      if (jql === 'issuetype in subTaskIssueTypes()') return issues.filter((i) => i.fields.issuetype.hierarchyLevel === -1).map((i) => i.id);
      throw Object.assign(new Error(`unexpected search ${jql}`), { name: 'JiraError', status: 400 });
    },
    async bulkIssues(ids, fields) {
      calls.push(['bulk', ids.length, fields]);
      return ids.map((id) => byId.get(String(id))).filter(Boolean);
    },
    async issue(id) {
      calls.push(['issue', id]);
      return byId.get(String(id));
    },
    linkTypes: async () => linkTypes,
    boards: async (arg) => boards.filter((b) => String(b.id) === String(arg).trim() || b.name.toLowerCase() === String(arg).trim().toLowerCase()),
    sprints: async (boardId) => sprints[boardId] ?? [],
  };
}
