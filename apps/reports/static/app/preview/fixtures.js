/**
 * Fixture data for the local preview: the screen/state matrix, a Jira site with 30 RPT issues
 * (English, Cyrillic and CJK summaries) and in-memory template resolvers.
 * Later screens register their own entries in SCREENS.
 */

export const SCREENS = {
  gallery: ['default', 'unlicensed', 'error', 'loading'],
};

/** Every `{ screen, state }` pair the harness can show. */
export function screenStates() {
  return Object.entries(SCREENS).flatMap(([screen, states]) => states.map((state) => ({ screen, state })));
}

export const SITE = 'https://preview.atlassian.net';
export const PROJECT = { key: 'RPT', name: 'Reports' };
export const ME = { accountId: 'u-ann', displayName: 'Ann Lee' };

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

/** Fake `requestJira`: search/jql (ids, token pages), issue/bulkfetch, field, myself, filter/search, approximate-count; 404 otherwise. */
export async function routeJira(path, init = {}) {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  const url = new URL(path, SITE);
  const route = url.pathname;
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
  if (method === 'GET' && route === '/rest/api/3/filter/search') {
    const query = (url.searchParams.get('filterName') ?? '').toLowerCase();
    const values = FILTERS.filter((filter) => filter.name.toLowerCase().includes(query));
    return json({ values, total: values.length });
  }
  if (method === 'GET' && /\/rest\/api\/3\/issue\/[^/]+\/(comment|worklog)$/.test(route)) {
    return json({ total: 0, comments: [], worklogs: [] });
  }
  return json({ errorMessages: [`preview: no route for ${method} ${route}`] }, 404);
}

const store = { user: [], project: [], site: [] };

/** Fake resolvers behind `invoke`: getAccess, listTemplates and getScopes answer from memory; unknown keys throw. */
export function resolve(key, payload = {}) {
  if (key === 'getAccess') return { licensed: true };
  if (key === 'listTemplates') return { user: store.user, project: store.project, site: store.site };
  if (key === 'getScopes') return { site: true, projects: payload.projectKeys ?? [PROJECT.key] };
  throw new Error(`preview: no resolver for ${key}`);
}
