import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createJournal } from '../../src/infra/journal.js';
import { createValueCache } from '../../src/infra/cache.js';
import { createState } from '../../src/infra/state.js';

/** A promise that never settles: a compute or a sleep that does not finish. */
export const never = () => new Promise(() => {});

/** n id strings starting at `from`. */
export const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

/** A `used` time inside the active window of the test clock. */
export const RECENT = new Date(999000).toISOString();

/** Handler dependencies over a fake KVS and a scripted Jira; records pushed jobs and written precomputations; `extra` overrides any field. */
export function makeDeps({ pcs = [], compute = {}, searches = {}, write, ...extra } = {}) {
  const kvs = createFakeKvs({ pageSize: 1000 });
  let now = 1000000;
  let tag = 0;
  const pushed = [];
  const written = [];
  const searched = [];
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
      writePrecomputations: write ?? (async (updates) => { written.push(...updates); }),
    },
    compute,
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
    ...extra,
  };
}
