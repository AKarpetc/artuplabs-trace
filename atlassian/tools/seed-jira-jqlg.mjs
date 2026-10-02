#!/usr/bin/env node
/**
 * Seeds the JQLG project on artuplabs-dev for the ArtUp Query J-G5 measurement
 * (atlassian/25_app5_jql.md §3): 40 000 issues which, with the 10 000 of RPT, make 50 000 on the site.
 *
 * Shape (indices are in the summary prefix, so the run is resumable):
 *   E0000…E0399   400 epics
 *   T00000…T15599 15 600 tasks/stories/bugs, parent = epic E(i % 400)
 *     T0…T799     label jg-big   — 15 subtasks each (12 000)
 *     T800…T949   label jg-mid   —  8 subtasks each  (1 200)
 *     T950…T4549  label jg-small —  3 subtasks each (10 800)
 *     T5000…T5299 label jg-lnk   —  5 links each to T6000…T7499 (1 500 linked issues)
 *   S00000…S23999 24 000 subtasks
 *   links: jg-lnk (Relates/Blocks/Duplicates/Cloners in turn) + 2 500 random among T7500…T15599
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/seed-jira-jqlg.mjs [--limit 40000] [--concurrency 4]
 * --limit caps the number of issues created in total (epics + tasks + subtasks), for a partial run.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://artuplabs-dev.atlassian.net';
const KEY = 'JQLG';
const EPICS = 400;
const TASKS = 15600;
const LINK_TYPES = ['Relates', 'Blocks', 'Duplicate', 'Cloners'];
const RANDOM_LINKS = 2500;

const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { requests: 0, retries: 0 };

async function api(method, path, body) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    stats.requests += 1;
    const res = await fetch(`${SITE}${path}`, {
      method,
      headers: { Authorization: auth(), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      stats.retries += 1;
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 400)}`);
    const raw = await res.text();
    return raw ? JSON.parse(raw) : null;
  }
  throw new Error(`${method} ${path} → gave up`);
}

async function pool(n, concurrency, task, label) {
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < n) {
      const i = next++;
      await task(i);
      done += 1;
      if (done % 50 === 0 || done === n) process.stderr.write(`  ${label} ${done}/${n} ${Math.round((Date.now() - t0) / 1000)} s\n`);
    }
  }));
}

function subtaskParent(j) {
  if (j < 12000) return Math.floor(j / 15);
  if (j < 13200) return 800 + Math.floor((j - 12000) / 8);
  return 950 + Math.floor((j - 13200) / 3);
}

function taskLabels(i) {
  const out = ['jg', 'jg-task'];
  if (i < 800) out.push('jg-big');
  else if (i < 950) out.push('jg-mid');
  else if (i < 4550) out.push('jg-small');
  if (i >= 5000 && i < 5300) out.push('jg-lnk');
  return out;
}

async function ensureProject() {
  const found = await api('GET', `/rest/api/3/project/search?keys=${KEY}`);
  if (found.values.length) return found.values[0];
  const me = await api('GET', '/rest/api/3/myself');
  await api('POST', '/rest/api/3/project', {
    key: KEY,
    name: 'JQL Gate',
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    leadAccountId: me.accountId,
  });
  return (await api('GET', `/rest/api/3/project/search?keys=${KEY}`)).values[0];
}

/** Map index → {id, key, links:Set<key>} for issues whose summary starts with the prefix letter. */
async function existing(prefix, withLinks = false) {
  const map = new Map();
  let nextPageToken;
  do {
    const page = await api('POST', '/rest/api/3/search/jql', {
      jql: `project = ${KEY} AND labels = ${{ E: 'jg-epic', T: 'jg-task', S: 'jg-sub' }[prefix]} ORDER BY created ASC`,
      fields: withLinks ? ['summary', 'issuelinks'] : ['summary'],
      maxResults: withLinks ? 100 : 5000,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    for (const x of page.issues) {
      const m = /^([EST])(\d+)\b/.exec(x.fields.summary);
      if (!m || m[1] !== prefix) continue;
      const links = new Set();
      for (const l of x.fields.issuelinks ?? []) links.add((l.outwardIssue ?? l.inwardIssue).key);
      map.set(Number(m[2]), { id: x.id, key: x.key, links });
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return map;
}

const budget = { left: Infinity, concurrency: 4 };

async function createMissing(label, total, have, build) {
  const missing = [];
  for (let i = 0; i < total; i += 1) if (!have.has(i)) missing.push(i);
  const todo = missing.slice(0, Math.max(0, budget.left));
  budget.left -= todo.length;
  process.stderr.write(`${label}: have ${have.size}, creating ${todo.length}\n`);
  const batches = [];
  for (let i = 0; i < todo.length; i += 50) batches.push(todo.slice(i, i + 50));
  const t0 = Date.now();
  await pool(batches.length, budget.concurrency, async (b) => {
    const res = await api('POST', '/rest/api/3/issue/bulk', { issueUpdates: batches[b].map(build) });
    if (res.errors?.length) throw new Error(`${label} bulk errors: ${JSON.stringify(res.errors).slice(0, 400)}`);
  }, label);
  return { created: todo.length, seconds: Math.round((Date.now() - t0) / 1000) };
}

async function main() {
  const args = { limit: 40000 };
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = Number(process.argv[i + 1]);
  budget.left = args.limit;
  if (args.concurrency) budget.concurrency = args.concurrency;
  const t0 = Date.now();
  const project = await ensureProject();
  const types = await api('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`);
  const epicType = types.find((t) => t.name === 'Epic' || t.hierarchyLevel === 1);
  const subType = types.find((t) => t.subtask);
  const stdTypes = types.filter((t) => !t.subtask && t.hierarchyLevel === 0 && ['Task', 'Story', 'Bug'].includes(t.name));
  const linkTypes = (await api('GET', '/rest/api/3/issueLinkType')).issueLinkTypes.map((t) => t.name);
  const useLinks = LINK_TYPES.map((n) => linkTypes.find((t) => t.toLowerCase().startsWith(n.toLowerCase()))).filter(Boolean);
  process.stderr.write(`types: epic ${epicType?.name}, sub ${subType?.name}, std ${stdTypes.map((t) => t.name)}; links ${useLinks}\n`);
  const report = { date: new Date().toISOString(), project: KEY, phases: {} };
  const fields = (summary, typeId, extra) => ({ fields: { project: { id: project.id }, issuetype: { id: typeId }, summary, ...extra } });

  const epics = await existing('E');
  report.phases.epics = await createMissing('epics', EPICS, epics, (i) =>
    fields(`E${String(i).padStart(4, '0')} epic ${i}`, epicType.id, { labels: ['jg', 'jg-epic'] }));
  const epics2 = await existing('E');

  const tasks = await existing('T');
  report.phases.tasks = await createMissing('tasks', TASKS, tasks, (i) =>
    fields(`T${String(i).padStart(5, '0')} task ${i}`, stdTypes[i % stdTypes.length].id, {
      labels: taskLabels(i), ...(epics2.has(i % EPICS) ? { parent: { key: epics2.get(i % EPICS).key } } : {}),
    }));
  const tasks2 = await existing('T');

  const subs = await existing('S');
  for (let j = 0; j < 24000; j += 1) if (!tasks2.has(subtaskParent(j))) subs.set(j, null);
  report.phases.subtasks = await createMissing('subtasks', 24000, subs, (j) =>
    fields(`S${String(j).padStart(5, '0')} sub ${j}`, subType.id, { labels: ['jg', 'jg-sub'], parent: { key: tasks2.get(subtaskParent(j)).key } }));

  const withLinks = await existing('T', true);
  const plan = [];
  for (let k = 0; k < 300; k += 1) {
    for (let m = 0; m < 5; m += 1) plan.push([5000 + k, 6000 + k * 5 + m, useLinks[(k + m) % useLinks.length]]);
  }
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let r = 0; r < RANDOM_LINKS; r += 1) plan.push([7500 + (rnd() % 8100), 7500 + (rnd() % 8100), useLinks[r % useLinks.length]]);
  const todo = plan.filter(([a, b]) => a !== b && withLinks.has(a) && withLinks.has(b) && !withLinks.get(a).links.has(withLinks.get(b).key));
  process.stderr.write(`links: planned ${plan.length}, creating ${todo.length}\n`);
  const tl = Date.now();
  await pool(todo.length, 8, async (i) => {
    const [a, b, type] = todo[i];
    await api('POST', '/rest/api/3/issueLink', { type: { name: type }, outwardIssue: { key: withLinks.get(a).key }, inwardIssue: { key: withLinks.get(b).key } });
  }, 'links');
  report.phases.links = { created: todo.length, seconds: Math.round((Date.now() - tl) / 1000) };

  report.counts = {
    jqlg: (await api('POST', '/rest/api/3/search/approximate-count', { jql: `project = ${KEY}` })).count,
    site: (await api('POST', '/rest/api/3/search/approximate-count', { jql: 'created >= "2000-01-01"' })).count,
  };
  report.seconds = Math.round((Date.now() - t0) / 1000);
  report.requests = stats;
  await writeFile(join(HERE, '..', 'data', 'jg5-seed.json'), JSON.stringify(report, null, 1));
  process.stderr.write(`done in ${report.seconds} s: ${JSON.stringify(report.counts)}\n`);
}

main().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
