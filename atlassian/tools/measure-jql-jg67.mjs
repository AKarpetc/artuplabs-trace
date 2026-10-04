#!/usr/bin/env node
/**
 * J-G6 (sprint history) and J-G7 (comments, attachments) measurement for ArtUp Query (plan 2026-10-03-artup-query-v1,
 * Task 19). Runs against the prototype atlassian/tools/j-g67-index (development, installed on artuplabs-dev), the
 * seeded sprints (atlassian/data/jg6-seed.json) and comments/attachments (atlassian/data/jg7-seed.json).
 *
 * Phases (--phase):
 *   backfill --part sprint|comments  start the prototype's backfill through its webtrigger, poll progress every 30 s
 *                                    until finishedAt: minutes, done, total
 *   sprint-reference                 g6AddedAfterSprintStart of every closed seeded sprint against reference A (seed:
 *                                    added + readded) and reference B (REST changelog: Sprint field adds after startDate,
 *                                    not after completeDate); the gate counts B, A vs B is the `seeder-check` line
 *   sprint-latency --n 30            move a jg-sprint issue without a sprint into the active JQLG S31, wait until the
 *                                    function sees it
 *   comment-latency --n 30           comment "probe N" on a jg-mid issue, wait in g7Commented("by <me> after <today>")
 *   comment-complete                 g7Commented("by <me> after 2020-01-01 ids <lo>..<hi>") against a bulkfetch reference,
 *                                    in issue-id windows of at most 800 reference issues (Jira's limit is 1000 values per
 *                                    function result); per-window counts, sums, the union and the index comment count
 *   attachment-latency --n 30        attach probe-<N>.jg7 to a jg-mid issue without one, wait in g7HasAttachments("jg7")
 *   attachment-complete              g7HasAttachments(xlsx|pdf|png|txt|docx) against a bulkfetch reference
 *
 * Sprint start is `startDate` (the site's Agile API returns no activatedDate). Seed moves recorded with `at: null`
 * (applied right before a seeding failure) are kept as members of their list. Restricted comments: jg7-seed.json
 * `roleUsable`/`groupUsable` false (Jira Free) → reported as "not testable on dev", outside the denominator.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/measure-jql-jg67.mjs --phase <phase> [--part sprint|comments] [--url <webtrigger>] [--n 30]
 * --url defaults to the first line of atlassian/data/jg67-webtrigger.txt (gitignored; written after `forge webtrigger`).
 * Every phase but backfill also uses the webtrigger: `evaluate` (the function's own answer, so an error fails fast instead
 * of reading as an empty result) and, before a completeness phase, `recompute` (stored precomputations follow the index).
 * A latency phase stops when its first change is not seen within 10 minutes (`aborted`, exit 1).
 * Writes atlassian/data/jg67-<phase>.json (backfill: jg67-backfill-<part>.json).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, bulk, ids, pool, sleep, stats, write, SITE } from '../../apps/query/scripts/lib/http.mjs';
import { waitFor } from '../../apps/query/scripts/lib/latency.mjs';
import { compare, summary } from '../../apps/query/scripts/lib/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const BOARD = 'JQLG board';
const ACTIVE = 'JQLG S31';
const ALL = 'project in (JQLG, RPT)';
const EXTS = ['xlsx', 'pdf', 'png', 'txt', 'docx'];
const PHASES = ['backfill', 'sprint-reference', 'sprint-latency', 'comment-latency', 'comment-complete', 'attachment-latency', 'attachment-complete'];

const args = { phase: '', n: 30 };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  args[k] = k === 'n' ? Number(process.argv[i + 1]) : process.argv[i + 1];
}

const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);
const round = (ms) => Math.round(ms / 100) / 10;
const readJson = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function save(name, data) {
  mkdirSync(DATA, { recursive: true });
  const path = join(DATA, `${name}.json`);
  writeFileSync(path, JSON.stringify({ date: new Date().toISOString(), ...data, requests: stats.requests, retries: stats.retries }, null, 1));
  return path;
}

function webtrigger() {
  if (args.url) return args.url;
  try {
    return readFileSync(join(DATA, 'jg67-webtrigger.txt'), 'utf8').split('\n')[0].trim();
  } catch {
    throw new Error('no --url and no atlassian/data/jg67-webtrigger.txt');
  }
}

async function control(query) {
  const res = await fetch(`${webtrigger()}?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`webtrigger ${query.action} → ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** The function's own answer through the webtrigger (`{ jql }` or `{ error }`): REST search hides errors as an empty 200. */
