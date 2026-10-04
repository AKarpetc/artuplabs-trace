#!/usr/bin/env node
/**
 * Seeds sprint history on artuplabs-dev for the ArtUp Query J-G6 gate (plan 2026-10-03-artup-query-v1, Task 18):
 * a scrum board "JQLG board" and sprints whose history is known "by hand", written to atlassian/data/jg6-seed.json.
 *
 *   JQLG S1…S30  20 issues before the start, +5 after it (added), 3 initial ones to the backlog (removed),
 *                1 of those back (readded), 10 initial ones to Done (done), closed
 *   JQLG SB      1 100 issues before the start, +1 100 after it, 1 050 initial ones removed, the 1 100 added
 *                ones done, closed (full run only)
 *   Sprint 1     10 issues, 5 done, closed (a ScriptRunner sample filter asks for incompleteInSprint of it)
 *   JQLG S31     active with 20 issues; JQLG S32, S33 future (full run only)
 *
 * Issues: labels jg-sprint (JQLG-8000…8999, 1 000) and jg-sprint-big (2 200 jg-task issues from JQLG-10000).
 * Resumable: each sprint record is saved after every phase (created, filled, started, added, removed, readded, done,
 * closed; the phase in `phase`). A finished record is skipped; a half-way one resumes from its next phase, checking the
 * sprint's current composition so a move applied just before a failure is not sent again (its time is recorded as null).
 * A future sprint without a record is deleted and made again; an active or closed one without a record stops the run.
 * After the close every sprint's issues and done states are checked against the record (mismatches are logged).
 * Test hook: SEED_FAIL_AFTER="<sprint name>:<phase>" stops the run right after that phase is saved,
 * "<sprint name>:<phase>-moved" right after a move of that phase and before it is recorded.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/seed-jira-sprints.mjs [--limit N]
 * --limit N runs JQLG S1…S<N> and Sprint 1 only: no jg-sprint-big labels, no JQLG SB, no S31…S33.
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, write, pool, sleep, stats, UnsafeRetryError } from '../../apps/query/scripts/lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', 'data', 'jg6-seed.json');
const LOG = join(HERE, '..', 'data', 'jg6-seed.log');
const KEY = 'JQLG';
const BOARD = 'JQLG board';
const FILTER = 'JQLG board filter';
const CLOSED = 30;
const PER = 25; // 20 before the start + 5 after it
const DAY = 24 * 3600 * 1000;

const log = async (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  process.stderr.write(`${text}\n`);
  await appendFile(LOG, `${text}\n`);
};
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const keyNo = (key) => Number(key.split('-')[1]);

/** {id, key} of every issue of a JQL, sorted by key number. */
async function issues(jql) {
  const out = [];
  let nextPageToken;
  do {
    const page = await api('POST', '/rest/api/3/search/jql', { jql, fields: ['summary'], maxResults: 5000, ...(nextPageToken ? { nextPageToken } : {}) });
    out.push(...page.issues.map((x) => ({ id: String(x.id), key: x.key })));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return out.sort((a, b) => keyNo(a.key) - keyNo(b.key));
}

async function label(name, jql) {
  const todo = await issues(`${jql} AND labels not in (${name})`);
  await log(`label ${name}: ${todo.length} to tag`);
  let done = 0;
  await pool(todo, 4, async (x) => {
    await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ add: name }] } });
    done += 1;
    if (done % 100 === 0) process.stderr.write(`  ${name} ${done}/${todo.length}\n`);
  });
}

async function bigRange() {
  let hi = 12200;
  const range = () => `project = ${KEY} AND labels = jg-task AND key >= ${KEY}-10000 AND key < ${KEY}-${hi}`;
  let found = await issues(range());
  while (found.length < 2200 && hi < 60000) {
    hi += 100;
    found = await issues(range());
  }
  if (found.length < 2200) throw new Error(`only ${found.length} jg-task issues from ${KEY}-10000`);
  return `project = ${KEY} AND labels = jg-task AND key >= ${KEY}-10000 AND key <= ${found[2199].key}`;
}

