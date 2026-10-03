/** KVS wrapper that counts writes: sets with their key and JSON bytes, and deletes; `take` returns the counts since the last take. */
export function meterKvs(kvs) {
  let totals = { sets: 0, bytes: 0, deletes: 0 };
  return {
    kvs: {
      get: (key) => kvs.get(key),
      query: () => kvs.query(),
      async set(key, value) {
        totals.sets += 1;
        totals.bytes += Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value) ?? '');
        return kvs.set(key, value);
      },
      async delete(key) {
        totals.deletes += 1;
        return kvs.delete(key);
      },
    },
    take() {
      const out = totals;
      totals = { sets: 0, bytes: 0, deletes: 0 };
      return out;
    },
  };
}

/** Wraps a handler so that, when enabled, it logs the KVS writes of each invocation as counts only (never keys or values); `name` may be a function of the handler arguments. */
export function withWriteLog(name, meter, enabled, handler) {
  return async (...args) => {
    meter.take();
    try {
      return await handler(...args);
    } finally {
      const w = meter.take();
      const label = typeof name === 'function' ? name(...args) : name;
      if (enabled && w.sets + w.deletes) console.log(`kvs writes ${label}: ${w.sets} sets, ${w.bytes} bytes, ${w.deletes} deletes`);
    }
  };
}
