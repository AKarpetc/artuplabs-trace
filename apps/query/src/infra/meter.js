import { DEFAULT_LANE } from '../core/points.js';
import { withPoints } from './jira.js';

const FAMILIES = [
  [/^v:[^:]+:m$/, 'cache-meta'],
  [/^v:[^:]+:k/, 'cache-chunk'],
  [/^t:/, 'journal'],
  [/^q:job:/, 'job'],
  [/^q:hq:/, 'heavy'],
  [/^q:gw:/, 'group-write'],
];
const HASHED = /^[0-9a-f]{16,}$|^\d+$/;

/** The record a KVS key belongs to, without the hashes, timestamps and tags inside it (fixed keys such as `q:running` name themselves). */
export function keyFamily(key) {
  const found = FAMILIES.find(([pattern]) => pattern.test(key));
  if (found) return found[1];
  return String(key).split(':').map((part) => (HASHED.test(part) ? '*' : part)).join(':');
}

const empty = () => ({ sets: 0, bytes: 0, deletes: 0, families: {}, reads: { gets: 0, queries: 0, bytes: 0 } });

const entryBytes = (key, value) => (value === undefined ? 0 : Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value) ?? ''));

const meteredQuery = (builder, count) => ({
  where: (...args) => meteredQuery(builder.where(...args), count),
  limit: (n) => meteredQuery(builder.limit(n), count),
  cursor: (c) => meteredQuery(builder.cursor(c), count),
  async getMany() {
    const page = await builder.getMany();
    count(page?.results ?? []);
    return page;
  },
});

/**
 * KVS wrapper that counts writes (sets with their key and JSON bytes, in total and per record family, and deletes) and reads (gets,
 * query pages and, when `readBytes`, the key and JSON bytes they return); `take` returns the counts since the last take. A query offers
 * only `where`, `limit`, `cursor` and `getMany`.
 */
export function meterKvs(kvs, { readBytes = true } = {}) {
  let totals = empty();
  const readSize = readBytes ? entryBytes : () => 0;
  return {
    kvs: {
      async get(key) {
        const value = await kvs.get(key);
        totals.reads.gets += 1;
        totals.reads.bytes += readSize(key, value);
        return value;
      },
      query: () => meteredQuery(kvs.query(), (results) => {
        totals.reads.queries += 1;
        totals.reads.bytes += results.reduce((sum, r) => sum + readSize(r.key, r.value), 0);
      }),
      async set(key, value) {
        const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value) ?? '');
        const family = keyFamily(key);
        const f = totals.families[family] ?? { sets: 0, bytes: 0 };
        totals.families[family] = { sets: f.sets + 1, bytes: f.bytes + bytes };
        totals.sets += 1;
        totals.bytes += bytes;
        return kvs.set(key, value);
      },
      async delete(key) {
        totals.deletes += 1;
        return kvs.delete(key);
      },
    },
    take() {
      const out = totals;
      totals = empty();
      return out;
    },
  };
}

const familyText = (families) => Object.entries(families).sort(([a], [b]) => a.localeCompare(b)).map(([name, f]) => `${name} ${f.sets}/${f.bytes}`).join(', ');

const requestText = (counts) => Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([endpoint, c]) => `${endpoint} ${c.requests}${c.limited ? ` (429: ${c.limited})` : ''}${c.rate ? ` [${c.rate}]` : ''}`).join(', ');

/**
 * Wraps a handler so that it runs in a points scope of its lane (`lane`, or a function of the handler arguments; the function lane by
 * default), writes the points ledger when it ends, and logs the KVS traffic of each invocation as counts, never values: writes per record
 * family when `log.writes`, reads when `log.reads`, Jira requests per endpoint when `log.requests`; `name` may be a function of the handler arguments.
 */
export function withKvsLog(name, meter, log, handler, lane = DEFAULT_LANE) {
  return async (...args) => {
    meter.take();
    meter.takeRequests?.();
    try {
      return await withPoints(Infinity, () => handler(...args), { scope: 'call', lane: typeof lane === 'function' ? lane(...args) : lane });
    } finally {
      await meter.points?.flush();
      const w = meter.take();
      const label = typeof name === 'function' ? name(...args) : name;
      const detail = w.sets ? ` [${familyText(w.families)}]` : '';
      if (log.writes && w.sets + w.deletes) console.log(`kvs writes ${label}: ${w.sets} sets, ${w.bytes} bytes, ${w.deletes} deletes${detail}`);
      if (log.reads && w.reads.gets + w.reads.queries) console.log(`kvs reads ${label}: ${w.reads.gets} gets, ${w.reads.queries} query pages, ${w.reads.bytes} bytes`);
      const r = log.requests && meter.takeRequests ? requestText(meter.takeRequests()) : '';
      if (r) console.log(`jira requests ${label}: ${r}`);
    }
  };
}
