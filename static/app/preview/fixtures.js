/**
 * Fixture Confluence space for the local preview: 60 pages with Cyrillic, CJK, long and
 * colliding titles, 5 attachments and macros that make the converter report warnings.
 * `?fixture=showcase` swaps in an English handbook (with one Cyrillic and one accented branch) for listing screenshots.
 */

const SHOWCASE = new URLSearchParams(globalThis.location?.search ?? '').get('fixture') === 'showcase';

export const SPACE = { id: '98001', key: 'DOCS', name: SHOWCASE ? 'Engineering Handbook' : 'Product Documentation' };

const LONG_TITLE = 'A deliberately long page title that keeps going to check wrapping in every view of the export studio, including the tree preview, the report table and the success screen, because real Confluence spaces really do contain titles like this one — 250 chars';

const USERS = { 'u-ann': 'Ann Lee', 'u-boris': 'Борис Петров', 'u-chen': '陈伟' };
const AUTHORS = ['u-ann', 'u-boris', 'u-chen', 'u-gone'];

const DEFAULT_OUTLINE = [
  ['Product documentation', [
    ['Getting started', ['Installation', 'Configuration', 'First export', 'Troubleshooting', 'FAQ']],
    ['Архитектура системы', ['Обзор компонентов', 'Хранилище данных', 'Ёж', 'Еж', 'Очереди сообщений']],
    ['API リファレンス', ['認証', 'エンドポイント一覧', 'エラーコード', '速率限制与配额', '数据模型']],
    ['Reference', ['API', 'api', 'Café', 'Cafe', 'Glossary', LONG_TITLE, 'Release notes 2026.09', 'Code samples: `backticks` & <brackets>']],
    ['Runbooks', ['Deploy to production', 'Roll back a release', 'Rotate credentials', 'Restore a backup', 'Scale the workers',
      'Incident response', 'On-call handover', 'Database failover', 'Cache warm-up', 'Disaster recovery drill']],
    ['Design decisions', Array.from({ length: 12 }, (_, i) => `ADR-${String(i + 1).padStart(3, '0')}: ${['Use Forge', 'Markdown flavour', 'Paths from titles', 'Front-matter keys',
      'Attachment folders', 'Incremental updates', 'Manifest format', 'Zip layout', 'Link rewriting', 'Macro fallbacks', 'Localisation', 'No egress'][i]}`)],
  ]],
  ['Archive', ['Old roadmap 2024', 'Meeting notes 2025-01-14', 'Meeting notes 2025-02-11', 'Retired API v1', 'Legacy migration guide', 'Brainstorm ideas', 'Draft: pricing page']],
];

const SHOWCASE_OUTLINE = [
  ['Engineering handbook', [
    ['Getting started', ['Installation', 'Configuration', 'First export', 'Troubleshooting', 'FAQ']],
    ['Architecture', ['Overview', ['Services', ['API gateway', 'Export worker', 'Scheduler']], 'Data storage', 'Security model']],
    ['API reference', ['Authentication', 'Endpoints', 'Errors', 'Rate limits', 'Webhooks']],
    ['Runbooks', ['Deploy to production', 'Roll back a release', 'Rotate credentials', 'Restore a backup', 'Scale the workers',
      'Incident response', 'On-call handover', 'Database failover', 'Cache warm-up', 'Disaster recovery drill']],
    ['Руководство по эксплуатации', ['Обзор компонентов', 'Мониторинг']],
    ['Référence des paramètres', ['Paramètres généraux', 'Sécurité']],
    ['Release notes', ['Release notes 2026.09', 'Release notes 2026.08']],
  ]],
];

const OUTLINE = SHOWCASE ? SHOWCASE_OUTLINE : DEFAULT_OUTLINE;

const ATTACHMENTS = {
  Installation: [{ title: 'setup-wizard.png', mediaType: 'image/png', fileSize: 48213 }],
  'Обзор компонентов': [{ title: 'architecture.svg', mediaType: 'image/svg+xml', fileSize: 9120 }],
  'エンドポイント一覧': [{ title: 'openapi-spec.pdf', mediaType: 'application/pdf', fileSize: 312400 }],
  'Release notes 2026.09': [{ title: 'changelog.txt', mediaType: 'text/plain', fileSize: 2048 }],
  'Code samples: `backticks` & <brackets>': [{ title: 'large-dataset.zip', mediaType: 'application/zip', fileSize: 1650000 }],
};

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const macro = (name, inner = '') => `<ac:structured-macro ac:name="${name}" ac:schema-version="1">${inner}</ac:structured-macro>`;

