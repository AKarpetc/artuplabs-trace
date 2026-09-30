/**
 * Fixture data for the local preview: the screen/state matrix, a Jira site with 30 RPT issues
 * (English, Cyrillic and CJK summaries) and in-memory template resolvers.
 * Later screens register their own entries in SCREENS.
 */

export const SCREENS = {
  gallery: ['default', 'unlicensed', 'error', 'loading'],
  wizard: ['form', 'form-excel', 'preview', 'running', 'incomplete', 'done', 'failed'],
  templates: ['empty', 'list', 'excel-form', 'docx-errors', 'docx-ok', 'deleting'],
  global: ['export-form', 'export-excel', 'preview', 'running', 'incomplete', 'done', 'failed', 'templates-list', 'templates-empty', 'docx-errors', 'unlicensed'],
  action: ['form', 'running', 'done', 'none'],
};

/** Every `{ screen, state }` pair the harness can show. */
export function screenStates() {
  return Object.entries(SCREENS).flatMap(([screen, states]) => states.map((state) => ({ screen, state })));
}

export const SITE = 'https://preview.atlassian.net';
export const PROJECT = { key: 'RPT', name: 'Reports' };
export const ME = { accountId: 'u-ann', displayName: 'Ann Lee' };
export const BORIS = { accountId: 'u-boris', displayName: 'Борис Петров' };

/** Projects the fixture user administers, as `GET /project/search?action=edit` lists them. */
export const PROJECTS = [PROJECT, { key: 'OPS', name: 'Operations' }, { key: 'HR', name: 'People' }];

