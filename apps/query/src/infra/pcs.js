import { errorKindOf } from '../core/affected.js';
import { KVS_PAGE, PCS_CACHE_MS, PCS_CHUNK_MAX_BYTES } from '../core/limits.js';

const META = 'q:pcs:m';
const DIRTY = 'q:pcs:dirty';
const ADDED = 'q:pcs:add:';
const chunkKey = (gen, i) => `q:pcs:${gen}:${i}`;
const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value));

/** Slim records cut into chunks whose JSON stays within PCS_CHUNK_MAX_BYTES, or null when one record alone is longer. */
export function chunksOf(list, maxBytes = PCS_CHUNK_MAX_BYTES) {
  const chunks = [];
  let chunk = [];
  let size = 2;
  for (const record of list) {
    const bytes = bytesOf(record) + 1;
    if (bytes + 2 > maxBytes) return null;
    if (chunk.length && size + bytes > maxBytes) {
      chunks.push(chunk);
      chunk = [];
      size = 2;
    }
    chunk.push(record);
    size += bytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** A precomputation as the cache keeps it: no value, no error text, only whether each is stored and the kind of the error. */
export const slimRecord = (pc) => ({
  id: pc.id,
  functionName: pc.functionName,
  arguments: pc.arguments ?? [],
  operator: pc.operator,
  used: pc.used ?? null,
  updated: pc.updated ?? null,
  created: pc.created ?? null,
  hasValue: Boolean(pc.value),
  errorKind: errorKindOf(pc.error),
});

/**
 * Cache of Jira's precomputation list in KVS: chunks `q:pcs:<gen>:<i>` of slim records within PCS_CHUNK_MAX_BYTES and `q:pcs:m`
 * `{ at, n, gen, chunks }`, plus the records function calls add as Jira creates their precomputations (`q:pcs:add:<id>`, newer than the
 * chunks). Jira is read again after PCS_CACHE_MS, after `markDirty` or when a chunk is missing; whoever reads it writes a new generation,
 * then drops the old one; a list with a record longer than a chunk is not stored, so each read asks Jira.
 */
export function createPcsCache({ kvs, jira, beginsWith, clock = Date.now }) {
  async function added() {
    const rows = [];
    let cursor;
    do {
      const query = kvs.query().where('key', beginsWith(ADDED)).limit(KVS_PAGE);
      const page = await (cursor ? query.cursor(cursor) : query).getMany();
      rows.push(...(page.results ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  }

  async function stored(meta) {
    const dirty = await kvs.get(DIRTY);
    if (!meta || !Number.isInteger(meta.chunks) || clock() - meta.at >= PCS_CACHE_MS || (dirty ?? 0) > meta.at) return null;
    const chunks = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => kvs.get(chunkKey(meta.gen, i))));
    return chunks.every(Array.isArray) ? chunks.flat() : null;
  }

  async function fresh(old) {
    const at = clock();
    const list = ((await jira.precomputations()) ?? []).map(slimRecord);
    const chunks = chunksOf(list);
    if (!chunks) {
      console.error('precomputation list not cached: a record is longer than a chunk');
      return list;
    }
    for (let i = 0; i < chunks.length; i += 1) await kvs.set(chunkKey(at, i), chunks[i]);
    await kvs.set(META, { at, n: list.length, gen: at, chunks: chunks.length });
    const won = (await kvs.get(META))?.gen === at;
    const stale = won ? old : { gen: at, chunks: chunks.length };
    if (stale && stale.gen !== (won ? at : null)) for (let i = 0; i < (stale.chunks ?? 0); i += 1) await kvs.delete(chunkKey(stale.gen, i));
    const listed = new Set(list.map((pc) => pc.id));
    for (const row of await added()) if (listed.has(row.value.id) || at - row.value.at >= PCS_CACHE_MS) await kvs.delete(row.key);
    return list;
  }

  return {
    /** The precomputation list: the cached chunks while they are fresh (else Jira's), with the records function calls added over them. */
    async list() {
      const meta = await kvs.get(META);
      const base = (await stored(meta)) ?? (await fresh(meta));
      const extra = new Map((await added()).map((row) => [row.value.id, row.value.record]));
      return [...base.filter((pc) => !extra.has(pc.id)), ...extra.values()];
    },
    /** Adds the record of a precomputation Jira creates from a function's answer, so passes see it before the list is read again. */
    add({ id, functionName, arguments: args, operator, hasValue, errorKind = null }) {
      const now = new Date(clock()).toISOString();
      const record = { id, functionName, arguments: args ?? [], operator, used: now, updated: now, created: now, hasValue, errorKind };
      return kvs.set(`${ADDED}${id}`, { id, at: clock(), record });
    },
    /** Marks the cached list stale, so the next read asks Jira (when a function call could not add its record). */
    markDirty: () => kvs.set(DIRTY, clock()),
  };
}