const SPECIAL_BODIES = {
  Installation: '<p>Run the wizard.</p><ac:image><ri:attachment ri:filename="setup-wizard.png" /></ac:image>',
  Configuration: `${macro('info', '<ac:rich-text-body><p>Settings are per space.</p></ac:rich-text-body>')}${macro('roadmap-planner', '<ac:parameter ac:name="source">q3</ac:parameter>')}`,
  Troubleshooting: `${macro('jira', '<ac:parameter ac:name="jqlQuery">project = DOCS</ac:parameter>')}<ac:adf-extension><ac:adf-node type="extension"><ac:adf-attribute key="extension-key">decision-list</ac:adf-attribute></ac:adf-node></ac:adf-extension>`,
  FAQ: '<p>Ask <ac:link><ri:user ri:account-id="u-gone" /></ac:link> or <ac:link><ri:user ri:account-id="u-ann" /></ac:link>.</p>',
  'Обзор компонентов': '<table><tbody><tr><td colspan="2"><p>Сервис</p></td><td><p>Владелец</p></td></tr><tr><td><ul><li>API</li><li>Worker</li></ul></td><td><p>Go</p></td><td><p>Команда А</p></td></tr></tbody></table><ac:image><ri:attachment ri:filename="architecture.svg" /></ac:image>',
  'エンドポイント一覧': '<p>仕様書：<ac:link><ri:attachment ri:filename="openapi-spec.pdf" /></ac:link></p>',
  'Release notes 2026.09': `<p>See <ac:link><ri:attachment ri:filename="changelog.txt" /></ac:link> and <ac:link><ri:attachment ri:filename="missing.png" /></ac:link>.</p>`,
  'Code samples: `backticks` & <brackets>': `${macro('code', '<ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[const s = `a ${1} b`; // ]]]]><![CDATA[> not the end]]></ac:plain-text-body>')}<p><ac:link><ri:attachment ri:filename="large-dataset.zip" /></ac:link></p>`,
};

function defaultBody(title, siblings) {
  const next = siblings.find((other) => other !== title);
  const link = next ? `<p>Related: <ac:link><ri:page ri:content-title="${escapeXml(next)}" /></ac:link></p>` : '';
  return `<h2>${escapeXml(title)}</h2><p>Fixture content for <strong>${escapeXml(title)}</strong>.</p>${link}<ul><li>First point</li><li>Second point</li></ul>`;
}

function buildPages() {
  const pages = [];
  let nextId = 100001;
  let attachmentId = 700001;
  const walk = (nodes, parentId) => {
    const titles = nodes.map((node) => (Array.isArray(node) ? node[0] : node));
    nodes.forEach((node, position) => {
      const [title, children] = Array.isArray(node) ? node : [node, []];
      const id = String(nextId);
      nextId += 1;
      const index = pages.length;
      const attachments = (ATTACHMENTS[title] ?? []).map((a) => {
        const aid = `att${attachmentId}`;
        attachmentId += 1;
        return { ...a, id: aid, downloadLink: `/download/attachments/${id}/${encodeURIComponent(a.title)}?version=1&api=v2` };
      });
      pages.push({
        id, title, parentId, position, version: 1 + (index % 4), authorId: AUTHORS[index % AUTHORS.length],
        createdAt: `2026-0${1 + (index % 9)}-${String(1 + (index % 27)).padStart(2, '0')}T09:30:00.000Z`,
        labels: index % 5 === 0 ? ['docs', 'reviewed'] : index % 7 === 0 ? ['draft'] : [],
        body: SPECIAL_BODIES[title] ?? defaultBody(title, titles),
        attachments,
      });
      walk(children, id);
    });
  };
  walk(OUTLINE, null);
  return pages;
}

export const PAGES = buildPages();
const BY_ID = new Map(PAGES.map((page) => [page.id, page]));
const HOMEPAGE_ID = PAGES[0].id;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = (path) => json({ statusCode: 404, message: `preview: no fixture for ${path}` }, 404);

function paged(rows, url) {
  const limit = Number(url.searchParams.get('limit')) || 25;
  const start = Number(url.searchParams.get('cursor')) || 0;
  const results = rows.slice(start, start + limit);
  const nextStart = start + limit;
  if (nextStart >= rows.length) return json({ results, _links: {} });
  const next = new URL(url);
  next.searchParams.set('cursor', String(nextStart));
  return json({ results, _links: { next: `${next.pathname}${next.search}` } });
}

const pageSummary = (page) => ({ id: page.id, title: page.title, position: page.position, childPosition: page.position });

function pageDetail(page, withBody) {
  return {
    id: page.id, title: page.title, parentId: page.parentId, spaceId: SPACE.id, status: 'current',
    version: { number: page.version, createdAt: page.createdAt, authorId: page.authorId },
    ...(withBody ? { body: { storage: { value: page.body, representation: 'storage' } } } : {}),
  };
}

