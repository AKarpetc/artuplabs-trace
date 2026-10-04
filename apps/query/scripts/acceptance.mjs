#!/usr/bin/env node
/**
 * Acceptance tool for ArtUp Query against the dev site; every request has a timeout, and a write that broke
 * is sent again only after a check that it was not applied.
 *
 *   complete  every case of a table against a reference built by REST traversal (--cases m1|m2|m3|tree2, --board, --candidates, --tag)
 *   fresh     seconds until a change is visible and changes lost after 10 minutes (--group query|board|sprint|comment|attachment|fields, --n, --tag)
 *   seed-tm   a team-managed project JQLT with epics, stories and subtasks
 *   seed-fields  50 RPT issues with a due date, an original estimate, a worklog and a done status (aq-fields)
 *   burst     200 links created and then deleted within a minute each, then seconds until all are visible (--burst, --tag)
 *   audit     issues updated by the app user (must be none: the app writes nothing to issues) (--since -7d, --app)
 *   errors    the editor errors of invalid calls, function groups that are shipped only (--groups)
 *   sr        the 20 ScriptRunner samples against the reference, samples of groups not shipped skipped, empty references not passed (--groups)
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node apps/query/scripts/acceptance.mjs complete [--cases m1|m2|m3|tree2] [--board "RPT board"] [--tag t]
 *   node apps/query/scripts/acceptance.mjs fresh [--group query|board|sprint|comment|attachment|fields] [--n 30] [--board "RPT board"] [--tag t]
 *   node apps/query/scripts/acceptance.mjs seed-tm
 *   node apps/query/scripts/acceptance.mjs seed-fields
 *   node apps/query/scripts/acceptance.mjs burst [--burst 200] [--tag t]
 *   node apps/query/scripts/acceptance.mjs audit [--since -7d] [--app "ArtUp Query"]
 *   node apps/query/scripts/acceptance.mjs errors [--groups query,site,board,sprint,comment,attachment,fields]
 *   node apps/query/scripts/acceptance.mjs sr [--groups query,site,board,sprint,comment,attachment,fields]
 */
import { readFileSync } from 'node:fs';
import { api, bulk, ids, pool, settledIds, sleep, stats, UnsafeRetryError, upload, write } from './lib/http.mjs';
import { latency, latencyResult, linkId, waitFor } from './lib/latency.mjs';
import { boardId, myAccountId, REFERENCES, sprintsOf } from './lib/reference.mjs';
import { compare, save } from './lib/report.mjs';