async function ensureBoard() {
  const filters = await api('GET', `/rest/api/3/filter/search?filterName=${encodeURIComponent(FILTER)}&expand=jql`);
  let filter = filters.values.find((f) => f.name === FILTER);
  if (!filter) {
    filter = await api('POST', '/rest/api/3/filter', {
      name: FILTER,
      jql: `project = ${KEY} AND labels in (jg-sprint, jg-sprint-big) ORDER BY Rank ASC`,
      sharePermissions: [{ type: 'authenticated' }],
    });
    await log(`filter "${FILTER}" created: ${filter.id}`);
  }
  const named = (await api('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(BOARD)}&maxResults=50`)).values.filter((b) => b.name === BOARD);
  const scrum = named.find((b) => b.type === 'scrum');
  // The project template made a kanban board of the same name; a name lookup must find one board, and kanban has no sprints.
  for (const b of named.filter((x) => x.type !== 'scrum')) {
    await api('DELETE', `/rest/agile/1.0/board/${b.id}`);
    await log(`deleted ${b.type} board "${b.name}" ${b.id} (same name, no sprints)`);
  }
  if (scrum) return { id: scrum.id, name: scrum.name };
  const board = await api('POST', '/rest/agile/1.0/board', { name: BOARD, type: 'scrum', filterId: Number(filter.id), location: { type: 'project', projectKeyOrId: KEY } });
  await log(`scrum board "${BOARD}" created: ${board.id}`);
  return { id: board.id, name: board.name };
}

async function boardSprints(boardId) {
  const out = new Map();
  for (let startAt = 0; ; startAt += 50) {
    const page = await api('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=future,active,closed&startAt=${startAt}&maxResults=50`);
    for (const s of page.values) out.set(s.name, s);
    if (page.isLast || !page.values.length) return out;
  }
}

let SPRINT_FIELD;

/**
 * The keys (of those given) whose Sprint field holds the sprint now. Read from the issues, not from the Agile sprint
 * listing: that one is search-backed and lags a move by seconds (measured: an issue moved to the backlog was still listed).
 */
async function sprintKeys(sprintId, keys) {
  const out = new Set();
  for (const chunk of chunks(keys, 100)) {
    const page = await api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: chunk, fields: [SPRINT_FIELD] });
    for (const x of page.issues ?? []) if ((x.fields[SPRINT_FIELD] ?? []).some((v) => v.id === sprintId)) out.add(x.key);
  }
  return out;
}

/** Moves keys into the sprint (inSprint) or to the backlog, 50 per request; after an unsafe failure resends only what Jira did not apply. */
async function move(sprintId, keys, inSprint) {
  const path = inSprint ? `/rest/agile/1.0/sprint/${sprintId}/issue` : '/rest/agile/1.0/backlog/issue';
  for (let chunk of chunks(keys, 50)) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await api('POST', path, { issues: chunk }, { unsafe: true });
        break;
      } catch (error) {
        if (!(error instanceof UnsafeRetryError) || attempt >= 5) throw error;
        await sleep(3000);
        const have = await sprintKeys(sprintId, chunk);
        chunk = chunk.filter((k) => have.has(k) !== inSprint);
        if (!chunk.length) break;
      }
    }
  }
}

const isDone = async (key) => (await api('GET', `/rest/api/3/issue/${key}?fields=status`)).fields.status.statusCategory.key === 'done';