async function evaluate(fn, fnArgs) {
  const q = new URLSearchParams({ action: 'evaluate', fn });
  for (const a of fnArgs) q.append('arg', a);
  return (await control(q)).result;
}

/** Throws when the function answers an error for these arguments, so a phase never polls 10 minutes per change for nothing. */
async function assertFn(fn, fnArgs) {
  const r = await evaluate(fn, fnArgs);
  if (r?.error || !r?.jql) throw new Error(`${fn}(${fnArgs.join(', ')}) answers an error: ${r?.error ?? JSON.stringify(r)}`);
  return r;
}

/** Recomputes every stored precomputation of the app so a search reads the current index, not a snapshot. */
async function recompute() {
  const r = (await control({ action: 'recompute' })).recompute;
  log(`recompute: ${JSON.stringify(r)}`);
  return r;
}

/** Warms a clause: the function must answer without an error and the search must succeed. */
async function warm(fn, fnArgs, clause) {
  await assertFn(fn, fnArgs);
  const r = await ids(clause);
  if (r.error) throw new Error(`warm ${clause}: ${r.error}`);
  log(`warm ${clause}: ${r.ids.length}`);
}

/** Ids of a JQL or throw with Jira's answer. */
async function idsOf(jql) {
  const r = await ids(jql);
  if (r.error) throw new Error(`${jql}: ${r.error}`);
  return r.ids;
}

/** key → id for a list of keys (bulkfetch accepts keys). */
async function keyIds(keys) {
  const found = await bulk([...new Set(keys)], ['summary']);
  const map = new Map(found.map((x) => [x.key, String(x.id)]));
  const unresolved = [...new Set(keys)].filter((k) => !map.has(k));
  if (unresolved.length) throw new Error(`keys that do not resolve: ${unresolved.join(', ')}`);
  return map;
}

// ---------- backfill ----------

async function backfill() {
  const { part } = args;
  if (!['sprint', 'comments'].includes(part)) throw new Error('--part sprint|comments');
  const t0 = Date.now();
  log(`start ${part}: ${JSON.stringify(await control({ action: 'start', part }))}`);
  let p;
  for (;;) {
    await sleep(30000);
    p = (await control({ action: 'progress' }))[part];
    log(`${part}: ${p?.done}/${p?.total}${p?.finishedAt ? ' finished' : ''}`);
    if (p?.finishedAt) break;
    if (Date.now() - t0 > 6 * 3600 * 1000) throw new Error('backfill did not finish within 6 h');
  }
  const minutes = Math.round((p.finishedAt - p.startedAt) / 600) / 100;
  // total is approximate-count; done counts the issues the pass walked.
  const covered = p.done >= p.total;
  if (!covered) log(`backfill ${part}: done ${p.done} < total ${p.total}`);
  if (p.unparsable?.n) log(`backfill ${part}: ${p.unparsable.n} unparseable timestamps skipped, e.g. ${p.unparsable.samples.join(' | ')}`);
  return { name: `jg67-backfill-${part}`, data: { part, minutes, done: p.done, total: p.total, covered, unparsable: p.unparsable ?? { n: 0, samples: [] }, recompute: p.recompute ?? null, startedAt: p.startedAt, finishedAt: p.finishedAt } };
}

// ---------- sprint ----------

async function sprintField() {
  return (await api('GET', '/rest/api/3/field')).find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint').id;
}

