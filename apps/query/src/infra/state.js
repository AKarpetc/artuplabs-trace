import { ERROR_LOG_SIZE, PAGE_CACHE_MS } from '../core/limits.js';

const INDEX_PARTS = ['sprint', 'comments'];

/** KVS records of the refresh machinery, the error log, index progress and settings. */
export function createState({ kvs }) {
  const record = (key) => ({
    get: async () => (await kvs.get(key)) ?? null,
    set: (value) => kvs.set(key, value),
    clear: () => kvs.delete(key),
  });
  const progressKey = (part) => `idx:progress:${part}`;
  return {
    pending: record('q:pending'),
    lease: record('q:running'),
    lastWrittenStart: record('q:lastWrittenStart'),
    lastRefresh: record('log:refresh'),
    progress: {
      async get() {
        const values = await Promise.all(INDEX_PARTS.map((part) => kvs.get(progressKey(part))));
        const found = INDEX_PARTS.flatMap((part, i) => (values[i] ? [[part, values[i]]] : []));
        return found.length ? Object.fromEntries(found) : null;
      },
      getPart: async (part) => (await kvs.get(progressKey(part))) ?? null,
      setPart: (part, value) => kvs.set(progressKey(part), value),
      clearPart: (part) => kvs.delete(progressKey(part)),
    },
    excluded: async () => (await kvs.get('cfg:excluded')) ?? [],
    setExcluded: (keys) => kvs.set('cfg:excluded', [...new Set(keys)].sort()),
    async recordError({ at, functionName, message }) {
      const list = (await kvs.get('log:errors')) ?? [];
      await kvs.set('log:errors', [{ at, functionName, message }, ...list].slice(0, ERROR_LOG_SIZE));
    },
    errors: async () => (await kvs.get('log:errors')) ?? [],
    async addJob(job) {
      const list = (await kvs.get('q:jobs')) ?? [];
      await kvs.set('q:jobs', [job, ...list.filter((j) => j.key !== job.key)]);
    },
    async jobs(now) {
      const list = (await kvs.get('q:jobs')) ?? [];
      const live = list.filter((j) => now - j.at < PAGE_CACHE_MS);
      if (live.length !== list.length) await kvs.set('q:jobs', live);
      return live;
    },
  };
}