async function toDone(keys) {
  await pool(keys, 4, async (key) => {
    if (await isDone(key)) return;
    const { transitions } = await api('GET', `/rest/api/3/issue/${key}/transitions`);
    const done = transitions.find((t) => t.to?.statusCategory?.key === 'done');
    if (!done) throw new Error(`${key}: no transition to a done status`);
    await write('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: done.id } }, async () => (await isDone(key)) || null);
  });
}

async function setState(sprintId, body) {
  await write('POST', `/rest/agile/1.0/sprint/${sprintId}`, body, async () => {
    const s = await api('GET', `/rest/agile/1.0/sprint/${sprintId}`);
    return s.state === body.state ? s : null;
  });
  return api('GET', `/rest/agile/1.0/sprint/${sprintId}`);
}

async function start(sprintId) {
  const now = Date.now();
  const s = await setState(sprintId, { state: 'active', startDate: new Date(now).toISOString(), endDate: new Date(now + 14 * DAY).toISOString() });
  return Date.parse(s.startDate);
}

/** Keys that left the sprint for good: removed and not readded. */
const removedForGood = (rec) => {
  const back = new Set((rec.readded ?? []).map((x) => x.key));
  return (rec.removed ?? []).map((x) => x.key).filter((k) => !back.has(k));
};

/** After the close: logs the dates Jira returns and what it did with the Sprint field of the issues of the sprint. */
async function closeLog(rec, s, sprintField) {
  await log(`${rec.name} closed: startDate ${s.startDate}, activatedDate ${s.activatedDate ?? '(absent)'}, completeDate ${s.completeDate ?? '(absent)'}, endDate ${s.endDate}`);
  const doneSet = new Set(rec.done);
  const out = new Set(removedForGood(rec));
  const sample = [...rec.initial, ...(rec.added ?? []).map((x) => x.key)].slice(-100);
  const fields = await api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: sample, fields: [sprintField, 'status'] });
  const shape = (x) => {
    const sprints = (x.fields[sprintField] ?? []).map((v) => `${v.name}:${v.state}`).join(',') || '(empty)';
    return `${x.fields.status.statusCategory.key === 'done' ? 'done' : 'open'} [${sprints}]`;
  };
  const tally = new Map();
  for (const x of fields.issues ?? []) {
    const kind = `${doneSet.has(x.key) ? 'done' : out.has(x.key) ? 'removed' : 'incomplete'} → ${shape(x)}`;
    tally.set(kind, (tally.get(kind) ?? 0) + 1);
  }
  for (const [kind, n] of tally) await log(`  ${rec.name} after close: ${n} × ${kind}`);
}

/** Composition check of a closed sprint: its issues and their done state against the record; logs every mismatch. */
async function checkComposition(rec) {
  const got = new Map();
  for (let startAt = 0; ; startAt += 100) {
    const page = await api('GET', `/rest/agile/1.0/sprint/${rec.id}/issue?fields=status&startAt=${startAt}&maxResults=100`);
    for (const x of page.issues) got.set(x.key, x.fields.status.statusCategory.key);
    if (startAt + page.issues.length >= page.total || !page.issues.length) break;
  }
  const out = new Set(removedForGood(rec));
  const expected = new Set([...rec.initial.filter((k) => !out.has(k)), ...(rec.added ?? []).map((x) => x.key)]);
  const doneSet = new Set(rec.done);
  const missing = [...expected].filter((k) => !got.has(k));
  const extra = [...got.keys()].filter((k) => !expected.has(k));
  const wrongDone = [...got].filter(([k, c]) => expected.has(k) && (c === 'done') !== doneSet.has(k)).map(([k]) => k);
  if (!missing.length && !extra.length && !wrongDone.length) {
    await log(`  ${rec.name} composition ok: ${got.size} issues, ${rec.done.length} done`);
    return true;
  }
  await log(`  ${rec.name} COMPOSITION MISMATCH: expected ${expected.size}, got ${got.size}; missing [${missing}] extra [${extra}] done-state wrong [${wrongDone}]`);
  return false;
}

/** Phases of a sprint record, in order; a record without `phase` (or `closed`) is finished. */
const PHASES = ['created', 'filled', 'started', 'added', 'removed', 'readded', 'done', 'closed'];
const passed = (rec, phase) => PHASES.indexOf(rec.phase ?? 'closed') >= PHASES.indexOf(phase);
const finished = (rec) => !rec.phase || rec.phase === 'closed';