const args = { phase: process.argv[2], n: 30, tag: '', board: 'RPT board', group: 'query' };
for (let i = 3; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
args.n = Number(args.n);

const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const clause = (fn, userArgs) => `issue in ${fn}(${userArgs.map(q).join(', ')})`;
const tagged = (name) => `${name}${args.tag ? `-${args.tag}` : ''}`;

/** Completeness cases: function, user arguments, what the case proves, optional native JQL ANDed to the result, optional `{ skip }` with the reason a case cannot run on the dev site. Later stages append their own. */
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
  for (const [fn, raw, note, and, { skip } = {}] of list) {
    const userArgs = [];
    for (const a of raw) userArgs.push(a === '@board' ? args.board : a.includes('@me') ? a.replace('@me', await myAccountId()) : a);
    if (skip) {
      log(`${fn} ${note}: skipped, ${skip}`);
      rows.push({ fn, userArgs, note, and: and ?? null, skipped: skip });
      continue;
    }
    const jql = and ? `${clause(fn, userArgs)} AND (${and})` : clause(fn, userArgs);
    const got = await settledIds(jql, { log });
    const row = { fn, userArgs, note, and: and ?? null, seconds: got.seconds, attempts: got.attempts, error: got.error };
    if (got.ids) Object.assign(row, compare(got.ids, await REFERENCES[fn](userArgs, args)));
    log(`${fn} ${note}: ${JSON.stringify(row)}`);
    rows.push(row);
  }
  const path = save(tagged(`acceptance-complete-${args.cases ?? 'm1'}`), { stats, rows, allComplete: rows.filter((r) => !r.skipped).every((r) => r.complete) });
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

const REF_SCOPE = 'project in (JQLG, RPT)';
const M3_PARTS = [];
Object.defineProperty(CASES, 'm3', { enumerable: true, get: () => M3_PARTS.flatMap((part) => part()) });

const commentCases = () => [
    ['hasComments', [], 'every issue with a comment (site-wide)', REF_SCOPE],
    ['hasComments', ['1'], 'exactly one comment', REF_SCOPE],
    ['hasComments', ['+2'], 'more than 2 comments', REF_SCOPE],
    ['hasComments', ['-3'], 'fewer than 3 comments, issues without comments included', REF_SCOPE],
    ['commented', [], 'no clauses: any comment', REF_SCOPE],
    ['commented', ['after 2020-01-01'], 'any author since 2020 (site-wide)', REF_SCOPE],
    ['commented', ['by @me after 2020-01-01'], 'one author, all time', REF_SCOPE],
    ['lastComment', ['by @me'], 'last comment by one author', REF_SCOPE],
    ['commented', ['inGroup jira-users-artuplabs-dev after 2020-01-01'], 'authors of one group, members read as the app', REF_SCOPE],
    ['lastComment', ['inRole Administrators'], 'authors in a project role, members read per project as the app', REF_SCOPE],
];
const attachmentCases = () => [
  ['hasAttachments', [], 'every issue with an attachment (site-wide, native)', REF_SCOPE],
  ['hasAttachments', ['pdf'], 'one extension', REF_SCOPE],
  ['hasAttachments', ['.PNG'], 'extension with a dot and in upper case', REF_SCOPE],
  ['fileAttached', ['ext xlsx after 2020-01-01'], 'extension and date', REF_SCOPE],
];
M3_PARTS.push(commentCases);
M3_PARTS.push(attachmentCases);

FRESH.comment = async () => {
  const me = await myAccountId();
  const today = new Date().toISOString().slice(0, 10);
  const mid = (await ids('project = JQLG AND labels = jg-mid ORDER BY key')).ids;
  const targets = (await bulk(mid, ['comment']))
    .filter((x) => !(x.fields.comment?.comments ?? []).some((c) => c.author?.accountId === me && String(c.created).startsWith(today)))
    .map((x) => String(x.id))
    .slice(0, args.n);
  const rows = { comment: [] };
  const t0 = Date.now();
  for (const [i, x] of targets.entries()) {
    const t = Date.now();
    await api('POST', `/rest/api/3/issue/${x}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `aq probe ${i}` }] }] } }, { unsafe: true });
    rows.comment.push(await waitFor(clause('commented', [`by ${me} after ${today}`]), x, true, t));
    log(`comment ${x}: ${rows.comment.at(-1)} s`);
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-comment'), { stats, ...result });
};

FRESH.attachment = async () => {
  const ext = `aq${Date.now() % 1000000}`;
  const targets = (await ids('project = JQLG AND labels = jg-mid ORDER BY key')).ids.slice(0, args.n);
  const rows = { attachment: [] };
  const t0 = Date.now();
  for (const x of targets) {
    const t = Date.now();
    await upload(x, `probe.${ext}`, 'aq probe');
    rows.attachment.push(await waitFor(clause('hasAttachments', [ext]), x, true, t));
    log(`attachment ${x}: ${rows.attachment.at(-1)} s`);
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-attachment'), { stats, ...result });
};

M3_PARTS.push(() => [
  ['dateCompare', ['project in (JQLG, RPT)', 'resolutiondate > duedate'], 'dates over 50 000 issues'],
  ['expression', ['project in (JQLG, RPT)', 'timespent > originalestimate * 1.2'], 'work time over 50 000 issues'],
  ['expression', ['project = RPT AND key <= RPT-8500', 'votes >= 0'], '8 500 values: one-level tree (> 1 000, ≤ 9 000)'],
  ['dateCompare', ['project = JQLG', 'lastCommented > firstCommented'], 'comment times from the index, visible comments only'],
]);

Object.defineProperty(CASES, 'tree2', {
  enumerable: true,
  get: () => [['expression', ['project in (JQLG, RPT)', 'votes >= 0'], '50 000 values, 50 leaves under 6 middle nodes']],
});

FRESH.fields = async () => {
  const day = 86400000;
  const resolvedMs = (x) => Date.parse(x.fields.resolutiondate.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const dueMs = (x) => (x.fields.duedate ? Date.parse(`${x.fields.duedate}T00:00:00Z`) : null);
  const resolved = await bulk((await ids('project = RPT AND resolution is not EMPTY ORDER BY key')).ids, ['duedate', 'resolutiondate']);
  const targets = resolved.filter((x) => x.fields.resolutiondate && (dueMs(x) === null || dueMs(x) >= resolvedMs(x))).slice(0, args.n);
  const C = clause('dateCompare', ['project = RPT', 'resolutiondate > duedate']);
  const rows = { enter: [], leave: [] };
  const t0 = Date.now();
  for (const x of targets) {
    const dayBefore = new Date(Math.floor(resolvedMs(x) / day) * day - day).toISOString().slice(0, 10);
    let t = Date.now();
    await api('PUT', `/rest/api/3/issue/${x.id}`, { fields: { duedate: dayBefore } });
    rows.enter.push(await waitFor(C, x.id, true, t));
    t = Date.now();
    await api('PUT', `/rest/api/3/issue/${x.id}`, { fields: { duedate: x.fields.duedate ?? null } });
    rows.leave.push(await waitFor(C, x.id, false, t));
    log(`fields ${x.id}: in ${rows.enter.at(-1)} s out ${rows.leave.at(-1)} s`);
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-fields'), { stats, ...result });
};

/** Gives SEED_FIELDS issues of RPT a due date around today, an original estimate, a 2 h worklog and a done status, labelled aq-fields; reruns skip the labelled ones. */
const SEED_FIELDS = 50;
async function seedFields() {
  const day = 86400000;
  const seeded = (await ids('project = RPT AND labels = aq-fields')).ids ?? [];
  const fresh = ((await ids('project = RPT AND (labels is EMPTY OR labels != aq-fields) ORDER BY key')).ids ?? []).slice(0, Math.max(0, SEED_FIELDS - seeded.length));
  const today = Math.floor(Date.now() / day) * day;
  let worklogs = 0;
  let closed = 0;
  for (const [i, x] of fresh.entries()) {
    const duedate = new Date(today + ((i % 20) - 10) * day).toISOString().slice(0, 10);
    await api('PUT', `/rest/api/3/issue/${x}`, { fields: { duedate, timetracking: { originalEstimate: i % 2 ? '1h' : '4h' } }, update: { labels: [{ add: 'aq-fields' }] } });
    const now = await api('GET', `/rest/api/3/issue/${x}?fields=timespent,status`);
    if (!now.fields.timespent) {
      await api('POST', `/rest/api/3/issue/${x}/worklog`, { timeSpentSeconds: 7200, started: new Date(today - day).toISOString().replace('Z', '+0000') }, { unsafe: true });
      worklogs += 1;
    }
    if (now.fields.status?.statusCategory?.key !== 'done') {
      await toDone(x);
      closed += 1;
    }
  }
  log(`seed-fields: ${seeded.length} already seeded, ${fresh.length} new, ${worklogs} worklogs, ${closed} moved to done`);
}

const shippedGroups = () => String(args.groups ?? 'query,site,board,sprint,comment,attachment,fields').split(',').map((g) => g.trim());

const createLink = ([from, to]) => write('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, outwardIssue: { id: from }, inwardIssue: { id: to } }, () => linkId(from, to));

/** Deletes the link between two issues; true when there was none or Jira answered 204. */
async function deleteLink([from, to]) {
  const id = await linkId(from, to);
  if (!id) return true;
  return (await api('DELETE', `/rest/api/3/issueLink/${id}`, undefined, { raw: true })).status === 204;
}

/**
 * A burst of link changes spread over one minute, four in flight: created, then deleted; each wave reports seconds from its last change
 * until the app shows all of them, or the changes still missing after 10 minutes. Every poll carries a control issue that stays in the
 * result, so an error, a Computing answer or an empty answer never counts as "the deletions are visible".
 */
async function burst() {
  const C = 'issue in linkedIssuesOf("project = JQLG AND labels = jg-lnk")';
  const want = Number(args.burst ?? 200);
  const warm = await settledIds(C, { log });
  if (!warm.ids?.length) throw new Error(`${C} answered no issues (${warm.error ?? 'empty'}): no control issue`);
  const sources = (await ids('project = JQLG AND labels = jg-lnk ORDER BY key')).ids ?? [];
  const targets = ((await ids('project = JQLG AND labels = jg-task AND issueLinkType is EMPTY AND labels not in (jg-big, jg-mid, jg-small, jg-lnk, jg-sprint, jg-sprint-big) ORDER BY key ASC')).ids ?? []).slice(0, want);
  if (!sources.length || targets.length !== want) throw new Error(`burst needs ${want} free targets and jg-lnk sources: found ${targets.length} targets, ${sources.length} sources`);
  const control = warm.ids.find((x) => !targets.includes(x));
  if (!control) throw new Error('no control issue outside the burst targets');
  const pairs = targets.map((to, i) => [sources[i % sources.length], to]);
  const gap = 60000 / pairs.length;
  const poll = `(${C}) AND id in (${[...targets, control].join(',')})`;
  const wave = async (op, present) => {
    const t0 = Date.now();
    const results = await pool(pairs, 4, async (pair, i) => {
      const due = t0 + i * gap;
      if (Date.now() < due) await sleep(due - Date.now());
      return op(pair);
    });
    const tLast = Date.now();
    const spreadSeconds = (tLast - t0) / 1000;
    const base = { changes: pairs.length, failed: results.filter((r) => r === false).length, spreadSeconds, ratePerMinute: Math.round((pairs.length / Math.max(spreadSeconds, 1)) * 60) };
    let ok = 0;
    for (;;) {
      const r = await ids(poll);
      const got = new Set(r.ids ?? []);
      if (!r.error && got.has(control)) {
        ok = targets.filter((x) => got.has(x) === present).length;
        if (ok === targets.length) return { ...base, lastChangeToVisibleSeconds: (Date.now() - tLast) / 1000, lost: 0 };
      }
      if (Date.now() - tLast > 10 * 60000) return { ...base, lastChangeToVisibleSeconds: null, lost: targets.length - ok };
      await sleep(2000);
    }
  };
  let created;
  try {
    created = await wave(createLink, true);
  } catch (error) {
    log(`burst interrupted, deleting the links it made: ${error.message}`);
    await pool(pairs, 4, (pair) => deleteLink(pair).catch(() => false));
    throw error;
  }
  log(`burst created: ${JSON.stringify(created)}`);
  const deleted = await wave(deleteLink, false);
  log(`burst deleted: ${JSON.stringify(deleted)}`);
  save(tagged('acceptance-burst'), { stats, control, created, deleted });
}

async function allUsers() {
  const out = [];
  for (let startAt = 0; ; startAt += 1000) {
    const page = await api('GET', `/rest/api/3/users/search?startAt=${startAt}&maxResults=1000`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/**
 * Issues the app user updated since `--since`: the app has no write scope on issues, so the count must be zero. The app user is the
 * one app account named exactly `--app` (default "ArtUp Query"); the same search for the tool's own account must find issues
 * (the tool edits issues in the other phases), otherwise the audit proves nothing and `pass` is null.
 */
async function audit() {
  const since = args.since ?? '-7d';
  const name = args.app ?? 'ArtUp Query';
  const apps = (await allUsers()).filter((u) => u.accountType === 'app');
  const matched = apps.filter((u) => u.displayName === name);
  if (matched.length !== 1) throw new Error(`expected one app user named "${name}", found ${matched.length}; app users: ${apps.map((u) => `${u.displayName} (${u.accountId})`).join(', ')}`);
  const [app] = matched;
  const me = await myAccountId();
  const control = await ids(`issuekey in updatedBy(${q(me)}, ${q(since)})`);
  const touched = await ids(`issuekey in updatedBy(${q(app.accountId)}, ${q(since)})`);
  const controlOk = !control.error && control.ids.length > 0;
  const result = {
    appAccountId: app.accountId,
    appName: app.displayName,
    since,
    controlUpdatedByTool: control.ids?.length ?? null,
    controlError: control.error,
    updatedByApp: touched.ids?.length ?? null,
    error: touched.error,
    pass: !controlOk || touched.error ? null : touched.ids.length === 0,
    ...(controlOk ? {} : { reason: 'updatedBy found no issues for the tool account: the search proves nothing' }),
  };
  log(`audit: ${JSON.stringify(result)}`);
  save('acceptance-audit', { stats, ...result });
}

/** Invalid calls with the start of the editor error each must give, and the function group it belongs to. */
const ERRORS = [
  ['issue in subtasksOf("projekt = JQLG")', 'subtasksOf: ', 'query'],
  ['issue in subtasksOf("assignee = currentUser()")', 'currentUser() is not supported', 'query'],
  ['issue in childIssuesOf("project = JQLG", "11")', 'depth must be between 1 and 10', 'query'],
  ['issue in linkedIssuesOf("project = JQLG", "nope")', 'Link type "nope" not found', 'query'],
  ['issue in previousSprint("No such board")', 'Board "No such board" not found', 'board'],
  ['issue in addedAfterSprintStart("JQLG board", "No such sprint")', 'Sprint "No such sprint" not found', 'sprint'],
  ['issue in commented("by nobody-xyz-123")', 'User "nobody-xyz-123" not found', 'comment'],
  ['issue in commented("roleLevel Administrators")', 'Clause "roleLevel" is not available yet', 'comment'],
  ['issue in lastComment("groupLevel jira-users-artuplabs-dev")', 'Clause "groupLevel" is not available yet', 'comment'],
  ['issue in expression("project = JQLG", "nope > 1")', 'Field "nope" not found', 'fields'],
];

async function errors() {
  const shipped = shippedGroups();
  const rows = [];
  for (const [jql, expected, group] of ERRORS.filter((e) => shipped.includes(e[2]))) {
    const r = await api('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: 1 }, { raw: true });
    const message = r.text.slice(0, 400);
    rows.push({ jql, group, expected, status: r.status, message, pass: r.status === 400 && message.includes(expected) });
    log(`${rows.at(-1).pass ? 'pass' : 'FAIL'} ${jql}: ${r.status} ${message}`);
  }
  save('acceptance-errors', { stats, groups: shipped, rows, allPass: rows.every((x) => x.pass) });
}

/** The ScriptRunner samples rewritten for the app, each against its reference; a sample of a group not shipped is skipped as v1.1. */
async function sr() {
  const { samples } = JSON.parse(readFileSync(new URL('../test/fixtures/sr-samples.json', import.meta.url), 'utf8'));
  const shipped = shippedGroups();
  const rows = [];
  for (const s of samples) {
    if (!shipped.includes(s.group)) {
      rows.push({ id: s.id, scriptrunner: s.scriptrunner, group: s.group, skipped: 'v1.1', pass: null });
      log(`sr ${s.id}: skipped, group ${s.group} is in v1.1`);
      continue;
    }
    const got = await settledIds(s.query, { log });
    let ref = await REFERENCES[s.reference.fn](s.reference.args, args);
    if (s.reference.and) {
      const allowed = await ids(s.reference.and);
      if (allowed.error) throw new Error(`sr ${s.id}: reference filter failed: ${allowed.error}`);
      const inFilter = new Set(allowed.ids);
      ref = ref.filter((id) => inFilter.has(String(id)));
    }
    const row = { id: s.id, scriptrunner: s.scriptrunner, group: s.group, query: s.query, seconds: got.seconds, attempts: got.attempts, error: got.error, ...(got.ids ? compare(got.ids, ref) : {}) };
    const vacuous = !got.error && ref.length === 0;
    rows.push({ ...row, ...(vacuous ? { vacuous: true } : {}), pass: vacuous ? null : row.complete === true });
    log(`sr ${s.id}: ${JSON.stringify(rows.at(-1))}`);
  }
  save(tagged('acceptance-sr'), { stats, groups: shipped, rows, passed: rows.filter((r) => r.pass === true).length, failed: rows.filter((r) => r.pass === false).length, vacuous: rows.filter((r) => r.vacuous).length, skipped: rows.filter((r) => r.skipped).length });
}

async function fresh() {
  if (!FRESH[args.group]) throw new Error(`groups: ${Object.keys(FRESH).join(', ')}`);
  await FRESH[args.group]();
}

const PHASES = { complete, fresh, 'seed-tm': seedTeamManaged, 'seed-fields': seedFields, burst, audit, errors, sr };
if (!PHASES[args.phase]) {
  log(`phases: ${Object.keys(PHASES).join(', ')}`);
  process.exit(2);
}
PHASES[args.phase]().then(() => log(`requests ${stats.requests}, retries ${stats.retries}, timeouts ${stats.timeouts}`)).catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
