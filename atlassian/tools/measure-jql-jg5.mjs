#!/usr/bin/env node
/**
 * J-G5 feasibility measurement for ArtUp Query (atlassian/25_app5_jql.md §3, §11).
 * Runs against the prototype atlassian/tools/j-g5-jqlfn (development, installed on artuplabs-dev)
 * and the seeded JQLG project (atlassian/tools/seed-jira-jqlg.mjs) plus RPT: 50 000 issues.
 * Gate (closes if): p90 latency > 60 s, or a result > 10 000 issues does not fit the precomputation,
 * or the refresh cannot be driven by an event.
 *
 * Phases (select with --phase all|cold|fanout|latency|burst|forge):
 *   cold    — first evaluation of each function on fresh arguments (time, value count, mode) and
 *             completeness against a REST reference (inner ids → subtasks by parent / links by bulkfetch);
 *   fanout  — how many nested leaf calls one stored fragment may hold (subtasksOf, 2…16 leaves);
 *   latency — ≥ 30 changes of each kind, polled every 2 s with `search/jql` until the function sees them:
 *             new subtask, new link, deleted link, label added (enter inner query), label removed (leave);
 *   burst   — 200 new links within one minute, then their deletion; latency of the last one;
 *   forge   — counts trigger/worker invocations and REST calls from `forge logs` since the run start.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/measure-jql-jg5.mjs [--phase all] [--n 30] [--burst 200]
 * Writes atlassian/data/jg5-<phase>.json.
 */

import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const APP = join(HERE, 'j-g5-jqlfn');
const SITE = 'https://artuplabs-dev.atlassian.net';
const POLL_MS = 2000;
const TIMEOUT_MS = 10 * 60 * 1000;

const args = { phase: 'all', n: 30, burst: 200 };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  args[k] = ['phase', 'since', 'tag', 'leaves'].includes(k) ? process.argv[i + 1] : Number(process.argv[i + 1]);
}

const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { requests: 0, retries: 0 };
const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

