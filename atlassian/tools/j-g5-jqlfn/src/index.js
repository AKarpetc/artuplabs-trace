/**
 * J-G5 prototype (atlassian/25_app5_jql.md §3): two jira:jqlFunction modules and one product-event
 * trigger that refreshes the stored precomputations. Measurement only, not the product.
 *
 * subtasksOf(query)      → `issuetype in subTaskIssueTypes() AND parent in (<ids of query>)`
 *   The values are the parents, not the result: new subtasks of a parent need no refresh.
 * linkedIssuesOf(query)  → `id in (<ids linked to the issues of query>)`
 *   The values are the result itself: every new or deleted link needs a refresh.
 *
 * Over 1 000 values: see parseMode (second argument); default `tree` keeps nesting at depth 1.
 * Only asApp REST to the Jira of the installation; no egress.
 */
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { Queue } from '@forge/events';
import { createHash } from 'node:crypto';

const LIMIT = 1000;
const CHAIN_PAGE = Number(process.env.CHAIN_PAGE) || 990;
const MAX_LEAVES = Number(process.env.MAX_LEAVES) || 9;
const EMPTY = 'id = -1';

const stats = () => ({ calls: 0, started: Date.now() });

async function jira(st, method, path, body) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    st.calls += 1;
    const res = await api.asApp().requestJira(path, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 300 * 2 ** attempt));
      continue;
    }
    const raw = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${res.status} ${raw.slice(0, 500)}`);
      err.status = res.status;
      err.body = raw;
      throw err;
    }
    return raw ? JSON.parse(raw) : null;
  }
  throw new Error(`${method} gave up after retries`);
}

/** Ids of all issues matching jql, 5 000 per page; reconcile makes the given ids read-after-write. */
async function searchIds(st, jql, reconcile = []) {
  const out = [];
  let nextPageToken;
  do {
    const page = await jira(st, 'POST', route`/rest/api/3/search/jql`, {
      jql,
      fields: ['id'],
      maxResults: 5000,
      ...(reconcile.length ? { reconcileIssues: reconcile.slice(0, 50).map(Number) } : {}),
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...page.issues.map((x) => x.id));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return out;
}

async function pool(items, concurrency, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  }));
  return out;
}

/** Ids linked (any type, any direction) to the given issue ids, via bulkfetch of 100 with issuelinks. */
/**
 * Ids linked (any type, any direction) to the given issue ids, via bulkfetch of 100 with issuelinks.
 * The touched issues (≤ 50, from events) are re-read with GET /issue/{id}: bulkfetch right after a link
 * event can still miss the new link.
 */
async function linkedIds(st, ids, touched = []) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const pages = await pool(chunks, 8, (chunk) => jira(st, 'POST', route`/rest/api/3/issue/bulkfetch`, { issueIdsOrKeys: chunk, fields: ['issuelinks'] }));
  const byId = new Map();
  for (const p of pages) for (const x of p.issues) byId.set(String(x.id), x.fields.issuelinks ?? []);
  const inner = new Set(ids.map(String));
  await pool(touched.filter((id) => inner.has(String(id))), 4, async (id) => {
    const x = await jira(st, 'GET', route`/rest/api/3/issue/${id}?fields=issuelinks`);
    byId.set(String(id), x.fields.issuelinks ?? []);
  });
  const out = new Set();
  for (const links of byId.values()) for (const l of links) out.add((l.outwardIssue ?? l.inwardIssue).id);
  return [...out];
}

/**
 * Mode is the optional second argument: `tree` (default), `chain`, `or`, `flat`, `error`, `fn` (linkedIssuesOf only),
 * optionally with a page: `tree:3`, `chain:2`.
 *   tree  — up to 1 000 values: one list. More: the root holds only `issue in <fn>("<query>", "tree:k")` calls
 *           (each call = 2 values), every leaf holds ≤ 1 000 values and no calls: nesting depth 1. subtasksOf puts
 *           `issuetype in subTaskIssueTypes()` on the root only (a leaf with it returned nothing when nested).
 *           Measured: 2…9 leaves exact; 10 leaves — empty result, no error; 11+ — HTTP 400. So MAX_LEAVES = 9;
 *   chain — page p holds CHAIN_PAGE values and `OR issue in <fn>("<query>", "chain:p+1")` (nesting depth = pages);
 *   or    — `x in (…1000) OR x in (…)` in one fragment; flat — one list; error — explicit error over 1 000;
 *   fn    — `issue in linkedIssues(id) OR …` over the source issues (live, no refresh needed for new links).
 */
function parseMode(arg) {
  const [mode, page] = String(arg || 'tree').split(':');
  return { mode, page: Number(page) || (mode === 'chain' ? 1 : 0) };
}

/** Offset of the first value a page needs (leaf of a tree, page of a chain), or -1 for a root. */
function pageOffset(modeArg) {
  const { mode, page } = parseMode(modeArg);
  if (mode === 'tree') return page ? (page - 1) * LIMIT : -1;
  if (mode === 'chain') return page > 1 ? (page - 1) * CHAIN_PAGE : -1;
  return -1;
}

function quote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Only the issues that have subtasks (bulkfetch of 100 with the subtasks field): keeps `parent in` small. */
async function parentsWithSubtasks(st, ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const pages = await pool(chunks, 8, (chunk) => jira(st, 'POST', route`/rest/api/3/issue/bulkfetch`, { issueIdsOrKeys: chunk, fields: ['subtasks'] }));
  return pages.flatMap((p) => p.issues.filter((x) => x.fields.subtasks?.length).map((x) => x.id));
}

/** v = { n, range(from, to) } — the sorted values, possibly only partly loaded from the cache. */
function listClause(field, v, functionName, query, modeArg) {
  const { mode, page } = parseMode(modeArg);
  if (!v.n) return { jql: EMPTY };
  if (mode === 'tree') {
    if (page) {
      const leaf = v.range((page - 1) * LIMIT, page * LIMIT);
      return leaf.length ? { jql: `${field} in (${leaf.join(',')})`, list: true } : { jql: EMPTY };
    }
    if (v.n <= LIMIT) return { jql: `${field} in (${v.range(0, v.n).join(',')})`, list: true };
    const leaves = Math.ceil(v.n / LIMIT);
    if (leaves > MAX_LEAVES) return { error: `Result needs ${v.n} values; the limit is ${MAX_LEAVES * LIMIT}. Narrow the query.` };
    const calls = Array.from({ length: leaves }, (_, k) => `issue in ${functionName}(${quote(query)}, "tree:${k + 1}")`);
    return { jql: `(${calls.join(' OR ')})` };
  }
  if (mode === 'chain') {
    const chunk = v.range((page - 1) * CHAIN_PAGE, page * CHAIN_PAGE);
    if (!chunk.length) return { jql: EMPTY };
    const more = v.n > page * CHAIN_PAGE ? ` OR issue in ${functionName}(${quote(query)}, "chain:${page + 1}")` : '';
    return { jql: more ? `(${field} in (${chunk.join(',')})${more})` : `${field} in (${chunk.join(',')})`, list: !more };
  }
  const all = v.range(0, v.n);
  if (v.n <= LIMIT || mode === 'flat') return { jql: `${field} in (${all.join(',')})`, list: true };
  if (mode === 'error') return { error: `Result needs ${v.n} values; the limit is ${LIMIT}. Narrow the query.` };
  const parts = [];
  for (let i = 0; i < v.n; i += LIMIT) parts.push(`${field} in (${all.slice(i, i + LIMIT).join(',')})`);
  return { jql: `(${parts.join(' OR ')})`, list: true };
}

/** Sorted values a function needs for the query: parents (subtasksOf) or linked ids (linkedIssuesOf). */
async function computeValues(st, functionName, query, reconcile) {
  const ids = await searchIds(st, query, reconcile);
  let values = ids;
  if (functionName === 'linkedIssuesOf') values = await linkedIds(st, ids, reconcile);
  else if (ids.length > LIMIT) values = await parentsWithSubtasks(st, ids);
  return { ids, values: [...values].map(Number).sort((a, b) => a - b) };
}

const CHUNK = 5000;
const cacheKey = (functionName, query) => `v:${functionName}:${createHash('sha1').update(query).digest('hex')}`;

/**
 * Values for (function, query). A leaf/page (from ≥ 0) reads only its 5 000-value chunks from KVS when the
 * cache is younger than maxAgeMs; otherwise the values are computed and cached in chunks (KVS value ≤ 240 KB).
 */
async function valuesFor(st, functionName, query, reconcile, maxAgeMs, from = -1) {
  const key = cacheKey(functionName, query);
  if (maxAgeMs > 0 && from >= 0) {
    const meta = await kvs.get(`${key}:m`);
    if (meta && Date.now() - meta.at < maxAgeMs) {
      const c = Math.floor(from / CHUNK);
      const arr = [...((await kvs.get(`${key}:c${c}`)) ?? []), ...((await kvs.get(`${key}:c${c + 1}`)) ?? [])];
      return { n: meta.n, ids: [], cached: true, range: (f, t) => arr.slice(f - c * CHUNK, t - c * CHUNK) };
    }
  }
  const r = await computeValues(st, functionName, query, reconcile);
  try {
    for (let i = 0; i * CHUNK < r.values.length; i += 1) await kvs.set(`${key}:c${i}`, r.values.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = 0; i * CHUNK < r.ids.length; i += 1) await kvs.set(`${key}:i${i}`, r.ids.slice(i * CHUNK, (i + 1) * CHUNK));
    await kvs.set(`${key}:m`, { at: Date.now(), n: r.values.length, ni: r.ids.length });
  } catch (e) {
    log('cache-skip', st, { key, size: r.values.length, message: e.message });
  }
  return { n: r.values.length, ids: r.ids, range: (f, t) => r.values.slice(f, t) };
}

/** Values → stored fragment for one precomputation (function, mode, page). */
function fragment(functionName, query, modeArg, v) {
  if (functionName === 'linkedIssuesOf' && parseMode(modeArg).mode === 'fn') {
    return { jql: v.ids.length ? `(${v.ids.map((id) => `issue in linkedIssues(${id})`).join(' OR ')})` : EMPTY };
  }
  const r = listClause(functionName === 'subtasksOf' ? 'parent' : 'id', v, functionName, query, modeArg);
  const { mode, page } = parseMode(modeArg);
  const isTreeLeaf = mode === 'tree' && page > 0;
  if (functionName === 'subtasksOf' && r.jql && r.jql !== EMPTY && !isTreeLeaf) {
    return { jql: `issuetype in subTaskIssueTypes() AND ${r.jql}` };
  }
  return { jql: r.jql, error: r.error };
}

function badQuery(functionName, e) {
  if (e.status !== 400) throw e;
  let msg = 'invalid query';
  try { msg = (JSON.parse(e.body).errorMessages ?? []).join('; ') || msg; } catch { /* keep default */ }
  return { error: `${functionName}: ${msg}` };
}

function log(kind, st, extra) {
  console.log(JSON.stringify({ jg5: kind, ms: Date.now() - st.started, calls: st.calls, ...extra }));
}

async function handle(functionName, payload) {
  const st = stats();
  const args = payload?.clause?.arguments ?? [];
  const query = args[0];
  let r;
  let cached = false;
  if (!query) r = { error: `${functionName}: the query argument is required` };
  else {
    try {
      const from = pageOffset(args[1]);
      const v = await valuesFor(st, functionName, query, [], from >= 0 ? 120000 : 0, from);
      cached = Boolean(v.cached);
      r = fragment(functionName, query, args[1], v);
    } catch (e) {
      r = badQuery(functionName, e);
    }
  }
  const valueCount = r.jql ? (r.jql.match(/,/g)?.length ?? 0) + 1 : 0;
  log('fn', st, { functionName, args, precomputationId: payload?.precomputationId, valueCount, jqlLength: r.jql?.length, cached, error: r.error });
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
}

export const subtasksOf = (payload) => handle('subtasksOf', payload);
export const linkedIssuesOf = (payload) => handle('linkedIssuesOf', payload);

async function allPrecomputations(st) {
  const out = [];
  let startAt = 0;
  for (;;) {
    const page = await jira(st, 'GET', route`/rest/api/3/jql/function/computation?startAt=${startAt}&maxResults=100`);
    out.push(...page.values);
    if (page.isLast || !page.values.length) break;
    startAt += page.values.length;
  }
  return out;
}

function touchedIssueIds(event) {
  const ids = [event?.issue?.id, event?.issueLink?.sourceIssueId, event?.issueLink?.destinationIssueId];
  return ids.filter(Boolean).map(String);
}

/** Issues of the inner query at the last computation (from the KVS cache), or null when not cached. */
async function cachedInner(functionName, query) {
  const key = cacheKey(functionName, query);
  const meta = await kvs.get(`${key}:m`);
  if (!meta || meta.ni === undefined) return null;
  const out = new Set();
  for (let i = 0; i * CHUNK < meta.ni; i += 1) for (const id of (await kvs.get(`${key}:i${i}`)) ?? []) out.add(String(id));
  return out;
}

const queue = new Queue({ key: 'jg5-refresh' });
const ACTIVE_MS = (Number(process.env.ACTIVE_MIN) || 10) * 60 * 1000;
const PENDING_STALE_MS = 6 * 60 * 1000;
const LEASE_MS = 90 * 1000;
const WORKER_BUDGET_MS = 240 * 1000;
const MAX_TOUCHED = 50;
const JOURNAL_PAGE = 100;
const VERIFY_DELAY_S = 20;

async function pushJob(st, ts) {
  await kvs.set('pending', ts);
  try {
    await queue.push({ body: { ts } });
    return true;
  } catch (e) {
    await kvs.delete('pending');
    log('push-failed', st, { message: e.message, name: e.name, code: e.code, details: e.details });
    return false;
  }
}

/**
 * Journal of touched issues: one KVS key per event (`t:<ts>:<random>` → ids), so concurrent events never
 * overwrite each other (a single read-modify-write `dirty` key lost ids under three parallel streams and left
 * a deleted link visible for 10 min). An event without issue ids is stored as [] = recompute everything.
 */
async function markDirty(touched, ts) {
  await kvs.set(`t:${String(ts).padStart(15, '0')}:${Math.random().toString(36).slice(2, 8)}`, touched);
}

async function readJournal() {
  const page = await kvs.query().where('key', WhereConditions.beginsWith('t:')).limit(JOURNAL_PAGE).getMany();
  return page.results ?? [];
}

/**
 * Product event → mark dirty with the touched issues (one KVS write); push a queue job only when no job is
 * pending and no worker is running (Async events allow 500 pushes per minute per installation).
 * More than 50 touched issues since the last recompute → overflow: the worker recomputes everything.
 */
export async function refresh(event) {
  const st = stats();
  const ts = Date.now();
  const touched = touchedIssueIds(event);
  await markDirty(touched, ts);
  const [pending, running] = await Promise.all(['pending', 'running'].map((k) => kvs.get(k)));
  let pushed = false;
  if (ts - (pending ?? 0) > PENDING_STALE_MS && ts - (running ?? 0) > LEASE_MS) pushed = await pushJob(st, ts);
  log('trigger', st, { event: event?.eventType, pushed, eventLagMs: event?.timestamp ? ts - Number(event.timestamp) : undefined });
}

/**
 * One pass: recompute the precomputations the touched issues can affect; null when nothing is dirty.
 * The KVS lease is not atomic, so two passes can overlap: a pass does not write when a pass that started
 * later has already written (measured: without this guard one deleted link stayed visible for 10 min).
 */
async function refreshOnce(st) {
  const startedAt = Date.now();
  const rows = await readJournal();
  if (!rows.length) return null;
  const firstAt = Math.min(...rows.map((r) => Number(r.key.split(':')[1])));
  const touched = [...new Set(rows.flatMap((r) => r.value ?? []).map(String))];
  const all = rows.length >= JOURNAL_PAGE || rows.some((r) => !r.value?.length) || touched.length > MAX_TOUCHED;
  const pcs = (await allPrecomputations(st)).filter((pc) => !pc.used || startedAt - Date.parse(pc.used) < ACTIVE_MS);
  const groups = new Map();
  for (const pc of pcs) {
    const k = `${pc.functionName}\u0000${pc.arguments?.[0]}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(pc);
  }
  const changed = [];
  let recomputed = 0;
  await pool([...groups.values()], 4, async (list) => {
    const { functionName, arguments: args } = list[0];
    let v;
    let err;
    if (!all) {
      const prev = await cachedInner(functionName, args[0]);
      let now = null;
      try {
        now = await searchIds(st, `(${args[0]}) AND id in (${touched.join(',')})`, touched.slice(0, 50));
      } catch (e) {
        if (e.status !== 400) throw e;
      }
      if (prev && now && !now.length && !touched.some((id) => prev.has(id))) return;
    }
    try {
      recomputed += 1;
      v = await valuesFor(st, functionName, args[0], touched.slice(0, 50), 0);
    } catch (e) {
      err = badQuery(functionName, e);
    }
    for (const pc of list) {
      const r = err ?? fragment(functionName, pc.arguments[0], pc.arguments[1], v);
      if ((r.jql ?? null) !== (pc.value ?? null) || (r.error ?? null) !== (pc.error ?? null)) {
        changed.push(r.error ? { id: pc.id, error: r.error } : { id: pc.id, value: r.jql });
      }
    }
  });
  let stale = false;
  if (changed.length) {
    if (((await kvs.get('lastWrittenStart')) ?? 0) > startedAt) stale = true;
    else {
      await kvs.set('lastWrittenStart', startedAt);
      for (let i = 0; i < changed.length; i += 50) {
        await jira(st, 'POST', route`/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true`, { values: changed.slice(i, i + 50) });
      }
    }
  }
  for (const r of rows) await kvs.delete(r.key);
  return { touchedIds: touched.slice(0, MAX_TOUCHED), stale, oldestEventMs: startedAt - firstAt, events: rows.length, touched: touched.length, all, precomputations: pcs.length, groups: groups.size, recomputed, changed: changed.length };
}

