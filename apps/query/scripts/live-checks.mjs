#!/usr/bin/env node
/**
 * Read-only live checks against the dev site for ArtUp Query.
 *
 *   changelog  limits of POST /rest/api/3/changelog/bulkfetch (1 000 vs 1 001 ids), a 5 000-issue walk,
 *              and the fixture test/fixtures/changelog-bulkfetch.json (JQLG-1…3, texts removed);
 *              with --keys K1,K2,K3 --roles r1,r2,r3 --sprint <id> --closed-at <ms> the fixture holds
 *              only those three issues (Sprint field only) plus sprintFieldId, sprintId, closedAt, roles;
 *   linktype   issueLinkType = "<outward>" / "<inward>" on project in (JQLG, RPT) against a reference
 *              built from issue/bulkfetch issuelinks over every issue of both projects;
 *   agile      boards of the site and the sprint fields of the first scrum board.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node apps/query/scripts/live-checks.mjs changelog [--keys K1,K2,K3 --roles r1,r2,r3 --sprint 12 --closed-at 1759500000000]
 *   node apps/query/scripts/live-checks.mjs linktype
 *   node apps/query/scripts/live-checks.mjs agile
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://artuplabs-dev.atlassian.net';
const MAX_ATTEMPTS = 8;
const TIMEOUT_MS = 30000;
const SEARCH_PAGE = 5000;
const CHANGELOG_BATCH = 1000;
const WALK_ISSUES = 5000;
const BULK_ISSUES = 100;
const BULK_CONCURRENCY = 8;
const SPRINT_SCHEMA = 'com.pyxis.greenhopper.jira:gh-sprint';
const FIXTURE_KEYS = ['JQLG-1', 'JQLG-2', 'JQLG-3'];
const FIXTURE = fileURLToPath(new URL('../test/fixtures/changelog-bulkfetch.json', import.meta.url));

const stats = { requests: 0, retries: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);
const out = (s) => process.stdout.write(`${s}\n`);

/** Basic auth header from FORGE_EMAIL / FORGE_API_TOKEN. */
function authHeader() {
  const email = process.env.FORGE_EMAIL;
  const token = process.env.FORGE_API_TOKEN;
  if (!email || !token) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

/**
 * Calls Jira REST, retrying network errors, 429 and 5xx up to 8 times.
 * Returns parsed JSON, or { status, text } when `raw` is set.
 */
async function api(method, path, body, { raw = false } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    stats.requests += 1;
    let res;
    try {
      res = await fetch(`${SITE}${path}`, {
        method,
        headers: {
          Authorization: authHeader(),
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      stats.retries += 1;
      log(`network ${method} ${path}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      stats.retries += 1;
      log(`${res.status} ${method} ${path}, retry ${attempt}`);
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (raw) return { status: res.status, text };
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path} → gave up after ${MAX_ATTEMPTS} attempts`);
}

/** Runs `task` over `items` with at most `concurrency` in flight; keeps the order. */
async function pool(items, concurrency, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await task(items[i], i);
    }
  }));
  return results;
}

/** Splits a list into chunks of `size`. */
function chunks(list, size) {
  const result = [];
  for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
  return result;
}

/** Issue ids for a JQL via search/jql, at most `limit`. */
async function searchIds(jql, limit = Infinity) {
  const ids = [];
  let nextPageToken;
  do {
    const maxResults = Math.min(SEARCH_PAGE, limit - ids.length);
    const page = await api('POST', '/rest/api/3/search/jql', {
      jql,
      fields: ['id'],
      maxResults,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    ids.push(...page.issues.map((x) => x.id));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && ids.length < limit);
  return ids.slice(0, limit);
}

/** Id of the Sprint custom field from GET /rest/api/3/field. */
async function sprintFieldId() {
  const fields = await api('GET', '/rest/api/3/field');
  const field = fields.find((f) => f.schema?.custom === SPRINT_SCHEMA);
  if (!field) throw new Error('Sprint field not found');
  return field.id;
}

/** One raw changelog/bulkfetch call. */
function changelogPage(issueIdsOrKeys, fieldIds, nextPageToken) {
  return api('POST', '/rest/api/3/changelog/bulkfetch', {
    issueIdsOrKeys,
    fieldIds,
    ...(nextPageToken ? { nextPageToken } : {}),
  }, { raw: true });
}

/** Every changelog page for the issues, merged by issueId; counts the requests made. */
async function changelogAll(issueIdsOrKeys, fieldIds) {
  const byIssue = new Map();
  let requests = 0;
  let nextPageToken;
  do {
    const r = await changelogPage(issueIdsOrKeys, fieldIds, nextPageToken);
    requests += 1;
    if (r.status !== 200) throw new Error(`changelog/bulkfetch → ${r.status} ${r.text.slice(0, 300)}`);
    const page = JSON.parse(r.text);
    for (const entry of page.issueChangeLogs ?? []) {
      const prev = byIssue.get(entry.issueId) ?? [];
      byIssue.set(entry.issueId, prev.concat(entry.changeHistories ?? []));
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  const issueChangeLogs = [...byIssue].map(([issueId, changeHistories]) => ({ issueId, changeHistories }));
  return { issueChangeLogs, requests };
}

/** Changelog without texts: only issueId, history id, created and items field/fieldId/from/to. */
function stripTexts(issueChangeLogs) {
  return issueChangeLogs.map(({ issueId, changeHistories }) => ({
    issueId,
    changeHistories: changeHistories.map((h) => ({
      id: h.id,
      created: h.created,
      items: (h.items ?? []).map((it) => ({ field: it.field, fieldId: it.fieldId, from: it.from, to: it.to })),
    })),
  }));
}

/** Prints status, history count, nextPageToken presence and the type of `created` for one call. */
function describePage(label, r) {
  if (r.status !== 200) {
    out(`${label}: status ${r.status} | ${r.text.slice(0, 300)}`);
    return;
  }
  const page = JSON.parse(r.text);
  const logs = page.issueChangeLogs ?? [];
  const histories = logs.reduce((n, l) => n + (l.changeHistories?.length ?? 0), 0);
  const sample = logs.flatMap((l) => l.changeHistories ?? [])[0];
  const createdType = sample ? `${typeof sample.created} (${JSON.stringify(sample.created)})` : 'n/a';
  out(`${label}: status ${r.status} | issues ${logs.length} | histories ${histories} | nextPageToken ${page.nextPageToken ? 'yes' : 'no'} | created ${createdType}`);
  out(`${label}: response keys ${Object.keys(page).join(', ')}`);
}

/** Maps keys to issue ids in the given order via issue/bulkfetch. */
async function idsForKeys(keys) {
  const page = await api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: keys, fields: ['summary'] });
  const byKey = new Map(page.issues.map((x) => [x.key, x.id]));
  return keys.map((k) => {
    if (!byKey.has(k)) throw new Error(`issue ${k} not found`);
    return byKey.get(k);
  });
}

/** Writes the changelog fixture and prints its size. */
function writeFixture(content) {
  writeFileSync(FIXTURE, `${JSON.stringify(content, null, 2)}\n`);
  const histories = content.issueChangeLogs.reduce((n, l) => n + l.changeHistories.length, 0);
  out(`fixture: ${FIXTURE} | issues ${content.issueChangeLogs.length} | histories ${histories}`);
}

/** Fixture for three seeded sprint issues with their roles. */
async function seededFixture(flags, sprintField) {
  const keys = flags.keys.split(',');
  const roles = (flags.roles ?? '').split(',');
  if (keys.length !== 3 || roles.length !== 3) throw new Error('--keys and --roles need three comma-separated values');
  if (!/^\d+$/.test(flags.sprint ?? '')) throw new Error('--sprint needs a numeric sprint id');
  if (!/^\d+$/.test(flags['closed-at'] ?? '')) throw new Error('--closed-at needs epoch milliseconds');
  const ids = await idsForKeys(keys);
  const { issueChangeLogs } = await changelogAll(ids, [sprintField]);
  const sprintId = Number(flags.sprint);
  writeFixture({
    sprintFieldId: sprintField,
    sprintId,
    closedAt: Number(flags['closed-at']),
    roles: Object.fromEntries(ids.map((id, i) => [id, roles[i]])),
    issueChangeLogs: stripTexts(issueChangeLogs),
  });
}

/** changelog command: limits, a 5 000-issue walk and the fixture. */
async function changelog(flags) {
  const sprintField = await sprintFieldId();
  out(`sprint field: ${sprintField}`);
  if (flags.keys) {
    await seededFixture(flags, sprintField);
    return;
  }
  const fieldIds = [sprintField, 'status'];
  const first = await searchIds('project = JQLG ORDER BY id', CHANGELOG_BATCH + 1);
  out(`ids fetched: ${first.length}`);
  describePage(`bulkfetch ${CHANGELOG_BATCH} ids`, await changelogPage(first.slice(0, CHANGELOG_BATCH), fieldIds));
  describePage(`bulkfetch ${first.length} ids`, await changelogPage(first, fieldIds));

  const walkIds = await searchIds('project = JQLG ORDER BY id', WALK_ISSUES);
  const started = Date.now();
  let requests = 0;
  let issues = 0;
  let histories = 0;
  for (const batch of chunks(walkIds, CHANGELOG_BATCH)) {
    const r = await changelogAll(batch, fieldIds);
    requests += r.requests;
    issues += r.issueChangeLogs.length;
    histories += r.issueChangeLogs.reduce((n, l) => n + l.changeHistories.length, 0);
  }
  const seconds = (Date.now() - started) / 1000;
  out(`walk: issues ${walkIds.length} | with changes ${issues} | histories ${histories} | requests ${requests} | seconds ${seconds.toFixed(1)}`);
  out(`walk: estimate for 50 000 issues (reference only) ~${((seconds * 50000) / walkIds.length).toFixed(0)} s, ~${Math.ceil((requests * 50000) / walkIds.length)} requests`);

  const { issueChangeLogs } = await changelogAll(FIXTURE_KEYS, fieldIds);
  writeFixture({ issueChangeLogs: stripTexts(issueChangeLogs) });
}

/** Escapes a value for a double-quoted JQL string. */
function jqlString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Issue ids per link type and direction from issue/bulkfetch issuelinks over all given issues. */
async function linkReference(allIds) {
  const pages = await pool(chunks(allIds, BULK_ISSUES), BULK_CONCURRENCY, (c) =>
    api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: c, fields: ['issuelinks'] }));
  const ref = new Map();
  const add = (typeId, dir, issueId) => {
    const key = `${typeId}:${dir}`;
    if (!ref.has(key)) ref.set(key, new Set());
    ref.get(key).add(issueId);
  };
  for (const page of pages) {
    for (const issue of page.issues) {
      for (const link of issue.fields.issuelinks ?? []) {
        if (link.outwardIssue) add(link.type.id, 'outward', issue.id);
        if (link.inwardIssue) add(link.type.id, 'inward', issue.id);
      }
    }
  }
  return ref;
}

/** Counts a JQL; returns the id set or the Jira error text. */
async function jqlSet(jql) {
  try {
    return { ids: new Set(await searchIds(jql)) };
  } catch (e) {
    return { error: e.message };
  }
}

/** Formats `n/ref` with the size of the symmetric difference when the sets differ. */
function compare(result, ref) {
  if (result.error) return `error/${ref.size} (${result.error.slice(0, 120)})`;
  const missing = [...ref].filter((id) => !result.ids.has(id)).length;
  const extra = [...result.ids].filter((id) => !ref.has(id)).length;
  const diff = missing || extra ? ` (missing ${missing}, extra ${extra})` : '';
  return `${result.ids.size}/${ref.size}${diff}`;
}

/** linktype command: issueLinkType JQL against the bulkfetch reference. */
async function linktype() {
  const scope = 'project in (JQLG, RPT)';
  const { issueLinkTypes } = await api('GET', '/rest/api/3/issueLinkType');
  out(`link types: ${issueLinkTypes.length}`);
  const allIds = await searchIds(scope);
  out(`issues in ${scope}: ${allIds.length}`);
  const ref = await linkReference(allIds);
  const empty = new Set();
  let matched = true;
  out('type | outward n/ref | inward n/ref');
  for (const t of issueLinkTypes) {
    const outRef = ref.get(`${t.id}:outward`) ?? empty;
    const inRef = ref.get(`${t.id}:inward`) ?? empty;
    const same = t.outward === t.inward;
    const outwardRef = same ? new Set([...outRef, ...inRef]) : outRef;
    const inwardRef = same ? outwardRef : inRef;
    const outResult = await jqlSet(`${scope} AND issueLinkType = ${jqlString(t.outward)}`);
    const inResult = same ? outResult : await jqlSet(`${scope} AND issueLinkType = ${jqlString(t.inward)}`);
    const outCell = compare(outResult, outwardRef);
    const inCell = compare(inResult, inwardRef);
    if (!/^\d+\/\d+$/.test(outCell) || !/^\d+\/\d+$/.test(inCell)) matched = false;
    if (outResult.ids && outResult.ids.size !== outwardRef.size) matched = false;
    if (inResult.ids && inResult.ids.size !== inwardRef.size) matched = false;
    out(`${t.name} (${t.outward} / ${t.inward}) | outward ${outCell} | inward ${inCell}`);
  }
  out(`all match reference: ${matched ? 'yes' : 'no'}`);
}

/** All boards of the site via the Agile API. */
async function boards() {
  const result = [];
  let startAt = 0;
  for (;;) {
    const page = await api('GET', `/rest/agile/1.0/board?startAt=${startAt}&maxResults=50`);
    result.push(...page.values);
    if (page.isLast || page.values.length === 0) return result;
    startAt += page.values.length;
  }
}

/** All sprints of a board via the Agile API. */
async function sprints(boardId) {
  const result = [];
  let startAt = 0;
  for (;;) {
    const page = await api('GET', `/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=50`);
    result.push(...page.values);
    if (page.isLast || page.values.length === 0) return result;
    startAt += page.values.length;
  }
}

/**
 * agile command: boards, then sprints of every scrum board (the first one may hold only future
 * sprints, which carry no start fields); prints the union of sprint field names and one sample per state.
 */
async function agile() {
  const list = await boards();
  out(`boards: ${list.length}`);
  for (const b of list) out(`board ${b.id} | ${b.type} | ${b.name} | ${b.location?.projectKey ?? '-'}`);
  const scrumBoards = list.filter((b) => b.type === 'scrum');
  if (scrumBoards.length === 0) {
    out('no scrum board');
    return;
  }
  const items = [];
  for (const b of scrumBoards) {
    const boardSprints = await sprints(b.id);
    const states = [...new Set(boardSprints.map((s) => s.state))].join(', ') || '-';
    out(`scrum board ${b.id}: sprints ${boardSprints.length} | states ${states}`);
    items.push(...boardSprints);
  }
  const names = [...new Set(items.flatMap((s) => Object.keys(s)))].sort();
  out(`sprint fields: ${names.join(', ')}`);
  out(`activatedDate present: ${names.includes('activatedDate') ? 'yes' : 'no'}`);
  const byState = new Map();
  for (const s of items) if (!byState.has(s.state)) byState.set(s.state, s);
  for (const s of byState.values()) out(`sample ${s.state}: ${JSON.stringify(s)}`);
}

/** Parses `<command> --flag value …`. */
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [name, value] = [rest[i], rest[i + 1]];
    if (!name.startsWith('--')) throw new Error(`expected a --flag, got "${name}"`);
    if (value === undefined || value.startsWith('--')) throw new Error(`flag ${name} needs a value`);
    flags[name.slice(2)] = value;
  }
  return { command, flags };
}

const COMMANDS = { changelog, linktype, agile };

/** Entry point. */
async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const run = COMMANDS[command];
  if (!run) throw new Error(`usage: live-checks.mjs ${Object.keys(COMMANDS).join('|')} [flags]`);
  await run(flags);
  out(`requests ${stats.requests} | retries ${stats.retries}`);
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e.message}\n`);
  process.exit(1);
});