async function api(method, path, body, { raw = false } = {}) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    stats.requests += 1;
    let res;
    try {
      res = await fetch(`${SITE}${path}`, {
        method,
        headers: { Authorization: auth(), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      stats.retries += 1;
      log(`network ${method} ${path}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      stats.retries += 1;
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (raw) return { status: res.status, text };
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`), { status: res.status, text });
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path} → gave up`);
}

async function pool(items, concurrency, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
    }
  }));
  return out;
}

/** All ids for a JQL (5 000 per page), or { error } with Jira's message. */
async function ids(jql) {
  const out = [];
  let nextPageToken;
  do {
    const r = await api('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: 5000, ...(nextPageToken ? { nextPageToken } : {}) }, { raw: true });
    if (r.status !== 200) return { error: `${r.status} ${r.text.slice(0, 300)}` };
    const page = JSON.parse(r.text);
    out.push(...page.issues.map((x) => x.id));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return { ids: out };
}

async function bulk(idList, fields) {
  const chunks = [];
  for (let i = 0; i < idList.length; i += 100) chunks.push(idList.slice(i, i + 100));
  const pages = await pool(chunks, 8, (c) => api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: c, fields }));
  return pages.flatMap((p) => p.issues);
}

let subtaskParents = null;

/** Reference result by REST traversal, independent of the app. */
async function reference(fn, inner) {
  const src = (await ids(inner)).ids;
  if (fn === 'subtasksOf') {
    const set = new Set(src);
    if (!subtaskParents) {
      const subs = await ids('issuetype in subTaskIssueTypes() AND project in (JQLG, RPT)');
      subtaskParents = (await bulk(subs.ids, ['parent'])).map((x) => [x.id, x.fields.parent?.id]);
    }
    return subtaskParents.filter(([, parent]) => set.has(parent)).map(([id]) => id);
  }
  const issues = await bulk(src, ['issuelinks']);
  const out = new Set();
  for (const x of issues) for (const l of x.fields.issuelinks ?? []) out.add((l.outwardIssue ?? l.inwardIssue).id);
  return [...out];
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const summary = (arr) => ({ n: arr.length, p50: pct(arr, 50), p90: pct(arr, 90), max: arr.length ? Math.max(...arr) : null });
const round = (ms) => Math.round(ms / 100) / 10;

/** Polls `(clause) AND id = X` until present (or absent) — seconds from `since`, or null on timeout. */
async function waitFor(clause, id, present, since) {
  for (;;) {
    const r = await api('POST', '/rest/api/3/search/jql', { jql: `(${clause}) AND id = ${id}`, fields: ['id'], maxResults: 1 }, { raw: true });
    const found = r.status === 200 && JSON.parse(r.text).issues.length > 0;
    if (r.status === 200 && found === present) return round(Date.now() - since);
    if (Date.now() - since > TIMEOUT_MS) return null;
    await sleep(POLL_MS);
  }
}

const nonce = () => `${Date.now() % 100000000}`;

async function save(name, data) {
  await writeFile(join(DATA, `jg5-${name}.json`), JSON.stringify({ date: new Date().toISOString(), args, requests: stats, ...data }, null, 1));
  log(`saved jg5-${name}.json`);
}

/* ---------------------------------------------------------------- cold */

async function cold() {
  const n = nonce();
  const fresh = (q) => `${q} AND key != JQLG-${n}`;
  const cases = [
    ['subtasksOf', 'project = JQLG AND labels = jg-mid', 'tree', '150 parents → 1 200 subtasks (> 1 000)'],
    ['subtasksOf', 'project = JQLG AND labels = jg-big', 'tree', '800 parents → 12 000 subtasks (> 10 000)'],
    ['subtasksOf', 'project = JQLG AND labels = jg-task', 'tree', '15 600 parents (16 leaves) → 24 000 subtasks'],
    ['subtasksOf', 'project in (JQLG, RPT)', 'tree', 'inner = all 50 000 issues (50 leaves)'],
    ['subtasksOf', 'project = JQLG AND labels = jg-task', 'chain', 'linear chain of 16 pages (nesting depth 16)'],
    ['subtasksOf', 'project = JQLG AND labels = jg-task', 'or', 'OR of lists of 1 000 in one fragment'],
    ['subtasksOf', 'project = JQLG AND labels = jg-task', 'flat', 'one list of 15 600'],
    ['subtasksOf', 'project = JQLG AND labels = jg-task', 'error', 'explicit error over 1 000'],
    ['linkedIssuesOf', 'project = JQLG AND labels = jg-lnk', 'tree', '300 sources → 1 500 linked (> 1 000)'],
    ['linkedIssuesOf', 'project = JQLG AND labels = jg-lnk', 'fn', 'linkedIssues(id) OR … over 300 sources'],
    ['linkedIssuesOf', 'project = JQLG AND labels = jg-task AND key <= JQLG-2000', 'fn', 'linkedIssues(id) OR … over ~1 600 sources'],
    ['linkedIssuesOf', 'project in (JQLG, RPT)', 'tree', 'inner = all 50 000 issues (bulkfetch 500 calls)'],
  ];

  const out = [];
  for (const [fn, inner, mode, note] of cases) {
    const q = fresh(inner);
    const clause = `issue in ${fn}("${q}", "${mode}")`;
    const t0 = Date.now();
    const res = await ids(clause);
    const seconds = round(Date.now() - t0);
    const row = { fn, inner, mode, note, firstSearchSeconds: seconds, count: res.ids?.length ?? null, error: res.error };
    if (res.ids) {
      const t1 = Date.now();
      await ids(clause);
      row.secondSearchSeconds = round(Date.now() - t1);
      const ref = await reference(fn, q);
      const got = new Set(res.ids);
      row.reference = ref.length;
      row.missing = ref.filter((x) => !got.has(x)).length;
      row.extra = res.ids.length - (ref.length - row.missing);
      row.complete = row.missing === 0 && row.extra === 0;
    }
    log(`${fn} ${mode} ${note}: ${JSON.stringify(row)}`);
    out.push(row);
  }
  await save(args.tag ? `cold-${args.tag}` : 'cold', { cases: out });
  return out;
}

/* ---------------------------------------------------------------- fanout */

/** How many nested leaf calls Jira accepts in one stored fragment: subtasksOf over growing task sets. */
async function fanout() {
  const n = nonce();
  const out = [];
  const list = args.leaves ? String(args.leaves).split(',').map(Number) : [2, 4, 6, 7, 8, 9, 10, 11, 12, 16];
  for (const leaves of list) {
    const inner = `project = JQLG AND labels = jg-task AND key <= JQLG-${400 + leaves * 1000 - 500} AND key != JQLG-${n}`;
    const clause = `issue in subtasksOf("${inner}")`;
    const t0 = Date.now();
    const res = await ids(clause);
    const row = { leaves, inner, firstSearchSeconds: round(Date.now() - t0), count: res.ids?.length ?? null, error: res.error };
    if (res.ids) {
      const ref = await reference('subtasksOf', inner);
      const got = new Set(res.ids);
      row.reference = ref.length;
      row.complete = ref.every((x) => got.has(x)) && ref.length === res.ids.length;
    }
    log(`fanout ${leaves}: ${JSON.stringify(row)}`);
    out.push(row);
  }
  await save(args.tag ? `fanout-${args.tag}` : 'fanout', { cases: out });
  return out;
}

/* ---------------------------------------------------------------- latency */

async function linkId(fromId, toId) {
  const x = await api('GET', `/rest/api/3/issue/${fromId}?fields=issuelinks`);
  return x.fields.issuelinks.find((l) => (l.outwardIssue ?? l.inwardIssue)?.id === String(toId))?.id;
}

async function latency() {
  const n = args.n;
  const project = await api('GET', '/rest/api/3/project/JQLG');
  const subType = (await api('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`)).find((t) => t.subtask);
  const Q_SUB = 'project = JQLG AND labels = jg-mid';
  const Q_LNK = 'project = JQLG AND labels = jg-lnk';
  const Q_IN = 'project = JQLG AND labels = jg-in';
  const C_SUB = `issue in subtasksOf("${Q_SUB}")`;
  const C_LNK = `issue in linkedIssuesOf("${Q_LNK}")`;
  const C_IN = `issue in subtasksOf("${Q_IN}")`;
  for (const c of [C_SUB, C_LNK, C_IN]) log(`warm ${c}: ${(await ids(c)).ids?.length}`);

  const mid = (await ids(`${Q_SUB} ORDER BY key`)).ids;
  const lnk = (await ids(`${Q_LNK} ORDER BY key`)).ids;
  const small = await bulk((await ids('project = JQLG AND labels = jg-small ORDER BY key')).ids.slice(0, n + 5), ['subtasks', 'labels']);
  const targets = (await ids('project = JQLG AND labels = jg-task AND issueLinkType is EMPTY AND labels not in (jg-big, jg-mid, jg-small, jg-lnk) ORDER BY key DESC')).ids;

  const rows = { newSubtask: [], newLink: [], deletedLink: [], enterQuery: [], leaveQuery: [] };
  const timeouts = { newSubtask: 0, newLink: 0, deletedLink: 0, enterQuery: 0, leaveQuery: 0 };
  const push = (kind, s) => (s === null ? (timeouts[kind] += 1) : rows[kind].push(s));

  const subStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const parent = mid[(i * 7) % mid.length];
      const created = await api('POST', '/rest/api/3/issue', { fields: { project: { id: project.id }, issuetype: { id: subType.id }, summary: `jg5 measure sub ${i}`, labels: ['jg', 'jg-measure'], parent: { id: parent } } });
      const t = Date.now();
      push('newSubtask', await waitFor(C_SUB, created.id, true, t));
      log(`newSubtask ${i}: ${rows.newSubtask.at(-1)} s`);
    }
  };
  const linkStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const from = lnk[(i * 11) % lnk.length];
      const to = targets[i];
      await api('POST', '/rest/api/3/issueLink', { type: { name: 'Relates' }, outwardIssue: { id: from }, inwardIssue: { id: to } });
      let t = Date.now();
      push('newLink', await waitFor(C_LNK, to, true, t));
      const lid = await linkId(from, to);
      await api('DELETE', `/rest/api/3/issueLink/${lid}`);
      t = Date.now();
      push('deletedLink', await waitFor(C_LNK, to, false, t));
      log(`link ${i}: +${rows.newLink.at(-1)} s −${rows.deletedLink.at(-1)} s`);
    }
  };
  const fieldStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const x = small[i];
      const sub = x.fields.subtasks[0].id;
      await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ add: 'jg-in' }] } });
      let t = Date.now();
      push('enterQuery', await waitFor(C_IN, sub, true, t));
      await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ remove: 'jg-in' }] } });
      t = Date.now();
      push('leaveQuery', await waitFor(C_IN, sub, false, t));
      log(`field ${i}: in ${rows.enterQuery.at(-1)} s out ${rows.leaveQuery.at(-1)} s`);
    }
  };
  const t0 = Date.now();
  await Promise.all([subStream(), linkStream(), fieldStream()]);
  const all = Object.values(rows).flat();
  const result = {
    seconds: round(Date.now() - t0),
    summary: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { ...summary(v), timeouts: timeouts[k] }])),
    overall: { ...summary(all), timeouts: Object.values(timeouts).reduce((a, b) => a + b, 0) },
    raw: rows,
  };
  log(JSON.stringify(result.summary));
  await save('latency', result);
  return result;
}

