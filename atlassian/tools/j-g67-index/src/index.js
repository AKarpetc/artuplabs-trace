/**
 * J-G6/J-G7 prototype (plan 2026-10-03-artup-query-v1, Task 19): an SQL index of sprint history (changelog) and of
 * comment and attachment metadata, behind three jira:jqlFunction modules. Measurement only, not the product.
 *
 * g6AddedAfterSprintStart(board, sprint) → issues added to the sprint after its start (startDate) and not after its close
 * g7Commented("by <accountId> after <YYYY-MM-DD>") → issues with a comment of that author created after that day (UTC)
 * g7HasAttachments(ext)                  → issues with an attachment whose name ends with .<ext>
 *
 * Webtrigger g67-control: ?action=start&part=sprint|comments (backfill through the queue), ?action=progress, ?action=reset.
 * Events append to the index and recompute every stored precomputation of the app.
 * Only asApp REST to the Jira of the installation; no egress.
 */
import api, { assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { migrationRunner, sql } from '@forge/sql';

const queue = new Queue({ key: 'g67-backfill' });
const BUDGET_MS = 240000;
const SCOPE = 'project in (JQLG, RPT) ORDER BY id ASC';
const PARTS = new Set(['sprint', 'comments']);

async function jira(method, path, body) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await api.asApp().requestJira(assumeTrustedRoute(path), { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 300 * 2 ** attempt));
      continue;
    }
    const raw = await res.text();
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} ${res.status} ${raw.slice(0, 300)}`), { status: res.status });
    return raw ? JSON.parse(raw) : null;
  }
  throw new Error(`${method} ${path} gave up`);
}

async function migrate() {
  await migrationRunner
    .enqueue('v1_sprint_event', 'CREATE TABLE IF NOT EXISTS sprint_event (issue_id BIGINT NOT NULL, sprint_id BIGINT NOT NULL, kind CHAR(1) NOT NULL, at BIGINT NOT NULL, change_id BIGINT NOT NULL, PRIMARY KEY (change_id, issue_id, sprint_id, kind), INDEX idx_se_sprint (sprint_id, at))')
    .enqueue('v2_status_event', 'CREATE TABLE IF NOT EXISTS status_event (issue_id BIGINT NOT NULL, at BIGINT NOT NULL, to_cat VARCHAR(16) NOT NULL, change_id BIGINT NOT NULL, PRIMARY KEY (change_id, issue_id))')
    .enqueue('v3_comment_meta', 'CREATE TABLE IF NOT EXISTS comment_meta (comment_id BIGINT PRIMARY KEY, issue_id BIGINT NOT NULL, author VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, INDEX idx_cm_author (author, created_at))')
    .enqueue('v4_attachment_meta', 'CREATE TABLE IF NOT EXISTS attachment_meta (attachment_id BIGINT PRIMARY KEY, issue_id BIGINT NOT NULL, author VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, ext VARCHAR(32) NOT NULL)')
    .run();
}

async function insert(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await sql.prepare(`INSERT IGNORE INTO ${table} (${cols.join(',')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}`).bindParams(...part.flat()).execute();
  }
}

/**
 * Epoch ms of a number, a numeric string (event `timestamp` is a string) or a date string; null when unparseable,
 * counted in `bad` ({ n, samples }) so the row is skipped and the count reported, never replaced by a guess.
 */
const newBad = () => ({ n: 0, samples: [] });
const ms = (v, bad) => {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '')) ? Number(v) : Date.parse(v);
  if (Number.isFinite(n)) return n;
  if (bad) {
    bad.n += 1;
    if (bad.samples.length < 5) bad.samples.push(String(v).slice(0, 40));
  }
  return null;
};
const addBad = (total, bad) => ({ n: (total?.n ?? 0) + bad.n, samples: [...(total?.samples ?? []), ...bad.samples].slice(0, 5) });
const idSet = (v) => new Set(String(v ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)));

async function sprintFieldId() {
  const cached = await kvs.get('sprintField');
  if (cached) return cached;
  const id = (await jira('GET', '/rest/api/3/field')).find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint').id;
  await kvs.set('sprintField', id);
  return id;
}

async function categories() {
  return new Map((await jira('GET', '/rest/api/3/status')).map((s) => [String(s.id), s.statusCategory.key]));
}

function rowsFromHistories(issueId, histories, cats, bad) {
  const sprintRows = [];
  const statusRows = [];
  for (const h of histories) {
    const at = ms(h.created, bad);
    if (at === null) continue;
    for (const item of h.items ?? []) {
      if (item.field === 'Sprint') {
        const from = idSet(item.from);
        const to = idSet(item.to);
        for (const s of to) if (!from.has(s)) sprintRows.push([issueId, s, 'a', at, h.id]);
        for (const s of from) if (!to.has(s)) sprintRows.push([issueId, s, 'r', at, h.id]);
      } else if (item.fieldId === 'status') statusRows.push([issueId, at, cats.get(String(item.to)) ?? 'new', h.id]);
    }
  }
  return { sprintRows, statusRows };
}

async function indexChangelogs(ids, bad) {
  const [field, cats] = [await sprintFieldId(), await categories()];
  let token;
  const sprintRows = [];
  const statusRows = [];
  do {
    const page = await jira('POST', '/rest/api/3/changelog/bulkfetch', { issueIdsOrKeys: ids, fieldIds: [field, 'status'], maxResults: 10000, ...(token ? { nextPageToken: token } : {}) });
    for (const log of page.issueChangeLogs ?? []) {
      const r = rowsFromHistories(log.issueId, log.changeHistories ?? [], cats, bad);
      sprintRows.push(...r.sprintRows);
      statusRows.push(...r.statusRows);
    }
    token = page.nextPageToken;
  } while (token);
  await insert('sprint_event', ['issue_id', 'sprint_id', 'kind', 'at', 'change_id'], sprintRows);
  await insert('status_event', ['issue_id', 'at', 'to_cat', 'change_id'], statusRows);
}

const extOf = (name) => (String(name ?? '').includes('.') ? String(name).split('.').pop().toLowerCase().slice(0, 32) : '');

async function allComments(issueId) {
  const out = [];
  for (let startAt = 0; ; startAt += 5000) {
    const page = await jira('GET', `/rest/api/3/issue/${issueId}/comment?startAt=${startAt}&maxResults=5000`);
    out.push(...(page.comments ?? []));
    if (!page.comments?.length || out.length >= page.total) return out;
  }
}

async function indexComments(ids, bad) {
  const commentRows = [];
  const attachmentRows = [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  await Promise.all(Array.from({ length: 8 }, async (_, w) => {
    for (let c = w; c < chunks.length; c += 8) {
      const page = await jira('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: chunks[c], fields: ['comment', 'attachment'] });
      for (const x of page.issues ?? []) {
        let comments = x.fields.comment?.comments ?? [];
        if ((x.fields.comment?.total ?? 0) > comments.length) comments = await allComments(x.id);
        for (const cm of comments) {
          const at = ms(cm.created, bad);
          if (at !== null) commentRows.push([cm.id, x.id, cm.author?.accountId ?? '', at]);
        }
        for (const a of x.fields.attachment ?? []) {
          const at = ms(a.created, bad);
          if (at !== null) attachmentRows.push([a.id, x.id, a.author?.accountId ?? '', at, extOf(a.filename)]);
        }
      }
    }
  }));
  await insert('comment_meta', ['comment_id', 'issue_id', 'author', 'created_at'], commentRows);
  await insert('attachment_meta', ['attachment_id', 'issue_id', 'author', 'created_at', 'ext'], attachmentRows);
}

export async function onBackfill(event) {
  const { part } = event.body;
  const progress = await kvs.get(`progress:${part}`);
  if (!progress || progress.finishedAt) return;
  const deadline = Date.now() + BUDGET_MS;
  let { token, offset = 0 } = progress.cursor ?? {};
  for (;;) {
    const page = await jira('POST', '/rest/api/3/search/jql', { jql: SCOPE, fields: ['id'], maxResults: 5000, ...(token ? { nextPageToken: token } : {}) });
    const ids = page.issues.map((x) => x.id);
    while (offset < ids.length) {
      if (Date.now() > deadline) {
        await kvs.set(`progress:${part}`, { ...progress, cursor: { token, offset } });
        await queue.push({ body: { part } });
        return;
      }
      const slice = ids.slice(offset, offset + 1000);
      const bad = newBad();
      if (part === 'sprint') await indexChangelogs(slice, bad);
      else await indexComments(slice, bad);
      offset += slice.length;
      progress.done += slice.length;
      progress.unparsable = addBad(progress.unparsable, bad);
      await kvs.set(`progress:${part}`, { ...progress, cursor: { token, offset } });
    }
    if (!page.nextPageToken) break;
    token = page.nextPageToken;
    offset = 0;
  }
  // Functions evaluated before or during the backfill keep their stored (partial) values until recomputed.
  const recompute = await recomputeAll();
  await kvs.set(`progress:${part}`, { ...progress, cursor: null, finishedAt: Date.now(), recompute });
}

async function boardSprint(boardName, sprintName) {
  const board = (await jira('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(boardName)}`)).values.find((b) => b.name === boardName);
  if (!board) return null;
  const sprints = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await jira('GET', `/rest/agile/1.0/board/${board.id}/sprint?startAt=${startAt}&maxResults=50`);
    sprints.push(...page.values);
    if (page.isLast || !page.values.length) break;
  }
  return sprints.find((s) => s.name === sprintName);
}

