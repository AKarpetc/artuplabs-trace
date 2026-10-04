#!/usr/bin/env node
/**
 * Acceptance tool for ArtUp Query against the dev site; every request has a timeout, and a write that broke
 * is sent again only after a check that it was not applied.
 *
 *   complete  every case of a table against a reference built by REST traversal (--cases m1|m2, --board, --candidates, --tag)
 *   fresh     seconds until a change is visible and changes lost after 10 minutes (--group query|board|sprint, --n, --tag)
 *   seed-tm   a team-managed project JQLT with epics, stories and subtasks
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node apps/query/scripts/acceptance.mjs complete [--cases m1|m2] [--board "RPT board"] [--tag t]
 *   node apps/query/scripts/acceptance.mjs fresh [--group query|board|sprint] [--n 30] [--board "RPT board"] [--tag t]
 *   node apps/query/scripts/acceptance.mjs seed-tm
 */
import { readFileSync } from 'node:fs';
import { api, ids, settledIds, sleep, stats, UnsafeRetryError, write } from './lib/http.mjs';
import { latency, latencyResult, waitFor } from './lib/latency.mjs';
import { boardId, myAccountId, REFERENCES, sprintsOf } from './lib/reference.mjs';
import { compare, save } from './lib/report.mjs';

const args = { phase: process.argv[2], n: 30, tag: '', board: 'RPT board', group: 'query' };
for (let i = 3; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
args.n = Number(args.n);

const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const clause = (fn, userArgs) => `issue in ${fn}(${userArgs.map(q).join(', ')})`;
const tagged = (name) => `${name}${args.tag ? `-${args.tag}` : ''}`;

/** Completeness cases: function, user arguments, what the case proves, optional native JQL ANDed to the result. Later stages append their own. */
export const CASES = {
  m1: [
    ['subtasksOf', ['project = JQLG AND labels = jg-mid'], '1 200 subtasks (> 1 000)'],
    ['subtasksOf', ['project = JQLG AND labels = jg-big'], '12 000 subtasks (> 10 000)'],
    ['subtasksOf', ['filter = "JQLG mid"'], 'saved filter as the argument'],
    ['subtasksOf', ['key in (JQLG-1, JQLG-2, JQLG-3)'], 'list of keys as the argument'],
    ['subtasksOf', ['issue in linkedIssuesOf("project = JQLG AND labels = jg-lnk")'], 'nested app function'],
    ['parentsOf', ['project = JQLG AND issuetype in subTaskIssueTypes()'], 'parents of 24 000 subtasks'],
    ['epicsOf', ['project = JQLG AND issuetype in subTaskIssueTypes()'], 'subtask → story → epic'],
    ['issuesInEpics', ['project = JQLG AND issuetype = Epic'], '15 600 children (> 10 000)'],
    ['childIssuesOf', ['project = JQLG AND issuetype = Epic'], 'all levels (> 10 000)'],
    ['childIssuesOf', ['project = JQLG AND issuetype = Epic', '1'], 'depth 1'],
    ['linkedIssuesOf', ['project = JQLG AND labels = jg-lnk'], '1 500 linked (> 1 000)'],
    ['linkedIssuesOf', ['project = JQLG AND labels = jg-lnk', 'blocks'], 'one direction'],
    ['linkedIssuesOf', ['project in (JQLG, RPT)'], 'inner query of 50 000'],
    ['linkedIssuesOfRecursive', ['project = JQLG AND labels = jg-lnk'], 'closure'],
    ['linkedIssuesOfRecursiveLimited', ['project = JQLG AND labels = jg-lnk', '2'], 'closure, depth 2'],
    ['hasLinks', [], 'native issueLinkType'],
    ['hasLinks', ['blocks'], 'one direction, not native both sides'],
    ['hasLinks', ['is blocked by'], 'inward direction'],
    ['hasLinkType', ['Blocks'], 'native, both directions'],
    ['hasSubtasks', [], 'parents of all subtasks'],
    ['previousSprint', ['@board'], 'last closed sprint'],
    ['nextSprint', ['@board'], 'next future sprint'],
    ['issuesInEpics', ['project = JQLT AND issuetype = Epic'], 'team-managed epics'],
    ['subtasksOf', ['project = JQLT AND hierarchyLevel = 0'], 'team-managed subtasks'],
  ],
};

async function filterNamed(name) {
  const found = await api('GET', `/rest/api/3/filter/search?filterName=${encodeURIComponent(`"${name}"`)}`);
  return found.values.find((f) => f.name === name) ?? null;
}

async function ensureFilter() {
  if (await filterNamed('JQLG mid')) return;
  await write('POST', '/rest/api/3/filter', { name: 'JQLG mid', jql: 'project = JQLG AND labels = jg-mid', sharePermissions: [{ type: 'authenticated' }] }, () => filterNamed('JQLG mid'));
}

async function complete() {
  await ensureFilter();
  const list = CASES[args.cases ?? 'm1'];
  const rows = [];
  for (const [fn, raw, note, and] of list) {
    const userArgs = [];
    for (const a of raw) userArgs.push(a === '@board' ? args.board : a.includes('@me') ? a.replace('@me', await myAccountId()) : a);
    const jql = and ? `${clause(fn, userArgs)} AND (${and})` : clause(fn, userArgs);
    const got = await settledIds(jql, { log });
    const row = { fn, userArgs, note, and: and ?? null, seconds: got.seconds, attempts: got.attempts, error: got.error };
    if (got.ids) Object.assign(row, compare(got.ids, await REFERENCES[fn](userArgs, args)));
    log(`${fn} ${note}: ${JSON.stringify(row)}`);
    rows.push(row);
  }
  const path = save(tagged(`acceptance-complete-${args.cases ?? 'm1'}`), { stats, rows, allComplete: rows.every((r) => r.complete) });
  log(`saved ${path}`);
}

async function queryLatency() {
  const result = await latency({ n: args.n, log });
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-query'), { stats, ...result });
}

async function sprintNamed(board, name) {
  return (await sprintsOf(board, 'future')).find((s) => s.name === name) ?? null;
}

async function setSprintState(sprintId, state) {
  const inState = async () => {
    const sprint = await api('GET', `/rest/agile/1.0/sprint/${sprintId}`);
    return sprint.state === state ? sprint : null;
  };
  await write('POST', `/rest/agile/1.0/sprint/${sprintId}`, { state }, inState);
}

async function boardLatency() {
  const DAY = 86400000;
  const board = await boardId(args.board);
  if ((await sprintsOf(board, 'active')).length) throw new Error(`board ${args.board} has an active sprint: close it first`);
  const leftover = (await sprintsOf(board, 'future')).filter((s) => s.name.startsWith('AQ fresh '));
  if (leftover.length) throw new Error(`board ${args.board} has future sprints of an earlier run (${leftover.map((s) => s.id).join(', ')}): delete them first`);
  const backlog = (await api('GET', `/rest/agile/1.0/board/${board}/backlog?fields=key&maxResults=${args.n}`)).issues.map((x) => String(x.id));
  const C_NEXT = clause('nextSprint', [args.board]);
  const C_PREV = clause('previousSprint', [args.board]);
  const rows = { nextSprint: [], previousSprint: [] };
  const t0 = Date.now();
  for (const x of backlog) {
    const created = Date.now();
    const name = `AQ fresh ${created}`;
    const sprint = await write('POST', '/rest/agile/1.0/sprint', { name, originBoardId: board, startDate: new Date(created - DAY).toISOString(), endDate: new Date(created + DAY).toISOString() }, () => sprintNamed(board, name));
    await api('POST', `/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: [x] });
    rows.nextSprint.push(await waitFor(C_NEXT, x, true, created));
    await setSprintState(sprint.id, 'active');
    await setSprintState(sprint.id, 'closed');
    rows.previousSprint.push(await waitFor(C_PREV, x, true, Date.now()));
    log(`board ${x}: next ${rows.nextSprint.at(-1)} s, previous ${rows.previousSprint.at(-1)} s`);
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-board'), { stats, ...result });
}

async function labelled(label) {
  for (let i = 0; i < 5; i += 1) {
    const found = (await ids(`project = JQLT AND labels = ${label}`)).ids ?? [];
    if (found.length) return { id: found[0] };
    await sleep(3000);
  }
  return null;
}

async function seedTeamManaged() {
  const me = await api('GET', '/rest/api/3/myself');
  const project = await api('GET', '/rest/api/3/project/JQLT', undefined, { raw: true });
  if (project.status === 404) {
    const exists = async () => ((await api('GET', '/rest/api/3/project/JQLT', undefined, { raw: true })).status === 200 ? { status: 201 } : null);
    const created = await write('POST', '/rest/api/3/project', { key: 'JQLT', name: 'JQL team-managed', projectTypeKey: 'software', projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-agility-scrum', leadAccountId: me.accountId }, exists, { raw: true });
    if (created.status >= 300) {
      log(`team-managed project not created (${created.status}): ask the owner to create JQLT (team-managed scrum) and rerun`);
      return;
    }
  }
  const meta = await api('GET', '/rest/api/3/issue/createmeta/JQLT/issuetypes');
  const type = (level) => meta.issueTypes.find((t) => t.hierarchyLevel === level);
  const run = Date.now().toString(36);
  let made = 0;
  const make = (fields) => {
    made += 1;
    const label = `aqtm-${run}-${made}`;
    return write('POST', '/rest/api/3/issue', { fields: { project: { key: 'JQLT' }, labels: [label], ...fields } }, () => labelled(label));
  };
  const existing = (await ids('project = JQLT')).ids ?? [];
  if (existing.length) {
    log(`JQLT already has ${existing.length} issues`);
    return;
  }
  for (let e = 0; e < 2; e += 1) {
    const epic = await make({ issuetype: { id: type(1).id }, summary: `tm epic ${e}` });
    for (let s = 0; s < 3; s += 1) {
      const story = await make({ issuetype: { id: type(0).id }, summary: `tm story ${e}.${s}`, parent: { id: epic.id } });
      await make({ issuetype: { id: type(-1).id }, summary: `tm sub ${e}.${s}`, parent: { id: story.id } });
    }
  }
  log(`JQLT seeded: ${(await ids('project = JQLT')).ids.length} issues`);
}

/** Freshness phases by function group; later stages add sprint, comment, attachment and fields. */
export const FRESH = { query: queryLatency, board: boardLatency };

const JG6_SEED = new URL('../../../atlassian/data/jg6-seed.json', import.meta.url);
const jg6Seed = () => JSON.parse(readFileSync(JG6_SEED, 'utf8'));
args.candidates = args.candidates ?? 'project = JQLG AND labels in (jg-sprint, jg-sprint-big)';

Object.defineProperty(CASES, 'm2', {
  enumerable: true,
  get() {
    const seed = jg6Seed();
    const board = 'JQLG board';
    const SPRINT_FUNCTIONS = ['addedAfterSprintStart', 'removedAfterSprintStart', 'completeInSprint', 'incompleteInSprint'];
    return [
      ...seed.sprints.flatMap((s) => [
        ['addedAfterSprintStart', [board, s.name], `${s.name}: added after the start`],
        ['removedAfterSprintStart', [board, s.name], `${s.name}: removed after the start`],
      ]),
      ...seed.sprints.slice(0, 10).flatMap((s) => [
        ['completeInSprint', [board, s.name], `${s.name}: done at the close`],
        ['incompleteInSprint', [board, s.name], `${s.name}: not done at the close`],
      ]),
      ['addedAfterSprintStart', [board], 'active sprint'],
      ...SPRINT_FUNCTIONS.map((fn) => [fn, [board, seed.big.name], `${seed.big.name}: sprint of 2 200 issues (> 1 000)`]),
    ];
  },
});

async function addToSprint(sprintId, issueId) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api('POST', `/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [issueId] }, { unsafe: true });
      return;
    } catch (error) {
      if (!(error instanceof UnsafeRetryError)) throw error;
      if ((await ids(`sprint = ${sprintId} AND id = ${issueId}`)).ids?.length) return;
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`issue ${issueId} was not added to sprint ${sprintId}`);
}