async function changelog(key) {
  const out = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await api('GET', `/rest/api/3/issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
    out.push(...page.values);
    if (page.isLast || !page.values.length || out.length >= page.total) return out;
  }
}

const idSet = (v) => new Set(String(v ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)));

/** Reference B: issues whose changelog adds the sprint id after start and not after the close. */
async function referenceB(sprint, keys) {
  const start = ms(sprint.startDate);
  const end = sprint.completeDate ? ms(sprint.completeDate) : Number.MAX_SAFE_INTEGER;
  const sid = String(sprint.id);
  const hits = await pool(keys, 8, async (key) => {
    const histories = await changelog(key);
    return histories.some((h) => {
      const at = ms(h.created);
      return at > start && at <= end && (h.items ?? []).some((it) => it.field === 'Sprint' && idSet(it.to).has(sid) && !idSet(it.from).has(sid));
    }) ? key : null;
  });
  return hits.filter(Boolean);
}

async function sprintReference() {
  const seed = readJson('jg6-seed.json');
  const closed = (seed.sprints ?? []).filter((s) => s.closedAt || s.phase === 'closed');
  log(`closed seeded sprints: ${closed.length} (gate expects 30)`);
  await recompute();
  const rows = [];
  for (const rec of closed) {
    const sprint = await api('GET', `/rest/agile/1.0/sprint/${rec.id}`);
    const members = await idsOf(`sprint = ${rec.id}`);
    const memberKeys = (await bulk(members, ['summary'])).map((x) => x.key);
    const removedKeys = (rec.removed ?? []).map((m) => m.key);
    const candidateKeys = [...new Set([...memberKeys, ...removedKeys, ...(rec.added ?? []).map((m) => m.key), ...(rec.readded ?? []).map((m) => m.key)])];
    const refAKeys = [...new Set([...(rec.added ?? []), ...(rec.readded ?? [])].map((m) => m.key))];
    const refBKeys = await referenceB(sprint, candidateKeys);
    const byKey = await keyIds([...refAKeys, ...refBKeys]);
    const clause = `issue in g6AddedAfterSprintStart("${BOARD}", "${rec.name}")`;
    const own = await evaluate('g6AddedAfterSprintStart', [BOARD, rec.name]);
    if (own?.error) log(`function error ${rec.name}: ${own.error}`);
    const t0 = Date.now();
    const got = await idsOf(clause);
    const seconds = round(Date.now() - t0);
    const refA = refAKeys.map((k) => byKey.get(k));
    const refB = refBKeys.map((k) => byKey.get(k));
    const row = {
      sprint: rec.name,
      id: rec.id,
      startDate: sprint.startDate,
      completeDate: sprint.completeDate ?? null,
      seconds,
      functionError: own?.error ?? null,
      vsB: compare(got, refB),
      vsA: compare(got, refA),
      seederCheck: compare(refA, refB),
      nullTimes: [...(rec.added ?? []), ...(rec.removed ?? []), ...(rec.readded ?? [])].filter((m) => m.at === null).map((m) => m.key),
    };
    rows.push(row);
    log(`${rec.name}: vs B ${JSON.stringify(row.vsB)} | vs A complete=${row.vsA.complete}`);
    if (!row.seederCheck.complete) log(`seeder-check ${rec.name}: A ${refAKeys.join(',')} | B ${refBKeys.join(',')}`);
  }
  const completeB = rows.filter((r) => r.vsB.complete && !r.functionError).length;
  const seederMismatch = rows.filter((r) => !r.seederCheck.complete).map((r) => r.sprint);
  log(`gate J-G6 completeness: ${completeB} of ${rows.length} complete vs B (needs 30 of 30)`);
  log(`seeder-check: ${seederMismatch.length ? `A≠B in ${seederMismatch.join(', ')}` : 'A = B in every sprint'}`);
  return { name: 'jg67-sprint-reference', data: { sprints: rows.length, expected: 30, completeVsB: completeB, gatePass: rows.length === 30 && completeB === 30, seederCheck: { mismatched: seederMismatch }, rows } };
}

async function activeSprint() {
  const seed = readJson('jg6-seed.json');
  const board = seed.board ?? (await api('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(BOARD)}`)).values.find((b) => b.name === BOARD);
  for (let startAt = 0; ; startAt += 50) {
    const page = await api('GET', `/rest/agile/1.0/board/${board.id}/sprint?state=active&startAt=${startAt}&maxResults=50`);
    const s = page.values.find((x) => x.name === ACTIVE);
    if (s) return s;
    if (page.isLast || !page.values.length) throw new Error(`no active ${ACTIVE} on ${BOARD}`);
  }
}