/* ---------------------------------------------------------------- burst */

async function burst() {
  const Q_LNK = 'project = JQLG AND labels = jg-lnk';
  const C_LNK = `issue in linkedIssuesOf("${Q_LNK}")`;
  await ids(C_LNK);
  const lnk = (await ids(`${Q_LNK} ORDER BY key`)).ids;
  const targets = (await ids('project = JQLG AND labels = jg-task AND issueLinkType is EMPTY AND labels not in (jg-big, jg-mid, jg-small, jg-lnk) ORDER BY key ASC')).ids.slice(0, args.burst);
  const pairs = targets.map((to, i) => [lnk[i % lnk.length], to]);
  const gap = 60000 / pairs.length;

  const run = async (label, op, present) => {
    const t0 = Date.now();
    await pool(pairs, 4, async (p, i) => {
      const due = t0 + i * gap;
      if (Date.now() < due) await sleep(due - Date.now());
      await op(p);
    });
    const tLast = Date.now();
    const spread = round(tLast - t0);
    for (;;) {
      const got = new Set((await ids(`(${C_LNK}) AND id in (${targets.join(',')})`)).ids ?? []);
      const ok = present ? targets.every((x) => got.has(x)) : targets.every((x) => !got.has(x));
      if (ok) {
        const r = { changes: pairs.length, spreadSeconds: spread, lastChangeToVisibleSeconds: round(Date.now() - tLast) };
        log(`burst ${label}: ${JSON.stringify(r)}`);
        return r;
      }
      if (Date.now() - tLast > TIMEOUT_MS) return { changes: pairs.length, spreadSeconds: spread, lastChangeToVisibleSeconds: null, seen: got.size };
      await sleep(POLL_MS);
    }
  };
  const created = await run('create', ([from, to]) => api('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, outwardIssue: { id: from }, inwardIssue: { id: to } }), true);
  const linkIds = await pool(pairs, 8, ([from, to]) => linkId(from, to));
  let k = 0;
  const deleted = await run('delete', () => api('DELETE', `/rest/api/3/issueLink/${linkIds[k++]}`), false);
  await save('burst', { created, deleted });
  return { created, deleted };
}

/* ---------------------------------------------------------------- forge */

function forgeStats(sinceIso) {
  const out = execFileSync('forge', ['logs', '-e', 'development', '-n', '10000', '--since', sinceIso], { cwd: APP, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const lines = out.split('\n');
  const acc = {};
  let timeouts = 0;
  for (const line of lines) {
    if (/timed out/.test(line)) timeouts += 1;
    const m = line.match(/\{"jg5".*\}$/);
    if (!m) continue;
    const j = JSON.parse(m[0]);
    const a = (acc[j.jg5] ??= { invocations: 0, restCalls: 0, ms: [] });
    a.invocations += 1;
    a.restCalls += j.calls;
    a.ms.push(j.ms);
  }
  return {
    since: sinceIso,
    timeouts,
    kinds: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { invocations: v.invocations, restCalls: v.restCalls, msP50: pct(v.ms, 50), msP90: pct(v.ms, 90), msMax: Math.max(...v.ms) }])),
  };
}

async function main() {
  const since = new Date().toISOString();
  const out = {};
  if (['all', 'cold'].includes(args.phase)) out.cold = await cold();
  if (['all', 'fanout'].includes(args.phase)) out.fanout = await fanout();
  if (['all', 'latency'].includes(args.phase)) out.latency = (await latency()).summary;
  if (['all', 'burst'].includes(args.phase)) out.burst = await burst();
  if (['all', 'forge'].includes(args.phase)) {
    const f = forgeStats(args.since ? new Date(args.since).toISOString() : since);
    await save('forge', f);
    out.forge = f;
  }
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