/**
 * Queue consumer. Clears `pending`; leaves at once if another worker holds the lease; otherwise loops
 * passes until nothing is dirty (or the 240 s budget is spent), then re-pushes itself if an event slipped in,
 * and pushes one delayed verify job (20 s) for the touched issues: a pass right after an event can read
 * data that does not show the change yet (measured once in 149 changes: a new link stuck for 10 min).
 */
export async function worker(event) {
  const st = stats();
  const body = event?.body ?? {};
  if (body.verify?.length) await markDirty(body.verify, Date.now());
  else await kvs.delete('pending');
  const running = (await kvs.get('running')) ?? 0;
  if (Date.now() - running < LEASE_MS) {
    log('worker-busy', st, { queuedMs: Date.now() - body.ts });
    return;
  }
  const deadline = Date.now() + WORKER_BUDGET_MS;
  await kvs.set('running', Date.now());
  const passes = [];
  try {
    while (Date.now() < deadline) {
      const pass = await refreshOnce(st);
      if (!pass) break;
      passes.push(pass);
      await kvs.set('running', Date.now());
    }
  } finally {
    await kvs.delete('running');
  }
  if ((await readJournal()).length && !(await kvs.get('pending'))) await pushJob(st, Date.now());
  const verify = [...new Set(passes.flatMap((p) => p.touchedIds ?? []))].slice(0, MAX_TOUCHED);
  if (!body.verify && verify.length) {
    try {
      await queue.push({ body: { ts: Date.now(), verify }, delayInSeconds: VERIFY_DELAY_S });
    } catch (e) {
      log('push-failed', st, { message: e.message, verify: true });
    }
  }
  for (const p of passes) delete p.touchedIds;
  log(passes.length ? 'worker' : 'worker-skip', st, { queuedMs: Date.now() - body.ts, passes });
}
