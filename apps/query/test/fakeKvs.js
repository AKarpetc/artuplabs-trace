/** In-memory KVS with get/set/delete and a key-prefix query that returns at most `pageSize` results per page; a value whose JSON is longer than `maxBytes` is refused as Forge refuses it. */
export function createFakeKvs({ pageSize = 2, maxBytes = Infinity } = {}) {
  const data = new Map();
  const calls = { queries: 0, ops: [] };
  const kvs = {
    data,
    calls,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : undefined;
    },
    async set(key, value) {
      calls.ops.push(`set ${key}`);
      if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw Object.assign(new Error('value too large'), { name: 'KvsError' });
      data.set(key, structuredClone(value));
    },
    async delete(key) {
      calls.ops.push(`delete ${key}`);
      data.delete(key);
    },
    query() {
      const state = { prefix: '', limit: 10, cursor: undefined };
      const builder = {
        where(field, clause) {
          state.prefix = String(clause.values[0]);
          return builder;
        },
        limit(n) {
          state.limit = n;
          return builder;
        },
        cursor(c) {
          state.cursor = c;
          return builder;
        },
        async getMany() {
          calls.queries += 1;
          const keys = [...data.keys()].filter((k) => k.startsWith(state.prefix)).sort();
          const start = state.cursor ? Number(state.cursor) : 0;
          const size = Math.min(state.limit, pageSize);
          const page = keys.slice(start, start + size);
          const next = start + size < keys.length ? String(start + size) : undefined;
          return { results: page.map((key) => ({ key, value: structuredClone(data.get(key)) })), nextCursor: next };
        },
      };
      return builder;
    },
  };
  return kvs;
}

/** WhereConditions.beginsWith as @forge/kvs builds it. */
export const beginsWith = (value) => ({ condition: 'BEGINS_WITH', values: [value] });
