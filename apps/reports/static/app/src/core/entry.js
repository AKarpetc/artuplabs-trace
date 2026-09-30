/**
 * @typedef {{ kind: 'jql', jql: string, label?: string, filterId?: number, selected?: true } | { kind: 'board', boardId: number, projectKey?: string } | { kind: 'sprint', sprintId: number, boardId?: number, projectKey?: string } | { kind: 'issue', key: string, projectKey?: string } | { kind: 'none' }} Entry
 */

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

const idOf = (value) => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;

/** Fields that may carry the navigator's selected issues: Forge documents `issueKeys`; the others are read because the new navigator ("All work") was seen ignoring a selection. */
const SELECTION_FIELDS = ['issueKeys', 'selectedIssueKeys', 'issues', 'selectedIssues', 'issueIds', 'selectedIssueIds'];

const selection = (extension) => SELECTION_FIELDS.flatMap((name) => (Array.isArray(extension[name]) ? extension[name] : []));

const unique = (values) => [...new Set(values)];

function navigatorEntry(extension) {
  const items = selection(extension);
  const keys = unique(items.map((i) => (typeof i === 'string' ? i : i?.key)).filter((k) => typeof k === 'string' && KEY.test(k)).map((k) => k.toUpperCase()));
  if (keys.length) return { kind: 'jql', jql: `key in (${keys.join(', ')})`, selected: true };
  const ids = unique(items.map((i) => idOf(i !== null && typeof i === 'object' ? i.id : i)).filter(Boolean));
  if (ids.length) return { kind: 'jql', jql: `id in (${ids.join(', ')})`, selected: true };
  const filterId = idOf(extension.filterId);
  const withFilter = (entry) => (filterId ? { ...entry, filterId } : entry);
  if (typeof extension.jql === 'string' && extension.jql.trim()) return withFilter({ kind: 'jql', jql: extension.jql.trim() });
  return filterId ? withFilter({ kind: 'jql', jql: `filter = ${filterId}` }) : { kind: 'none' };
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
  return entry.label ?? (entry.filterId ? `filter-${entry.filterId}` : '');
}

const onlyOne = (values) => (unique(values).length === 1 ? values[0] : '');

/** Project of an entry for file-name examples: its own key, an issue key's prefix, else the single `project = KEY` of a JQL without OR; '' when unsure. */
export function entryProject(entry) {
  if (entry.projectKey) return entry.projectKey;
  if (entry.kind === 'issue') return entry.key.split('-')[0];
  if (entry.kind !== 'jql') return '';
  if (entry.selected) return onlyOne([...entry.jql.matchAll(/([A-Z][A-Z0-9_]*)-\d+/g)].map((m) => m[1]));
  if (/\bor\b/i.test(entry.jql)) return '';
  const clauses = [...entry.jql.matchAll(/\bproject\s*(=|!=|in\b|not\s+in\b)\s*("[^"]*"|[^\s()]+)/gi)];
  if (clauses.length !== 1 || clauses[0][1] !== '=') return '';
  const key = clauses[0][2].replace(/^"|"$/g, '');
  return PROJECT_KEY.test(key) ? key : '';
}

const shapeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const names = unique(value.flatMap((v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : [])));
    return `array(${value.length})${names.length ? `[${names.join(',')}]` : ''}`;
  }
  if (typeof value === 'object') return `object{${Object.keys(value).join(',')}}`;
  return typeof value;
};

/** Field names and types of a module's context.extension, never its values: a diagnostic for contexts Forge documents loosely. */
export function contextShape(extension) {
  if (extension === null || typeof extension !== 'object') return '(no extension)';
  return Object.entries(extension).map(([name, value]) => `${name}:${shapeOf(value)}`).join(' ');
}