function attachmentBytes(attachment) {
  const bytes = new Uint8Array(attachment.fileSize);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + attachment.title.length) % 251;
  return bytes;
}

function download(pathname) {
  const match = pathname.match(/^\/wiki\/download\/attachments\/(\d+)\/([^/?]+)$/);
  const page = match && BY_ID.get(match[1]);
  const attachment = page?.attachments.find((a) => a.title === decodeURIComponent(match[2]));
  if (!attachment) return notFound(pathname);
  return new Response(attachmentBytes(attachment), { status: 200, headers: { 'content-type': attachment.mediaType } });
}

function ancestorsOf(page) {
  const chain = [];
  for (let parent = BY_ID.get(page.parentId); parent; parent = BY_ID.get(parent.parentId)) chain.unshift(parent);
  return chain;
}

function search(url) {
  const cql = url.searchParams.get('cql') ?? '';
  const text = (cql.match(/title~"([^"]*)\*?"/)?.[1] ?? '').replace(/\*$/, '').toLowerCase();
  const ancestor = cql.match(/ancestor=(\d+)/)?.[1] ?? null;
  const limit = Number(url.searchParams.get('limit')) || 20;
  const expand = (url.searchParams.get('expand') ?? '').split(',');
  const matches = PAGES.filter((page) => page.title.toLowerCase().includes(text))
    .filter((page) => !ancestor || ancestorsOf(page).some((a) => a.id === ancestor));
  const results = matches.slice(0, limit).map((page) => ({
    content: {
      id: page.id, type: 'page', title: page.title,
      ...(expand.includes('content.ancestors') ? { ancestors: ancestorsOf(page).map((a) => ({ id: a.id, type: 'page', title: a.title })) } : {}),
    },
    title: page.title,
  }));
  return json({ results, size: results.length, totalSize: matches.length });
}

const ROUTES = [
  [/^\/wiki\/api\/v2\/spaces$/, (url) => {
    const keys = (url.searchParams.get('keys') ?? '').split(',');
    return json({ results: keys.includes(SPACE.key) ? [{ ...SPACE, homepageId: HOMEPAGE_ID }] : [] });
  }],
  [/^\/wiki\/api\/v2\/spaces\/(\d+)\/pages$/, (url, [, spaceId]) => (spaceId === SPACE.id
    ? paged(PAGES.filter((page) => page.parentId === null).map(pageSummary), url) : notFound(url.pathname))],
  [/^\/wiki\/api\/v2\/pages\/(\d+)\/children$/, (url, [, id]) => (BY_ID.has(id)
    ? paged(PAGES.filter((page) => page.parentId === id).map(pageSummary), url) : notFound(url.pathname))],
  [/^\/wiki\/api\/v2\/pages\/(\d+)\/labels$/, (url, [, id]) => (BY_ID.has(id)
    ? paged(BY_ID.get(id).labels.map((name, i) => ({ id: `${id}-l${i}`, name, prefix: 'global' })), url) : notFound(url.pathname))],
  [/^\/wiki\/api\/v2\/pages\/(\d+)\/attachments$/, (url, [, id]) => (BY_ID.has(id)
    ? paged(BY_ID.get(id).attachments.map((a) => ({
      id: a.id, title: a.title, fileSize: a.fileSize, mediaType: a.mediaType, downloadLink: a.downloadLink,
      version: { number: 1, createdAt: '2026-05-04T10:00:00.000Z' },
    })), url) : notFound(url.pathname))],
  [/^\/wiki\/api\/v2\/pages$/, (url) => {
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
    const withBody = url.searchParams.get('body-format') === 'storage';
    return paged(ids.filter((id) => BY_ID.has(id)).map((id) => pageDetail(BY_ID.get(id), withBody)), url);
  }],
  [/^\/wiki\/download\//, (url) => download(url.pathname)],
  [/^\/wiki\/rest\/api\/user\/bulk$/, (url) => json({
    results: url.searchParams.getAll('accountId').filter((id) => id in USERS)
      .map((accountId) => ({ accountId, displayName: USERS[accountId], publicName: USERS[accountId] })),
  })],
  [/^\/wiki\/rest\/api\/search$/, (url) => search(url)],
];

/** Answers a requestConfluence path from the fixture space with a Fetch Response (404 when unknown). */
export function routeConfluence(path) {
  const url = new URL(path, 'https://preview.atlassian.net');
  for (const [pattern, handle] of ROUTES) {
    const match = url.pathname.match(pattern);
    if (match) return handle(url, match);
  }
  return notFound(url.pathname);
}
