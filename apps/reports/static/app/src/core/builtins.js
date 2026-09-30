/** Layout names shared by the built-in Word and PDF templates. */
export const LAYOUTS = ['single', 'list', 'sprint', 'release'];

/** Built-in templates: four Excel column sets, four layouts for Word and the same four for PDF. */
export const BUILTINS = [
  { id: 'xlsx-issues', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'issue', groupBy: null, summary: true,
    columns: ['key', 'summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'duedate', 'labels', 'fixVersions', 'components', 'timeoriginalestimate', 'timespent'] },
  { id: 'xlsx-worklogs', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'worklog', groupBy: null, summary: false,
    columns: ['key', 'summary', 'worklog.author', 'worklog.started', 'worklog.hours', 'worklog.comment'] },
  { id: 'xlsx-comments', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'comment', groupBy: null, summary: false,
    columns: ['key', 'summary', 'comment.author', 'comment.created', 'comment.body'] },
  { id: 'xlsx-sprint', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'issue', groupBy: 'status', summary: true,
    columns: ['key', 'summary', 'issuetype', 'status', 'assignee', '@storyPoints', 'timeoriginalestimate', 'timespent', '@sprint'] },
  ...['docx', 'pdf'].flatMap((format) => LAYOUTS.map((layout) => ({ id: `${format}-${layout}`, builtin: true, format, kind: 'layout', layout }))),
];

/** Built-in template by id, or undefined. */
export function builtinById(id) {
  return BUILTINS.find((b) => b.id === id);
}