async function sprintLatency() {
  const sprint = await activeSprint();
  const field = await sprintField();
  const clause = `issue in g6AddedAfterSprintStart("${BOARD}", "${ACTIVE}")`;
  await warm('g6AddedAfterSprintStart', [BOARD, ACTIVE], clause);
  const pool0 = await idsOf('project = JQLG AND labels = jg-sprint AND sprint is EMPTY ORDER BY key');
  if (pool0.length < args.n) throw new Error(`only ${pool0.length} jg-sprint issues without a sprint`);
  const inSprint = async (id) => {
    const x = await api('GET', `/rest/api/3/issue/${id}?fields=${field}`);
    return (x.fields[field] ?? []).some((s) => String(s.id) === String(sprint.id)) ? { applied: true } : null;
  };
  const raw = [];
  const skipped = [];
  let aborted = null;
  const t0 = Date.now();
  for (let i = 0, k = 0; raw.length < args.n && k < pool0.length; k += 1) {
    const id = pool0[k];
    if (await inSprint(id)) {
      log(`skip ${id}: already in ${ACTIVE}`);
      skipped.push(id);
      continue;
    }
    const t = Date.now();
    await write('POST', `/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: [id] }, () => inSprint(id), { raw: true });
    raw.push({ id, seconds: await waitFor(clause, id, true, t) });
    log(`sprint ${i}: ${id} ${raw.at(-1).seconds} s`);
    if (i === 0 && raw[0].seconds === null) {
      aborted = 'first change not seen within 10 min';
      break;
    }
    i += 1;
  }
  const seen = raw.map((r) => r.seconds).filter((s) => s !== null);
  return { name: 'jg67-sprint-latency', data: { requested: args.n, clause, sprint: ACTIVE, sprintId: sprint.id, aborted, seconds: round(Date.now() - t0), summary: { ...summary(seen), timeouts: raw.length - seen.length }, skipped, raw } };
}

// ---------- comments ----------

async function commentsOf(issues) {
  return pool(issues, 8, async (x) => {
    let comments = x.fields.comment?.comments ?? [];
    if ((x.fields.comment?.total ?? 0) > comments.length) {
      comments = [];
      for (let startAt = 0; ; startAt += 5000) {
        const page = await api('GET', `/rest/api/3/issue/${x.id}/comment?startAt=${startAt}&maxResults=5000`);
        comments.push(...page.comments);
        if (!page.comments.length || comments.length >= page.total) break;
      }
    }
    return { id: String(x.id), comments };
  });
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function commentLatency() {
  const me = (await api('GET', '/rest/api/3/myself')).accountId;
  const day = todayUtc();
  const dayMs = Date.parse(day);
  const clause = `issue in g7Commented("by ${me} after ${day}")`;
  await warm('g7Commented', [`by ${me} after ${day}`], clause);
  const mid = await idsOf('project = JQLG AND labels = jg-mid ORDER BY key');
  const withMine = new Set((await commentsOf(await bulk(mid, ['comment']))).filter((x) => x.comments.some((c) => c.author?.accountId === me && ms(c.created) > dayMs)).map((x) => x.id));
  const targets = mid.filter((id) => !withMine.has(id));
  if (targets.length < args.n) throw new Error(`only ${targets.length} jg-mid issues without a comment of mine today`);
  const run = Date.now().toString(36);
  const raw = [];
  let aborted = null;
  const t0 = Date.now();
  for (let i = 0; i < args.n; i += 1) {
    const id = targets[i];
    const text = `probe ${i} (${run})`;
    const posted = async () => {
      const page = await api('GET', `/rest/api/3/issue/${id}/comment?orderBy=-created&maxResults=20`);
      return page.comments.find((c) => JSON.stringify(c.body).includes(text)) ?? null;
    };
    const t = Date.now();
    await write('POST', `/rest/api/3/issue/${id}/comment`, { body: adf(text) }, posted);
    raw.push({ id, seconds: await waitFor(clause, id, true, t) });
    log(`comment ${i}: ${id} ${raw.at(-1).seconds} s`);
    if (i === 0 && raw[0].seconds === null) {
      aborted = 'first change not seen within 10 min';
      break;
    }
  }
  const seen = raw.map((r) => r.seconds).filter((s) => s !== null);
  return { name: 'jg67-comment-latency', data: { requested: args.n, clause, author: me, after: day, aborted, seconds: round(Date.now() - t0), summary: { ...summary(seen), timeouts: raw.length - seen.length }, raw } };
}

function restrictedNote() {
  let seed;
  try {
    seed = readJson('jg7-seed.json');
  } catch {
    return { note: 'jg7-seed.json missing' };
  }
  const c = seed.comments ?? {};
  const kind = (usable, n) => (usable ? { status: 'seeded', seeded: n ?? 0 } : { status: 'not testable on dev', excluded: true });
  return { role: kind(c.roleUsable, c.restrictedSeeded?.role), group: kind(c.groupUsable, c.restrictedSeeded?.group) };
}

/** Jira takes at most 1000 values per function result: windows hold at most this many reference issues. */
const SLICE = 800;

/**
 * Contiguous issue-id windows over every scoped issue (first from 0, last to MAX_SAFE_INTEGER, so an extra anywhere
 * falls into some window), each closed once it holds SLICE reference issues.
 */
function idWindows(allIds, refSet) {
  const sorted = [...allIds].map(Number).sort((a, b) => a - b);
  const out = [];
  let lo = 0;
  let n = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (refSet.has(String(sorted[i]))) n += 1;
    if (n === SLICE && i + 1 < sorted.length) {
      out.push([lo, sorted[i]]);
      lo = sorted[i] + 1;
      n = 0;
    }
  }
  out.push([lo, Number.MAX_SAFE_INTEGER]);
  return out;
}

async function commentComplete() {
  const me = (await api('GET', '/rest/api/3/myself')).accountId;
  const after = '2020-01-01';
  const afterMs = Date.parse(after);
  const all = await idsOf(ALL);
  log(`reference over ${all.length} issues`);
  const ref = (await commentsOf(await bulk(all, ['comment']))).filter((x) => x.comments.some((c) => c.author?.accountId === me && ms(c.created) > afterMs)).map((x) => x.id);
  const refSet = new Set(ref.map(String));
  const windows = idWindows(all, refSet);
  log(`reference ${ref.length} issues → ${windows.length} id windows of at most ${SLICE}`);
  await recompute();
  const slices = [];
  const gotAll = [];
  let seconds = 0;
  for (const [lo, hi] of windows) {
    const fnArg = `by ${me} after ${after} ids ${lo}..${hi}`;
    const clause = `issue in g7Commented("${fnArg}")`;
    const own = await evaluate('g7Commented', [fnArg]);
    if (own?.error) log(`function error ids ${lo}..${hi}: ${own.error}`);
    const t0 = Date.now();
    const got = await idsOf(clause);
    const s = round(Date.now() - t0);
    seconds += s;
    gotAll.push(...got);
    const sliceRef = ref.filter((id) => Number(id) >= lo && Number(id) <= hi);
    const c = compare(got, sliceRef);
    slices.push({ lo, hi, seconds: s, ...c, complete: c.complete && !own?.error, functionError: own?.error ?? null });
    log(`ids ${lo}..${hi}: ${JSON.stringify(slices.at(-1))}`);
  }
  const union = compare(gotAll, ref);
  const result = {
    count: slices.reduce((a, x) => a + x.count, 0),
    reference: ref.length,
    missing: slices.reduce((a, x) => a + x.missing, 0),
    extra: slices.reduce((a, x) => a + x.extra, 0),
    union,
    complete: slices.every((x) => x.complete) && union.complete,
    functionErrors: slices.filter((x) => x.functionError).length,
  };
  let index = null;
  try {
    index = (await control({ action: 'count' })).count;
  } catch (error) {
    log(`index count unavailable: ${error.message}`);
  }
  const restricted = restrictedNote();
  log(`g7Commented: ${JSON.stringify(result)}; index ${JSON.stringify(index)}; restricted: role ${restricted.role?.status}, group ${restricted.group?.status}`);
  return { name: 'jg67-comment-complete', data: { clause: `issue in g7Commented("by ${me} after ${after} ids <lo>..<hi>")`, author: me, after, issues: all.length, sliceLimit: SLICE, seconds: round(seconds * 1000), result, slices, index, restricted } };
}

// ---------- attachments ----------

const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;

/** Multipart upload; after a network error or a 5xx checks whether the file landed before sending again. */
async function attach(id, name, landed) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    stats.requests += 1;
    const form = new FormData();
    form.append('file', new Blob([`probe ${name}\n`], { type: 'text/plain' }), name);
    try {
      const res = await fetch(`${SITE}/rest/api/3/issue/${id}/attachments`, { method: 'POST', headers: { Authorization: auth(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }, body: form, signal: AbortSignal.timeout(60000) });
      if (res.ok) return;
      const text = await res.text();
      if (res.status < 500 && res.status !== 429) throw new Error(`attach ${id} ${name} → ${res.status} ${text.slice(0, 300)}`);
    } catch (error) {
      if (String(error.message).startsWith('attach ')) throw error;
    }
    stats.retries += 1;
    await sleep(3000);
    if (await landed()) return;
  }
  throw new Error(`attach ${id} ${name}: not applied after 4 attempts`);
}

const hasExt = (x, ext) => (x.fields.attachment ?? []).some((a) => String(a.filename).toLowerCase().endsWith(`.${ext}`));

async function attachmentLatency() {
  const clause = 'issue in g7HasAttachments("jg7")';
  await warm('g7HasAttachments', ['jg7'], clause);
  const mid = await idsOf('project = JQLG AND labels = jg-mid ORDER BY key');
  const issues = await bulk(mid, ['attachment']);
  const without = new Set(issues.filter((x) => !hasExt(x, 'jg7')).map((x) => String(x.id)));
  const targets = mid.filter((id) => without.has(id));
  if (targets.length < args.n) throw new Error(`only ${targets.length} jg-mid issues without a .jg7 attachment`);
  const raw = [];
  let aborted = null;
  const t0 = Date.now();
  for (let i = 0; i < args.n; i += 1) {
    const id = targets[i];
    const name = `probe-${i}.jg7`;
    const landed = async () => (await api('GET', `/rest/api/3/issue/${id}?fields=attachment`)).fields.attachment.some((a) => a.filename === name);
    const t = Date.now();
    await attach(id, name, landed);
    raw.push({ id, seconds: await waitFor(clause, id, true, t) });
    log(`attachment ${i}: ${id} ${raw.at(-1).seconds} s`);
    if (i === 0 && raw[0].seconds === null) {
      aborted = 'first change not seen within 10 min';
      break;
    }
  }
  const seen = raw.map((r) => r.seconds).filter((s) => s !== null);
  return { name: 'jg67-attachment-latency', data: { requested: args.n, clause, aborted, seconds: round(Date.now() - t0), summary: { ...summary(seen), timeouts: raw.length - seen.length }, raw } };
}

async function attachmentComplete() {
  const all = await idsOf(ALL);
  log(`reference over ${all.length} issues`);
  const issues = await bulk(all, ['attachment']);
  await recompute();
  const rows = [];
  for (const ext of EXTS) {
    const own = await evaluate('g7HasAttachments', [ext]);
    if (own?.error) log(`function error ${ext}: ${own.error}`);
    const t0 = Date.now();
    const got = await idsOf(`issue in g7HasAttachments("${ext}")`);
    const seconds = round(Date.now() - t0);
    const ref = issues.filter((x) => hasExt(x, ext)).map((x) => String(x.id));
    const c = compare(got, ref);
    rows.push({ ext, seconds, ...c, complete: c.complete && !own?.error, functionError: own?.error ?? null });
    log(`${ext}: ${JSON.stringify(rows.at(-1))}`);
  }
  return { name: 'jg67-attachment-complete', data: { issues: all.length, allComplete: rows.every((r) => r.complete), rows } };
}

// ---------- main ----------

const RUN = {
  backfill,
  'sprint-reference': sprintReference,
  'sprint-latency': sprintLatency,
  'comment-latency': commentLatency,
  'comment-complete': commentComplete,
  'attachment-latency': attachmentLatency,
  'attachment-complete': attachmentComplete,
};

async function main() {
  if (!RUN[args.phase]) throw new Error(`--phase ${PHASES.join('|')}`);
  if (!process.env.FORGE_EMAIL || !process.env.FORGE_API_TOKEN) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source .env)');
  const { name, data } = await RUN[args.phase]();
  log(`wrote ${save(name, { phase: args.phase, ...data })} (requests ${stats.requests}, retries ${stats.retries})`);
  if (data.aborted) throw new Error(`phase aborted: ${data.aborted}`);
}

main().catch((error) => {
  log(`failed: ${error.stack ?? error}`);
  process.exit(1);
});
