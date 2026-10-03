import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createValueCache } from '../../src/infra/cache.js';
import { createState } from '../../src/infra/state.js';

/** A promise that never settles: a compute or a sleep that does not finish. */
export const never = () => new Promise(() => {});

/** Handler deps over an in-memory KVS: a movable clock, a recording queue and a never-ending budget sleep. */
export function makeDeps(compute, extra = {}) {
  const kvs = createFakeKvs({ pageSize: 100 });
  let now = 1000000;
  const pushed = [];
  return {
    kvs,
    cache: createValueCache({ kvs, hash: (s) => s }),
    state: createState({ kvs, hash: (s) => s, beginsWith }),
    queue: { push: async (body) => { pushed.push(body); } },
    compute,
    ready: async () => null,
    now: () => now,
    advance: (ms) => { now += ms; },
    sleep: never,
    levels: 1,
    pushed,
    ...extra,
  };
}