async function toDone(issueId) {
  const { transitions } = await api('GET', `/rest/api/3/issue/${issueId}/transitions`);
  const done = transitions.find((t) => t.to?.statusCategory?.key === 'done');
  await api('POST', `/rest/api/3/issue/${issueId}/transitions`, { transition: { id: done.id } });
}

FRESH.sprint = async () => {
  const { active } = jg6Seed();
  const free = (await ids('project = JQLG AND labels = jg-sprint AND sprint is EMPTY ORDER BY key')).ids.slice(0, args.n);
  const open = (await ids(`sprint = ${active.id} AND statusCategory != Done ORDER BY key`)).ids.slice(0, args.n);
  const rows = { addedAfterStart: [], completed: [] };
  const t0 = Date.now();
  for (const x of free) {
    const t = Date.now();
    await addToSprint(active.id, x);
    rows.addedAfterStart.push(await waitFor(clause('addedAfterSprintStart', ['JQLG board']), x, true, t));
  }
  for (const x of open) {
    const t = Date.now();
    await toDone(x);
    rows.completed.push(await waitFor(clause('completeInSprint', ['JQLG board', active.name]), x, true, t));
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-sprint'), { stats, ...result });
};

async function fresh() {
  if (!FRESH[args.group]) throw new Error(`groups: ${Object.keys(FRESH).join(', ')}`);
  await FRESH[args.group]();
}

const PHASES = { complete, fresh, 'seed-tm': seedTeamManaged };
if (!PHASES[args.phase]) {
  log(`phases: ${Object.keys(PHASES).join(', ')}`);
  process.exit(2);
}
PHASES[args.phase]().then(() => log(`requests ${stats.requests}, retries ${stats.retries}, timeouts ${stats.timeouts}`)).catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