/** Test hook: SEED_FAIL_AFTER="<sprint name>:<phase>" stops the run right after that phase is saved; "<name>:<phase>-moved" right after a move of that phase, before it is recorded. */
function injected(name, phase) {
  if (process.env.SEED_FAIL_AFTER === `${name}:${phase}`) throw new Error(`injected failure after ${name}:${phase}`);
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = Number(process.argv[i + 1]);
  const limit = args.limit ?? CLOSED;
  const full = args.limit === undefined;
  const t0 = Date.now();
  const seed = await readFile(SEED, 'utf8').then(JSON.parse).catch(() => ({ sprints: [] }));
  const save = () => writeFile(SEED, JSON.stringify(seed, null, 1));
  await log(`run: limit ${limit}${full ? ' (full)' : ''}`);

  const sprintField = (await api('GET', '/rest/api/3/field')).find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint').id;
  SPRINT_FIELD = sprintField;
  const small = `project = ${KEY} AND labels = jg-task AND key >= ${KEY}-8000 AND key < ${KEY}-9000`;
  await label('jg-sprint', small);
  const pickKeys = (await issues(`project = ${KEY} AND labels = jg-sprint`)).map((x) => x.key);
  if (pickKeys.length < 780) throw new Error(`only ${pickKeys.length} jg-sprint issues`);
  let bigKeys = [];
  if (full) {
    const bigJql = await bigRange();
    await label('jg-sprint-big', bigJql);
    bigKeys = (await issues(`project = ${KEY} AND labels = jg-sprint-big`)).map((x) => x.key).slice(0, 2200);
  }

  seed.board = await ensureBoard();
  await save();
  const existing = await boardSprints(seed.board.id);

  /**
   * The record of a sprint to run: null when the sprint is finished; the saved record when it stopped half-way (resumed
   * from its last phase); else a new record of a newly created sprint, attached to the seed and saved at once.
   */
  const resumedAt = new Map();
  async function open(name, record, attach) {
    const s = existing.get(name);
    if (s && record && finished(record)) {
      await log(`${name}: present (${s.state}), record kept`);
      return null;
    }
    if (s && record && record.id === s.id) {
      await log(`${name}: resuming after phase "${record.phase}"`);
      resumedAt.set(record, record.phase);
      return record;
    }
    if (s && s.state !== 'future') throw new Error(`${name} is ${s.state} on the board but has no record in jg6-seed.json: delete it by hand or restore the record`);
    if (s) {
      await api('DELETE', `/rest/agile/1.0/sprint/${s.id}`);
      await log(`${name}: future sprint ${s.id} without a record deleted`);
    }
    const made = await api('POST', '/rest/agile/1.0/sprint', { name, originBoardId: seed.board.id });
    await log(`${name}: created ${made.id}`);
    const rec = { id: made.id, name, phase: 'created' };
    attach(rec);
    await save();
    return rec;
  }

  const phase = async (rec, p) => {
    rec.phase = p;
    await save();
    injected(rec.name, p);
  };

  /**
   * One membership phase (added / removed / readded): groups of keys moved together with one time each, the record saved
   * after every group. In the phase a resumed run starts with, the first group still unrecorded is checked against the
   * sprint first: a move applied just before the failure is recorded with `at: null` (time unknown), not sent again.
   */
  async function membership(rec, field, groups, inSprint) {
    if (passed(rec, field)) return;
    rec[field] = rec[field] ?? [];
    const recorded = new Set(rec[field].map((x) => x.key));
    let first = resumedAt.get(rec) === PHASES[PHASES.indexOf(field) - 1];
    for (const group of groups) {
      let todo = group.filter((k) => !recorded.has(k));
      if (!todo.length) continue;
      if (first) {
        first = false;
        const have = await sprintKeys(rec.id, todo);
        const applied = todo.filter((k) => have.has(k) === inSprint);
        if (applied.length) {
          rec[field].push(...applied.map((key) => ({ key, at: null })));
          await log(`${rec.name}: ${applied.length} ${field} move(s) applied before the failure, time unknown (at: null)`);
        }
        todo = todo.filter((k) => have.has(k) !== inSprint);
      }
      if (todo.length) {
        const at = Date.now();
        await move(rec.id, todo, inSprint);
        injected(rec.name, `${field}-moved`);
        rec[field].push(...todo.map((key) => ({ key, at })));
      }
      await save();
    }
    await phase(rec, field);
  }

  /** Runs a sprint record through the phases it has not passed; plan = { initial, added, removed, readded: [[key]], done }. */
  async function runSprint(rec, plan) {
    if (!passed(rec, 'filled')) {
      const have = await sprintKeys(rec.id, plan.initial);
      await move(rec.id, plan.initial.filter((k) => !have.has(k)), true);
      rec.initial = plan.initial;
      await phase(rec, 'filled');
    }
    if (!passed(rec, 'started')) {
      const s = await api('GET', `/rest/agile/1.0/sprint/${rec.id}`);
      rec.startedAt = s.state === 'future' ? await start(rec.id) : Date.parse(s.startDate);
      await phase(rec, 'started');
      await sleep(3000);
    }
    await membership(rec, 'added', plan.added, true);
    await membership(rec, 'removed', plan.removed, false);
    await membership(rec, 'readded', plan.readded, true);
    if (!passed(rec, 'done')) {
      await toDone(plan.done);
      rec.done = plan.done;
      await phase(rec, 'done');
    }
    if (!passed(rec, 'closed')) {
      let s = await api('GET', `/rest/agile/1.0/sprint/${rec.id}`);
      if (s.state !== 'closed') {
        rec.closedAt = Date.now();
        await save();
        s = await setState(rec.id, { state: 'closed' });
      }
      await phase(rec, 'closed');
      await closeLog(rec, s, sprintField);
      await checkComposition(rec);
    }
  }

  const bySprintNo = (a, b) => Number(a.name.split('S')[1]) - Number(b.name.split('S')[1]);
  for (let s = 1; s <= Math.min(limit, CLOSED); s += 1) {
    const name = `${KEY} S${s}`;
    const rec = await open(name, seed.sprints.find((x) => x.name === name), (r) => {
      seed.sprints = seed.sprints.filter((x) => x.name !== name).concat(r).sort(bySprintNo);
    });
    if (!rec) continue;
    const block = pickKeys.slice((s - 1) * PER, s * PER);
    const initial = block.slice(0, 20);
    await runSprint(rec, {
      initial,
      added: block.slice(20).map((k) => [k]),
      removed: initial.slice(17, 20).map((k) => [k]),
      readded: initial.slice(19, 20).map((k) => [k]),
      done: initial.slice(0, 10),
    });
  }

  if (full) {
    const rec = await open(`${KEY} SB`, seed.big, (r) => { seed.big = r; });
    if (rec) {
      const initial = bigKeys.slice(0, 1100);
      await runSprint(rec, { initial, added: chunks(bigKeys.slice(1100), 50), removed: chunks(initial.slice(0, 1050), 50), readded: [], done: bigKeys.slice(1100) });
    }
  }

  {
    const rec = await open('Sprint 1', seed.sprint1, (r) => { seed.sprint1 = r; });
    if (rec) {
      const initial = pickKeys.slice(CLOSED * PER, CLOSED * PER + 10);
      await runSprint(rec, { initial, added: [], removed: [], readded: [], done: initial.slice(0, 5) });
    }
  }

  if (full) {
    const rec = await open(`${KEY} S31`, seed.active, (r) => { seed.active = r; });
    if (rec) {
      const initial = pickKeys.slice(CLOSED * PER + 10, CLOSED * PER + 30);
      const have = await sprintKeys(rec.id, initial);
      await move(rec.id, initial.filter((k) => !have.has(k)), true);
      const s = await api('GET', `/rest/agile/1.0/sprint/${rec.id}`);
      if (s.state === 'future') await start(rec.id);
      delete rec.phase;
      await save();
    }
    for (const n of [32, 33]) {
      const fname = `${KEY} S${n}`;
      const rec = await open(fname, (seed.future ?? []).find((x) => x.name === fname), (r) => {
        seed.future = (seed.future ?? []).filter((x) => x.name !== fname).concat(r);
      });
      if (rec) {
        delete rec.phase;
        await save();
      }
    }
  }

  await log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${seed.sprints.length} closed sprints in the seed; requests ${JSON.stringify(stats)}`);
}

main().catch(async (e) => {
  await log(`FAILED: ${e.stack}`);
  process.exit(1);
});
