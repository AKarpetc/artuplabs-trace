import { buildFieldCatalog } from '../../src/core/fields.js';

export const SITE = 'https://artuplabs-dev.atlassian.net';
export const DESCRIPTION_MEDIA = '77885e92-e384-4929-9955-028d700928d8';
export const COMMENT_MEDIA = '85c5ffdf-f73e-45d3-bcd1-30f9fece521e';

/** Field catalog with every field the layouts read, plus Story Points, Sprint and a rich-text custom field. */
export const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string', system: 'summary' } },
  { id: 'issuetype', name: 'Issue Type', schema: { type: 'issuetype', system: 'issuetype' } },
  { id: 'status', name: 'Status', schema: { type: 'status', system: 'status' } },
  { id: 'priority', name: 'Priority', schema: { type: 'priority', system: 'priority' } },
  { id: 'assignee', name: 'Assignee', schema: { type: 'user', system: 'assignee' } },
  { id: 'reporter', name: 'Reporter', schema: { type: 'user', system: 'reporter' } },
  { id: 'created', name: 'Created', schema: { type: 'datetime', system: 'created' } },
  { id: 'updated', name: 'Updated', schema: { type: 'datetime', system: 'updated' } },
  { id: 'duedate', name: 'Due date', schema: { type: 'date', system: 'duedate' } },
  { id: 'resolutiondate', name: 'Resolved', schema: { type: 'datetime', system: 'resolutiondate' } },
  { id: 'resolution', name: 'Resolution', schema: { type: 'resolution', system: 'resolution' } },
  { id: 'labels', name: 'Labels', schema: { type: 'array', items: 'string', system: 'labels' } },
  { id: 'components', name: 'Components', schema: { type: 'array', items: 'component', system: 'components' } },
  { id: 'fixVersions', name: 'Fix versions', schema: { type: 'array', items: 'version', system: 'fixVersions' } },
  { id: 'project', name: 'Project', schema: { type: 'project', system: 'project' } },
  { id: 'parent', name: 'Parent', schema: { type: 'issuelink', system: 'parent' } },
  { id: 'timespent', name: 'Time Spent', schema: { type: 'number', system: 'timespent' } },
  { id: 'timeoriginalestimate', name: 'Original estimate', schema: { type: 'number', system: 'timeoriginalestimate' } },
  { id: 'description', name: 'Description', schema: { type: 'string', system: 'description' } },
  { id: 'environment', name: 'Environment', schema: { type: 'string', system: 'environment' } },
  { id: 'attachment', name: 'Attachment', schema: { type: 'array', items: 'attachment', system: 'attachment' } },
  { id: 'comment', name: 'Comment', schema: { type: 'comments-page', system: 'comment' } },
  { id: 'worklog', name: 'Log Work', schema: { type: 'array', items: 'worklog', system: 'worklog' } },
  { id: 'subtasks', name: 'Sub-tasks', schema: { type: 'array', items: 'issuelinks', system: 'subtasks' } },
  { id: 'issuelinks', name: 'Linked Issues', schema: { type: 'array', items: 'issuelinks', system: 'issuelinks' } },
  { id: 'customfield_10016', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10030', name: 'Team', custom: true, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
  { id: 'customfield_10040', name: 'Acceptance', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
]);

const doc = (...content) => ({ type: 'doc', version: 1, content });
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (type, text) => ({ type, attrs: {}, content: [p(text)] });
const media = (id) => ({
  type: 'mediaSingle', attrs: { layout: 'center' },
  content: [{ type: 'media', attrs: { type: 'file', id, collection: '', height: 183, width: 200 } }],
});
const renderedImage = (attachmentId, filename, uuid) => '<p><span class="image-wrap" style="">'
  + `<a id="${attachmentId}_thumb" href="/rest/api/3/attachment/content/${attachmentId}" title="${filename}" file-preview-type="image" file-preview-id="${attachmentId}" file-preview-title="${filename}">`
  + `<jira-attachment-thumbnail url="${SITE}/rest/api/3/attachment/thumbnail/${attachmentId}?default=false" jira-url="${SITE}/rest/api/3/attachment/thumbnail/${attachmentId}" filename="${filename}">`
  + `<img src="${SITE}/rest/api/3/attachment/thumbnail/${attachmentId}" data-attachment-name="${filename}" data-attachment-type="thumbnail" data-media-services-id="${uuid}" data-media-services-type="file" style="border: 0px solid black" />`
  + '</jira-attachment-thumbnail></a></span></p>';

