/**
 * @typedef {{ kind: 'jql', jql: string, label?: string } | { kind: 'board', boardId: number, projectKey?: string } | { kind: 'sprint', sprintId: number, boardId?: number, projectKey?: string } | { kind: 'issue', key: string, projectKey?: string } | { kind: 'none' }} Entry
 */

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

const idOf = (value) => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;

function navigatorEntry(extension) {
  const raw = extension.issueKeys ?? (Array.isArray(extension.issues) ? extension.issues.map((i) => i?.key) : []);
  const list = Array.isArray(raw) ? raw : [];
  const keys = [...new Set(list.filter((k) => typeof k === 'string' && KEY.test(k)).map((k) => k.toUpperCase()))];
  if (keys.length) return { kind: 'jql', jql: `key in (${keys.join(', ')})` };
  if (typeof extension.jql === 'string' && extension.jql.trim()) {
    return { kind: 'jql', jql: extension.jql.trim() };
  }
  return { kind: 'none' };
}

const withProject = (entry, extension) => {
  const key = extension.project?.key;
  return typeof key === 'string' && PROJECT_KEY.test(key) ? { ...entry, projectKey: key } : entry;
};

/** Starting point of an export from the module's context.extension; entries of project-bound modules carry projectKey. */
export function entryFromContext(extension) {
  const ext = extension ?? {};
  switch (ext.type) {
    case 'jira:issueNavigatorAction': return navigatorEntry(ext);
    case 'jira:boardAction': case 'jira:backlogAction': {
      const boardId = idOf(ext.board?.id ?? ext.boardId);
      return boardId ? withProject({ kind: 'board', boardId }, ext) : { kind: 'none' };
    }
    case 'jira:sprintAction': {
      const sprintId = idOf(ext.sprint?.id ?? ext.sprintId);
      const boardId = idOf(ext.board?.id ?? ext.boardId);
      if (!sprintId) return { kind: 'none' };
      return withProject(boardId ? { kind: 'sprint', sprintId, boardId } : { kind: 'sprint', sprintId }, ext);
    }
    case 'jira:issueAction': {
      const key = ext.issue?.key;
      return typeof key === 'string' && KEY.test(key) ? withProject({ kind: 'issue', key: key.toUpperCase() }, ext) : { kind: 'none' };
    }
    default: return { kind: 'none' };
  }
}

/** Appends an ORDER BY clause when the JQL has none. */
export function withOrder(jql, order = 'ORDER BY key ASC') {
  return /\border\s+by\b/i.test(jql) ? jql : `${jql} ${order}`;
}

/** JQL of an entry; null when it must be looked up (board) or typed by the user (none). */
export function jqlForEntry(entry) {
  if (entry.kind === 'jql') return entry.jql;
  if (entry.kind === 'issue') return `key = "${entry.key}"`;
  if (entry.kind === 'sprint') return `sprint = ${entry.sprintId} ORDER BY Rank ASC`;
  return null;
}

/** Short name of an entry for the {filter} token of file names. */
export function entryLabel(entry) {
  if (entry.kind === 'issue') return entry.key;
  if (entry.kind === 'sprint') return `sprint-${entry.sprintId}`;
  if (entry.kind === 'board') return `board-${entry.boardId}`;
  return entry.label ?? '';
}
