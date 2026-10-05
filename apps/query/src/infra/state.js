import { ERROR_LOG_SIZE, JOB_PAGE, PAGE_CACHE_MS } from '../core/limits.js';

const JOB_PREFIX = 'q:job:';
const HEAVY_PREFIX = 'q:hq:';

const INDEX_PARTS = ['sprint', 'comments'];

/** The points a stored job or lane entry keeps (`pts`, `floor`), when it has them. */
export const keptPoints = (record) => (record?.pts === undefined ? {} : { pts: record.pts, floor: Boolean(record.floor), ...(record.floorAt ? { floorAt: record.floorAt } : {}) });

/** KVS records of the refresh machinery, the error log, index progress and settings; each background job has its own key `q:job:<hash(group)>`, each group waiting in the heavy lane `q:hq:<hash(group)>` (both may keep the Jira points the group spent, `pts`, and whether they are a lower bound, `floor`; a job added again without them keeps the stored ones), the start of the computation that last wrote a group `q:gw:<hash(group)>`, the start of the pass that skipped a group outside the used window `q:skip:<hash(group)>`, and the projects an index part fills once its running fill ends `idx:waiting:<part>`, the journal cut of a pass the points budget stopped `q:cut` (`{ key, startedAt, done }`), the end and reason of a pause of the background work for Jira's rate limit `q:brake` and the time of the wake scheduled for it `q:wake`, and the cached Jira field list `cfg:fields`. */
export function createState({ kvs, hash, beginsWith }) {
  const record = (key) => ({
    get: async () => (await kvs.get(key)) ?? null,
    set: (value) => kvs.set(key, value),
    clear: () => kvs.delete(key),
  });
  const progressKey = (part) => `idx:progress:${part}`;
  const waitingKey = (part) => `idx:waiting:${part}`;
  const jobKey = (group) => `${JOB_PREFIX}${hash(group)}`;
  const heavyKey = (group) => `${HEAVY_PREFIX}${hash(group)}`;
  async function withPrefix(prefix) {
    const rows = [];
    let cursor;
    do {
      const query = kvs.query().where('key', beginsWith(prefix)).limit(JOB_PAGE);
      const page = await (cursor ? query.cursor(cursor) : query).getMany();
      rows.push(...(page.results ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  }
  return {
    pending: record('q:pending'),
    lease: record('q:running'),
    lastWrittenStart: record('q:lastWrittenStart'),
    cut: record('q:cut'),
    lastRefresh: record('log:refresh'),
    brake: record('q:brake'),
    wake: record('q:wake'),
    sprintFields: record('cfg:sprintFields'),
    statuses: record('cfg:status'),
    recentIndex: record('idx:recent'),
    prepared: record('idx:prepared'),
    fields: record('cfg:fields'),
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
    waiting: {
      get: async (part) => (await kvs.get(waitingKey(part))) ?? [],
      async add(part, projects) {
        const list = (await kvs.get(waitingKey(part))) ?? [];
        const known = new Set(list.map((p) => p.key));
        await kvs.set(waitingKey(part), [...list, ...projects.filter((p) => !known.has(p.key))]);
      },
      async remove(part, keys) {
        const left = ((await kvs.get(waitingKey(part))) ?? []).filter((p) => !keys.includes(p.key));
        await (left.length ? kvs.set(waitingKey(part), left) : kvs.delete(waitingKey(part)));
      },
      clear: (part) => kvs.delete(waitingKey(part)),
    },
    excluded: async () => (await kvs.get('cfg:excluded')) ?? [],
    setExcluded: (keys) => kvs.set('cfg:excluded', [...new Set(keys)].sort()),
    async recordError({ at, functionName, message }) {
      const list = (await kvs.get('log:errors')) ?? [];
      await kvs.set('log:errors', [{ at, functionName, message }, ...list].slice(0, ERROR_LOG_SIZE));
    },
    errors: async () => (await kvs.get('log:errors')) ?? [],
    async addJob(job) {
      if (job.pts !== undefined) return kvs.set(jobKey(job.key), job);
      const kept = await kvs.get(jobKey(job.key));
      return kvs.set(jobKey(job.key), { ...job, ...keptPoints(kept) });
    },
    job: async (key) => (await kvs.get(jobKey(key))) ?? null,
    heavy: {
      lease: record('q:heavy'),
      get: async (key) => (await kvs.get(heavyKey(key))) ?? null,
      put: (job) => kvs.set(heavyKey(job.key), job),
      take: (key) => kvs.delete(heavyKey(key)),
      all: async () => (await withPrefix(HEAVY_PREFIX)).map((r) => r.value),
      async oldest() {
        const queued = (await withPrefix(HEAVY_PREFIX)).map((r) => r.value);
        return queued.reduce((a, b) => (a === null || b.at < a.at ? b : a), null);
      },
    },
    skip: {
      get: async (key) => (await kvs.get(`q:skip:${hash(key)}`)) ?? null,
      set: (key, at) => kvs.set(`q:skip:${hash(key)}`, at),
      clear: (key) => kvs.delete(`q:skip:${hash(key)}`),
    },
    groupWrite: {
      get: async (key) => (await kvs.get(`q:gw:${hash(key)}`)) ?? null,
      set: (key, startedAt) => kvs.set(`q:gw:${hash(key)}`, startedAt),
    },
    async jobs(now) {
      const rows = await withPrefix(JOB_PREFIX);
      const isLive = (job) => now - job.at < PAGE_CACHE_MS;
      for (const row of rows.filter((r) => !isLive(r.value))) {
        const current = await kvs.get(row.key);
        if (current && !isLive(current)) await kvs.delete(row.key);
      }
      return rows.map((r) => r.value).filter(isLive);
    },
  };
}
