import { PSEUDO_COLUMNS } from '../core/columns.js';

const LAYOUT_KEYS = [
  'type', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'due', 'labels', 'components', 'fixVersions',
  'description', 'attachments', 'subtasks', 'key', 'summary', 'links', 'comments', 'total', 'count', 'points', 'untitled',
].map((key) => `layout.${key}`);

/** Every text key the pipeline and the renderers read from `labels` (partialBanner is a function and added separately). */
export const FILE_LABEL_KEYS = [
  ...LAYOUT_KEYS,
  'meta.jql', 'meta.exported', 'meta.count',
  'sheet.issues', 'sheet.summary',
  'summary.jql', 'summary.exportedAt', 'summary.exportedBy', 'summary.count', 'summary.issues',
  'summary.byStatus', 'summary.byAssignee', 'summary.byPriority',
  ...[...PSEUDO_COLUMNS].map((id) => `column.${id}`),
  'none', 'unassigned', 'imageUnavailable',
];

/** Labels written into files, translated through `t` (keys `file.<label>`), with `partialBanner(done, total)`. */
export function labelsFor(t) {
  const labels = Object.fromEntries(FILE_LABEL_KEYS.map((key) => [key, t(`file.${key}`)]));
  labels.partialBanner = (done, total) => t('file.partialBanner', { done, total });
  return labels;
}

/** Date formats for file contents: calendar dates in UTC (Jira dates carry no zone), date-times in local time; both medium. */
export function formatsFor(locale) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  return { date: (value) => date.format(value), dateTime: (value) => dateTime.format(value) };
}