const list = (rows) => (rows.length ? `id in (${rows.map((r) => r.issue_id).join(',')})` : 'id = -1');

async function addedValue([board, sprint]) {
  const s = await boardSprint(board, sprint);
  if (!s) return { error: `Sprint "${sprint}" not found on board "${board}"` };
  if (!s.startDate) return { jql: list([]) };
  // Sprint start = startDate: the site's Agile API returns no activatedDate (apps/query/docs/live-checks.md, Q-R37).
  const start = ms(s.startDate);
  const end = s.completeDate ? ms(s.completeDate) : Number.MAX_SAFE_INTEGER;
  if (start === null || end === null) return { error: `unparseable sprint dates ${s.startDate} / ${s.completeDate}` };
  const rows = (await sql.prepare("SELECT DISTINCT issue_id FROM sprint_event WHERE sprint_id = ? AND kind = 'a' AND at > ? AND at <= ?").bindParams(s.id, start, end).execute()).rows;
  return rows.length > 1000 ? { error: `${rows.length} values` } : { jql: list(rows) };
}

async function commentedValue([clauses]) {
  const by = /\bby\s+(\S+)/.exec(clauses)?.[1] ?? '';
  const after = Date.parse(/\bafter\s+(\d{4}-\d{2}-\d{2})/.exec(clauses)?.[1] ?? '1970-01-01');
  const rows = (await sql.prepare('SELECT DISTINCT issue_id FROM comment_meta WHERE author = ? AND created_at > ?').bindParams(by, after).execute()).rows;
  return rows.length > 1000 ? { error: `${rows.length} values` } : { jql: list(rows) };
}

