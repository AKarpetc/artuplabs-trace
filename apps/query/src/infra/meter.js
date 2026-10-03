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

const empty = () => ({ sets: 0, bytes: 0, deletes: 0, families: {} });

/** KVS wrapper that counts writes: sets with their key and JSON bytes (in total and per record family), and deletes; `take` returns the counts since the last take. */
export function meterKvs(kvs) {
  let totals = empty();
  return {
    kvs: {
      get: (key) => kvs.get(key),
      query: () => kvs.query(),
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

/** Wraps a handler so that, when enabled, it logs the KVS writes of each invocation as counts per record family (never values); `name` may be a function of the handler arguments. */
export function withWriteLog(name, meter, enabled, handler) {
  return async (...args) => {
    meter.take();
    try {
      return await handler(...args);
    } finally {
      const w = meter.take();
      const label = typeof name === 'function' ? name(...args) : name;
      const detail = w.sets ? ` [${familyText(w.families)}]` : '';
      if (enabled && w.sets + w.deletes) console.log(`kvs writes ${label}: ${w.sets} sets, ${w.bytes} bytes, ${w.deletes} deletes${detail}`);
    }
  };
}
