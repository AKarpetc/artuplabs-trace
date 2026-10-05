import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createJournal } from '../../src/infra/journal.js';
import { createValueCache } from '../../src/infra/cache.js';
import { createState } from '../../src/infra/state.js';
import { createLedger, newProcessPoints } from '../../src/infra/points.js';
import { createJira, currentPoints, withPoints } from '../../src/infra/jira.js';

/** A promise that never settles: a compute or a sleep that does not finish. */
export const never = () => new Promise(() => {});

/** n id strings starting at `from`. */
export const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

/** A `used` time inside the active window of the test clock. */
export const RECENT = new Date(999000).toISOString();

/** Handler dependencies over a fake KVS and a scripted Jira; `invalid` maps a query to the text Jira's strict parser rejects it with; records pushed jobs, written precomputations and validated queries; `extra` overrides any field. */
export function makeDeps({ pcs = [], compute = {}, searches = {}, invalid = {}, write, ...extra } = {}) {
  const kvs = createFakeKvs({ pageSize: 1000 });
  let now = 1000000;
  let tag = 0;
  const pushed = [];
  const written = [];
  const searched = [];
  const validated = [];
  const deadlines = [];
  return {
    kvs,
    journal: createJournal({ kvs, beginsWith, random: () => String((tag += 1)).padStart(4, '0') }),
    cache: createValueCache({ kvs, hash: (s) => s }),
    state: createState({ kvs, hash: (s) => s, beginsWith }),
    queue: { push: async (body, delay) => { pushed.push([body, delay ?? null]); } },
    jira: {
      precomputations: async () => pcs,
      searchIds: async (jql, options = {}) => {
        searched.push([jql, options.reconcile ?? []]);
        const answer = searches[jql] ?? [];
        if (answer instanceof Error) throw answer;
        return answer;
      },
      validateJql: async (jql) => {
        validated.push(jql);
        if (invalid[jql]) throw Object.assign(new Error(invalid[jql]), { name: 'JiraError', status: 400 });
      },
      writePrecomputations: write ?? (async (updates) => { written.push(...updates); }),
    },
    compute,
    withDeadline: (deadline, task) => {
      deadlines.push(deadline);
      return task();
    },
    ready: async () => null,
    indexEvent: async () => null,
    indexReconcile: async () => null,
    hash: (s) => s,
    now: () => now,
    advance: (ms) => { now += ms; },
    sleep: never,
    levels: 1,
    pushed,
    written,
    searched,
    validated,
    deadlines,
    ...extra,
  };
}

/** An instant ten minutes into a UTC hour. */
export const BUDGET_AT = Date.parse('2026-10-05T07:10:00Z');

/** Gives handler dependencies a Jira points budget: a ledger over their KVS, the real points scopes, a site cap and an approximate count of `count` issues; the clock starts at `at`. */
export function withBudget(deps, { at = BUDGET_AT, cap = 10000, count = 0 } = {}) {
  let now = at;
  const counted = [];
  return Object.assign(deps, {
    now: () => now,
    advance: (ms) => { now += ms; },
    points: createLedger({ kvs: deps.kvs, beginsWith, clock: () => now, own: newProcessPoints('test') }),
    siteCap: cap,
    withPoints,
    currentPoints,
    counted,
    jira: { ...deps.jira, approximateCount: async (jql) => { counted.push(jql); return count; } },
  });
}

/** Spends `n` Jira points in the current points scope, as one search answer does. */
export function spend(n) {
  const issues = Array.from({ length: n - 1 }, (_, i) => ({ id: String(i) }));
  return createJira(async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ issues }) })).searchPage('x', null);
}