/** Description ADF: a paragraph, a two-row table with a header row, and one inline image. */
export const DESCRIPTION = doc(
  p('Intro'),
  { type: 'table', attrs: {}, content: [
    { type: 'tableRow', content: [cell('tableHeader', 'Step'), cell('tableHeader', 'Result')] },
    { type: 'tableRow', content: [cell('tableCell', 'Open'), cell('tableCell', 'Works')] },
  ] },
  media(DESCRIPTION_MEDIA),
);

/** First comment ADF: a paragraph and one inline image. */
export const FIRST_COMMENT = doc(p('Looks good'), media(COMMENT_MEDIA));

const user = (displayName) => ({ accountId: `id-${displayName}`, displayName });

/** A bulkfetch-shaped issue; `overrides` replaces top-level keys and, under `fields` and `renderedFields`, single fields. */
export function makeIssue(overrides = {}) {
  const base = {
    id: '10001',
    key: 'RPT-1',
    fields: {
      summary: 'Summary one',
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: user('Ann'),
      reporter: user('Rob'),
      created: '2026-09-01T10:00:00.000+0000',
      updated: '2026-09-03T12:30:00.000+0000',
      duedate: '2026-09-30',
      resolutiondate: null,
      resolution: null,
      labels: ['alpha', 'beta'],
      components: [{ name: 'API' }],
      fixVersions: [{ name: 'v1.0' }],
      project: { key: 'RPT', name: 'Reports' },
      parent: { key: 'RPT-9', fields: { summary: 'Epic' } },
      timespent: 5400,
      timeoriginalestimate: 7200,
      description: DESCRIPTION,
      environment: null,
      attachment: [
        { id: '10500', filename: 'diagram-1.png', mimeType: 'image/png' },
        { id: '10501', filename: 'screen.png', mimeType: 'image/png' },
        { id: '10502', filename: 'spec.pdf', mimeType: 'application/pdf' },
        { id: '10503', filename: 'photo.jpg', mimeType: 'image/jpeg' },
      ],
      comment: { total: 2, comments: [
        { id: '1', author: user('Ann'), created: '2026-09-02T08:00:00.000+0000', body: FIRST_COMMENT },
        { id: '2', author: user('Rob'), created: '2026-09-02T09:15:00.000+0000', body: doc(p('Thanks')) },
      ] },
      worklog: { total: 1, worklogs: [
        { id: '7', author: user('Bob'), started: '2026-09-02T09:00:00.000+0000', timeSpent: '1h 30m', timeSpentSeconds: 5400, comment: doc(p('Worked')) },
      ] },
      subtasks: [
        { id: '10010', key: 'RPT-3', fields: { summary: 'Sub one', status: { name: 'To Do' }, issuetype: { name: 'Sub-task' } } },
      ],
      issuelinks: [
        { id: '1', type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'RPT-4', fields: { summary: 'Other', status: { name: 'Done' } } } },
        { id: '2', type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'RPT-5', fields: { summary: 'Blocker', status: { name: 'To Do' } } } },
      ],
      customfield_10016: 3,
      customfield_10020: [{ id: 7, name: 'Sprint 7', state: 'active' }],
      customfield_10030: { value: 'Core' },
      customfield_10040: null,
    },
    renderedFields: {
      description: `<p>Intro</p><table></table>${renderedImage('10500', 'diagram-1.png', DESCRIPTION_MEDIA)}`,
      comment: { comments: [
        { id: '1', body: `<p>Looks good</p>${renderedImage('10503', 'photo.jpg', COMMENT_MEDIA)}` },
        { id: '2', body: '<p>Thanks</p>' },
      ] },
    },
  };
  return {
    ...base,
    ...overrides,
    fields: { ...base.fields, ...overrides.fields },
    renderedFields: { ...base.renderedFields, ...overrides.renderedFields },
  };
}

/** Deterministic formats: UTC calendar date and ISO date-time with a prefix. */
export const formats = {
  date: (d) => `D:${d.toISOString().slice(0, 10)}`,
  dateTime: (d) => `DT:${d.toISOString()}`,
};