export const FIELDS = [
  { id: 'summary', name: 'Summary', schema: { type: 'string', system: 'summary' } },
  { id: 'issuetype', name: 'Issue Type', schema: { type: 'issuetype', system: 'issuetype' } },
  { id: 'status', name: 'Status', schema: { type: 'status', system: 'status' } },
  { id: 'priority', name: 'Priority', schema: { type: 'priority', system: 'priority' } },
  { id: 'assignee', name: 'Assignee', schema: { type: 'user', system: 'assignee' } },
  { id: 'reporter', name: 'Reporter', schema: { type: 'user', system: 'reporter' } },
  { id: 'created', name: 'Created', schema: { type: 'datetime', system: 'created' } },
  { id: 'updated', name: 'Updated', schema: { type: 'datetime', system: 'updated' } },
  { id: 'duedate', name: 'Due date', schema: { type: 'date', system: 'duedate' } },
  { id: 'labels', name: 'Labels', schema: { type: 'array', items: 'string', system: 'labels' } },
  { id: 'components', name: 'Components', schema: { type: 'array', items: 'component', system: 'components' } },
  { id: 'fixVersions', name: 'Fix versions', schema: { type: 'array', items: 'version', system: 'fixVersions' } },
  { id: 'timespent', name: 'Time Spent', schema: { type: 'number', system: 'timespent' } },
  { id: 'project', name: 'Project', schema: { type: 'project', system: 'project' } },
  { id: 'description', name: 'Description', schema: { type: 'string', system: 'description' } },
  { id: 'customfield_10016', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  { id: 'customfield_10030', name: 'Team', custom: true, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
];

const SUMMARIES = [
  'Export the sprint board to Excel',
  'Экспорт отчёта по спринту в Word',
  '将问题列表导出为 PDF 文件',
  'Add column picker to the export wizard',
  'Не сохраняются настройки шаблона после перезагрузки',
  'テンプレートのプレビューが表示されない',
  'Long summary that keeps going to check wrapping in the results table and the preview cards, because real Jira summaries really do look like this one',
  'Support custom fields in the summary sheet',
  'Ошибка при выгрузке вложений больше 10 МБ',
  '批量导出时图片缺失',
  'Group rows by assignee in the Excel layout',
  'Шаблон Word: поддержка таблиц и изображений',
  'ステータスごとに色分けする',
  'Rate limit handling during large exports',
  'Показывать количество задач до выгрузки',
];
const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
const TYPES = ['Story', 'Bug', 'Task', 'Epic'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
const PEOPLE = [ME, { accountId: 'u-boris', displayName: 'Борис Петров' }, { accountId: 'u-chen', displayName: '陈伟' }, null];
const TEAMS = ['Core', 'Платформа', 'データ'];

const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function buildIssue(index) {
  const number = index + 1;
  const day = String((index % 28) + 1).padStart(2, '0');
  const summary = SUMMARIES[index % SUMMARIES.length] + (index >= SUMMARIES.length ? ` (${Math.floor(index / SUMMARIES.length) + 1})` : '');
  return {
    id: String(10000 + number),
    key: `${PROJECT.key}-${number}`,
    fields: {
      summary,
      issuetype: { name: TYPES[index % TYPES.length] },
      status: { name: STATUSES[index % STATUSES.length] },
      priority: { name: PRIORITIES[index % PRIORITIES.length] },
      assignee: PEOPLE[index % PEOPLE.length],
      reporter: ME,
      created: `2026-08-${day}T09:00:00.000+0000`,
      updated: `2026-09-${day}T12:30:00.000+0000`,
      duedate: index % 3 === 0 ? null : `2026-10-${day}`,
      labels: index % 2 === 0 ? ['export', 'reports'] : [],
      components: index % 5 === 0 ? [{ name: 'API' }] : [],
      project: PROJECT,
      description: adf(`Details of ${PROJECT.key}-${number}: ${summary}`),
      customfield_10016: (index % 8) + 1,
      customfield_10030: { value: TEAMS[index % TEAMS.length] },
    },
    renderedFields: { description: `<p>Details of ${PROJECT.key}-${number}: ${summary}</p>` },
  };
}

export const ISSUES = Array.from({ length: 30 }, (_, index) => buildIssue(index));

export const FILTERS = [
  { id: '10100', name: 'All RPT issues', jql: 'project = RPT ORDER BY key ASC' },
  { id: '10101', name: 'Open RPT issues', jql: 'project = RPT AND statusCategory != Done' },
  { id: '10102', name: 'Готово за месяц', jql: 'project = RPT AND status = Done' },
];

/** JQL containing this field name is rejected by the fixture site with Jira's error message. */
export const BAD_JQL_FIELD = 'estimateColour';

/** Stored templates the wizard screen lists: personal Excel and Word, a project layout and a site Excel set with a column this site lacks. */
export const WIZARD_TEMPLATES = {
  user: [
    { id: '0b8f3c1e-7a2d-4c55-9e10-6d1f2a3b4c01', scope: 'user', scopeId: ME.accountId, name: 'My sprint columns', format: 'xlsx', kind: 'columns', columns: ['key', 'summary', 'status', 'customfield_10016', 'customfield_10030'], rowMode: 'issue', groupBy: null, summary: false },
    { id: '0b8f3c1e-7a2d-4c55-9e10-6d1f2a3b4c02', scope: 'user', scopeId: ME.accountId, name: 'Customer status report', format: 'docx', kind: 'docx', parts: 2, placeholders: [] },
  ],
  project: [
    { id: '0b8f3c1e-7a2d-4c55-9e10-6d1f2a3b4c03', scope: 'project', scopeId: 'RPT', name: 'RPT release notes', format: 'docx', kind: 'layout', layout: 'release' },
    { id: '0b8f3c1e-7a2d-4c55-9e10-6d1f2a3b4c04', scope: 'project', scopeId: 'RPT', name: 'RPT sprint handout', format: 'pdf', kind: 'layout', layout: 'sprint', paper: 'A4' },
  ],
  site: [
    { id: '0b8f3c1e-7a2d-4c55-9e10-6d1f2a3b4c05', scope: 'site', scopeId: 'site', name: 'Company-wide issue list with a very long name that has to wrap inside its card', format: 'xlsx', kind: 'columns', columns: ['key', 'summary', 'assignee', 'customfield_77777'], rowMode: 'issue', groupBy: 'status', summary: true },
  ],
};

/** Base64 parts of the stored Word template, by template id. */
export const TEMPLATE_PARTS = { '0b8f3c1e-7a2d-4c55-9e10-6d1f2a3b4c02': ['AQID', 'BAU='] };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Issues matching the `status = "X"` and `assignee = "Name"` clauses of a JQL string; any other JQL matches everything. */
export function matchJql(jql = '') {
  const clause = (name) => new RegExp(`${name}\\s*=\\s*"?([^"]+?)"?(?:\\s+(?:AND|ORDER)\\b|$)`, 'i').exec(jql)?.[1];
  const status = clause('status');
  const assignee = clause('assignee');
  return ISSUES.filter((issue) => (!status || issue.fields.status.name.toLowerCase() === status.toLowerCase())
    && (!assignee || issue.fields.assignee?.displayName === assignee));
}

function pick(issue, fields, expand) {
  const all = !fields || fields.includes('*all');
  const chosen = all ? issue.fields : Object.fromEntries(fields.filter((f) => f in issue.fields).map((f) => [f, issue.fields[f]]));
  const out = { id: issue.id, key: issue.key, fields: chosen };
  if (expand.includes('renderedFields')) out.renderedFields = issue.renderedFields;
  return out;
}

/** Board of the fixture site: its configuration names the "All RPT issues" filter. */
export const BOARD = { id: 3, name: 'RPT board', filterId: '10100' };

/** Fake `requestJira`: search/jql (ids, token pages), issue/bulkfetch, field, myself, project search, user bulk, filter/search, filter by id, board configuration, approximate-count; 400 for BAD_JQL_FIELD; 404 otherwise. */
export async function routeJira(path, init = {}) {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  const url = new URL(path, SITE);
  const route = url.pathname;
  if (method === 'POST' && body.jql?.includes(BAD_JQL_FIELD)) {
    return json({ errorMessages: [`Field '${BAD_JQL_FIELD}' does not exist or you do not have permission to view it.`], errors: {} }, 400);
  }
  if (method === 'POST' && route === '/rest/api/3/search/jql') {
    const ids = matchJql(body.jql).map((issue) => issue.id);
    const start = Number(body.nextPageToken ?? 0);
    const end = start + (body.maxResults ?? ids.length);
    return json({ issues: ids.slice(start, end).map((id) => ({ id })), ...(end < ids.length ? { nextPageToken: String(end) } : {}) });
  }
  if (method === 'POST' && route === '/rest/api/3/search/approximate-count') return json({ count: matchJql(body.jql).length });
  if (method === 'POST' && route === '/rest/api/3/issue/bulkfetch') {
    const wanted = new Set((body.issueIdsOrKeys ?? []).map(String));
    const found = ISSUES.filter((issue) => wanted.has(issue.id) || wanted.has(issue.key));
    return json({ issues: found.map((issue) => pick(issue, body.fields, body.expand ?? [])), issueErrors: [] });
  }
  if (method === 'GET' && route === '/rest/api/3/field') return json(FIELDS);
  if (method === 'GET' && route === '/rest/api/3/myself') return json(ME);
  if (method === 'GET' && route === '/rest/api/3/project/search') return json({ values: PROJECTS, isLast: true, total: PROJECTS.length });
  if (method === 'GET' && route === '/rest/api/3/user/bulk') {
    const wanted = new Set(url.searchParams.getAll('accountId'));
    return json({ values: [ME, BORIS].filter((user) => wanted.has(user.accountId)), isLast: true });
  }
  if (method === 'GET' && route === '/rest/api/3/filter/search') {
    const query = (url.searchParams.get('filterName') ?? '').toLowerCase();
    const values = FILTERS.filter((filter) => filter.name.toLowerCase().includes(query));
    return json({ values, total: values.length });
  }
  if (method === 'GET' && route === `/rest/agile/1.0/board/${BOARD.id}/configuration`) return json({ name: BOARD.name, filter: { id: BOARD.filterId } });
  const filter = method === 'GET' && FILTERS.find((f) => route === `/rest/api/3/filter/${f.id}`);
  if (filter) return json(filter);
  if (method === 'GET' && /\/rest\/api\/3\/issue\/[^/]+\/(comment|worklog)$/.test(route)) {
    return json({ total: 0, comments: [], worklogs: [] });
  }
  return json({ errorMessages: [`preview: no route for ${method} ${route}`] }, 404);
}

const store = { user: [], project: [], site: [] };

/** Stored templates the templates screen lists: mine (Excel and Word), a project Excel set by a colleague and a site Excel set. */
export const TEMPLATES_SEED = {
  user: [
    { id: '1c9e0a52-3b61-4d0f-8a17-5f2b7c8d9e01', scope: 'user', scopeId: ME.accountId, name: 'My sprint columns', format: 'xlsx', kind: 'columns', columns: ['key', 'summary', 'status', 'customfield_10016'], rowMode: 'issue', groupBy: null, summary: false, authorId: ME.accountId, updatedAt: '2026-09-21T10:15:00.000Z' },
    { id: '1c9e0a52-3b61-4d0f-8a17-5f2b7c8d9e02', scope: 'user', scopeId: ME.accountId, name: 'Customer status report', format: 'docx', kind: 'docx', parts: 2, size: 184320, placeholders: ['issues', 'key', 'summary'], authorId: ME.accountId, updatedAt: '2026-09-25T14:40:00.000Z' },
  ],
  project: [
    { id: '1c9e0a52-3b61-4d0f-8a17-5f2b7c8d9e03', scope: 'project', scopeId: 'RPT', name: 'RPT weekly review with a long name that has to wrap inside its table cell', format: 'xlsx', kind: 'columns', columns: ['key', 'summary', 'assignee', 'status'], rowMode: 'issue', groupBy: 'status', summary: true, authorId: BORIS.accountId, updatedAt: '2026-09-18T08:05:00.000Z' },
  ],
  site: [
    { id: '1c9e0a52-3b61-4d0f-8a17-5f2b7c8d9e04', scope: 'site', scopeId: 'site', name: 'Company issue list', format: 'xlsx', kind: 'columns', columns: ['key', 'summary', 'priority'], rowMode: 'issue', groupBy: null, summary: false, authorId: BORIS.accountId, updatedAt: '2026-09-02T16:30:00.000Z' },
  ],
};

/** Replaces the in-memory stored templates with copies of `seed`. */
export function resetTemplateStore(seed = { user: [], project: [], site: [] }) {
  const copy = JSON.parse(JSON.stringify(seed));
  store.user = copy.user;
  store.project = copy.project;
  store.site = copy.site;
}

const bucketOf = (scope) => (scope === 'user' ? 'user' : scope === 'site' ? 'site' : 'project');

function findTemplate(id) {
  for (const list of Object.values(store)) {
    const template = list.find((item) => item.id === id);
    if (template) return { list, template };
  }
  throw new Error('not-found');
}

function saveTemplate(input) {
  const scopeId = input.scope === 'user' ? ME.accountId : input.scope === 'site' ? 'site' : input.scopeId;
  const updatedAt = new Date().toISOString();
  if (input.id) {
    const { list, template } = findTemplate(input.id);
    const saved = { ...template, ...input, scopeId, updatedAt };
    list[list.indexOf(template)] = saved;
    return saved;
  }
  const saved = { ...input, scopeId, id: globalThis.crypto.randomUUID(), authorId: ME.accountId, parts: 0, size: 0, updatedAt };
  store[bucketOf(input.scope)].push(saved);
  return saved;
}

function uploadTemplatePart({ id, index, total, data }) {
  const { template } = findTemplate(id);
  if (index === total - 1) {
    template.parts = total;
    template.size = (total - 1) * 150 * 1024 + Math.floor(data.length * 3 / 4);
  }
  return { stored: index };
}

/** Fake resolvers behind `invoke`: getAccess, getScopes and getTemplatePart answer from memory, the template resolvers work on an in-memory store; unknown keys throw. */
export function resolve(key, payload = {}) {
  if (key === 'getAccess') return { licensed: true };
  if (key === 'listTemplates') return JSON.parse(JSON.stringify(store));
  if (key === 'getScopes') return { site: true, projects: payload.projectKeys ?? [PROJECT.key] };
  if (key === 'saveTemplate') return saveTemplate(payload.template);
  if (key === 'uploadTemplatePart') return uploadTemplatePart(payload);
  if (key === 'deleteTemplate') {
    const { list, template } = findTemplate(payload.id);
    list.splice(list.indexOf(template), 1);
    return { deleted: true };
  }
  if (key === 'getTemplatePart') {
    const data = TEMPLATE_PARTS[payload.id]?.[payload.index];
    if (!data) throw new Error('not-found');
    return { data };
  }
  throw new Error(`preview: no resolver for ${key}`);
}