async function attachmentsValue([ext]) {
  const rows = (await sql.prepare('SELECT DISTINCT issue_id FROM attachment_meta WHERE ext = ?').bindParams(String(ext).replace(/^\.+/, '').toLowerCase()).execute()).rows;
  return rows.length > 1000 ? { error: `${rows.length} values` } : { jql: list(rows) };
}

const VALUE = { g6AddedAfterSprintStart: addedValue, g7Commented: commentedValue, g7HasAttachments: attachmentsValue };

async function evaluate(name, args) {
  try {
    if (!VALUE[name]) return { error: `unknown function ${name}` };
    return await VALUE[name](args);
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

export const added = async (payload) => {
  const r = await evaluate('g6AddedAfterSprintStart', payload.clause.arguments);
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
};
export const commented = async (payload) => {
  const r = await evaluate('g7Commented', payload.clause.arguments);
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
};
export const hasAttachments = async (payload) => {
  const r = await evaluate('g7HasAttachments', payload.clause.arguments);
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
};

async function recomputeAll() {
  const pcs = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await jira('GET', `/rest/api/3/jql/function/computation?startAt=${startAt}&maxResults=100`);
    pcs.push(...page.values);
    if (page.isLast || !page.values.length) break;
  }
  const updates = [];
  for (const pc of pcs) {
    const r = await evaluate(pc.functionName, pc.arguments);
    if ((r.jql ?? null) !== (pc.value ?? null)) updates.push(r.error ? { id: pc.id, error: r.error } : { id: pc.id, value: r.jql });
  }
  for (let i = 0; i < updates.length; i += 50) await jira('POST', '/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true', { values: updates.slice(i, i + 50) });
  return { precomputations: pcs.length, changed: updates.length };
}

export async function onEvent(event) {
  const type = event.eventType;
  const bad = newBad();
  if (type === 'avi:jira:updated:issue' && event.changelog) {
    const r = rowsFromHistories(event.issue.id, [{ id: event.changelog.id, created: event.timestamp ?? Date.now(), items: event.changelog.items }], await categories(), bad);
    await insert('sprint_event', ['issue_id', 'sprint_id', 'kind', 'at', 'change_id'], r.sprintRows);
    await insert('status_event', ['issue_id', 'at', 'to_cat', 'change_id'], r.statusRows);
  }
  const cAt = event.comment ? ms(event.comment.created, bad) : null;
  if (type === 'avi:jira:commented:issue' && cAt !== null) await insert('comment_meta', ['comment_id', 'issue_id', 'author', 'created_at'], [[event.comment.id, event.issue.id, event.comment.author?.accountId ?? '', cAt]]);
  // Live attachment body: { id, issueId, projectId, fileName, createDate, size, mimeType, author } (live-checks.md).
  const a = event.attachment;
  const aAt = a ? ms(a.createDate ?? a.created ?? event.timestamp, bad) : null;
  if (type === 'avi:jira:created:attachment' && aAt !== null) await insert('attachment_meta', ['attachment_id', 'issue_id', 'author', 'created_at', 'ext'], [[a.id, a.issueId, a.author?.accountId ?? a.author ?? '', aAt, extOf(a.fileName ?? a.filename)]]);
  if (bad.n) await kvs.set('unparsable:events', addBad(await kvs.get('unparsable:events'), bad));
  const r = await recomputeAll();
  console.log(JSON.stringify({ g67: 'event', type, lagMs: event.timestamp ? Date.now() - Number(event.timestamp) : null, unparsable: bad.n, ...r }));
}

const reply = (body, statusCode = 200) => ({ statusCode, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(body) });

export async function onControl(request) {
  const action = request.queryParameters?.action?.[0];
  const part = request.queryParameters?.part?.[0];
  await migrate();
  if (action === 'start') {
    if (!PARTS.has(part)) return reply({ error: 'part must be sprint or comments' }, 400);
    const total = (await jira('POST', '/rest/api/3/search/approximate-count', { jql: SCOPE.replace(' ORDER BY id ASC', '') })).count;
    await kvs.set(`progress:${part}`, { part, done: 0, total, startedAt: Date.now(), cursor: null });
    await queue.push({ body: { part } });
    return reply({ started: part, total });
  }
  if (action === 'reset') {
    for (const t of ['sprint_event', 'status_event', 'comment_meta', 'attachment_meta']) await sql.prepare(`DELETE FROM ${t}`).execute();
    for (const p of PARTS) await kvs.delete(`progress:${p}`);
    await kvs.delete('unparsable:events');
    return reply({ reset: true, recompute: await recomputeAll() });
  }
  if (action === 'recompute') return reply({ recompute: await recomputeAll() });
  if (action === 'evaluate') {
    // The function's own answer (REST search answers a function error with an empty 200): lets the tool fail fast.
    const fn = request.queryParameters?.fn?.[0];
    return reply({ fn, result: await evaluate(fn, request.queryParameters?.arg ?? []) });
  }
  return reply({ sprint: (await kvs.get('progress:sprint')) ?? null, comments: (await kvs.get('progress:comments')) ?? null, unparsableEvents: (await kvs.get('unparsable:events')) ?? null });
}
