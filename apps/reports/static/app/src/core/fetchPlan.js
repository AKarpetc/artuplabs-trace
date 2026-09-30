import { resolveColumn } from './columns.js';
import { FIELD_TAG, ISSUE_TAGS } from './placeholders.js';
import { resolveField } from './fields.js';

const BASE = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'project'];
const LAYOUT_FIELDS = [
  'description', 'reporter', 'created', 'updated', 'duedate', 'labels', 'components', 'fixVersions',
  'resolution', 'attachment', 'subtasks', 'issuelinks', 'comment', 'parent', 'timeoriginalestimate', 'timespent',
];
const LOOP_FIELD = { comments: 'comment', worklogs: 'worklog', subtasks: 'subtasks', links: 'issuelinks' };
const RICH_FIELDS = new Set(['description', 'environment']);

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function planColumns(template, catalog) {
  const refs = [...template.columns, ...(template.groupBy ? [template.groupBy] : [])];
  const resolved = refs.map((ref) => resolveColumn(catalog, ref));
  const extra = template.rowMode === 'worklog' ? ['worklog'] : template.rowMode === 'comment' ? ['comment'] : [];
  return {
    fields: unique([...BASE, ...resolved.filter((c) => !c.pseudo && !c.missing).map((c) => c.id), ...extra]),
    comments: template.rowMode === 'comment',
    worklogs: template.rowMode === 'worklog',
    images: false,
    rendered: false,
    missing: resolved.filter((c) => c.missing).map((c) => c.ref),
  };
}

function planLayout(template, catalog) {
  const special = ['@storyPoints', '@sprint'].map((ref) => resolveColumn(catalog, ref)).filter((c) => !c.missing).map((c) => c.id);
  const single = template.layout === 'single';
  return { fields: unique([...BASE, ...LAYOUT_FIELDS, ...special]), comments: single, worklogs: false, images: single, rendered: single, missing: [] };
}

function planTags(tags, catalog) {
  const fields = [...BASE];
  const missing = [];
  const flags = { comments: false, worklogs: false, images: false };
  const walk = (list) => list.forEach((tag) => {
    const custom = FIELD_TAG.exec(tag.name);
    if (custom) {
      const field = resolveField(catalog, custom[1]);
      if (field) fields.push(field.id);
      else missing.push(custom[1]);
    } else if (Object.hasOwn(LOOP_FIELD, tag.name)) {
      fields.push(LOOP_FIELD[tag.name]);
      if (tag.name === 'comments') flags.comments = true;
      if (tag.name === 'worklogs') flags.worklogs = true;
    } else if (Object.hasOwn(ISSUE_TAGS, tag.name) && ISSUE_TAGS[tag.name]) {
      fields.push(ISSUE_TAGS[tag.name]);
    }
    if (tag.kind === 'raw') {
      flags.images = true;
      fields.push('attachment');
      if (RICH_FIELDS.has(tag.name)) fields.push(tag.name);
    }
    walk(tag.children ?? []);
  });
  walk(tags);
  return { fields: unique(fields), ...flags, rendered: flags.images, missing };
}

/** What to read from Jira for a template: fields, extra comment/worklog reads, images, rendered HTML. */
export function planFetch(template, catalog) {
  if (template.kind === 'columns') return planColumns(template, catalog);
  if (template.kind === 'layout') return planLayout(template, catalog);
  return planTags(template.placeholders ?? [], catalog);
}
