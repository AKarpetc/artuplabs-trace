import { errorKindOf } from '../core/affected.js';
import { KVS_PAGE, PCS_CACHE_MS, PCS_CHUNK_MAX_BYTES, PCS_LEGACY_CHUNK, PCS_RECENT_PAGES, PCS_RECENT_SKEW_MS } from '../core/limits.js';

const META = 'q:pcs:m';
const DIRTY = 'q:pcs:dirty';
const ADDED = 'q:pcs:add:';
const chunkKey = (gen, i) => `q:pcs:${gen}:${i}`;
const chunkCount = (meta) => meta.chunks ?? Math.ceil((meta.n ?? 0) / PCS_LEGACY_CHUNK);
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
 * then drops the old one (a meta of the older format without `chunks` by PCS_LEGACY_CHUNK records a chunk); a list with a record longer
 * than a chunk is not stored, so each read asks Jira, and the older generation is dropped.
 */
export function createPcsCache({ kvs, jira, beginsWith, clock = Date.now, log = false }) {
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

  async function drop(meta) {
    for (let i = 0; i < chunkCount(meta); i += 1) await kvs.delete(chunkKey(meta.gen, i));
  }

  async function prune(at, list) {
    const listed = new Set(list.map((pc) => pc.id));
    for (const row of await added()) if (listed.has(row.value.id) || at - row.value.at >= PCS_CACHE_MS) await kvs.delete(row.key);
  }

  async function fresh(old, full) {
    const at = clock();
    const list = ((await full(() => jira.precomputations())) ?? []).map(slimRecord);
    const chunks = chunksOf(list);
    if (!chunks) {
      console.error('precomputation list not cached: a record is longer than a chunk');
      if (old) {
        await drop(old);
        await kvs.delete(META);
      }
      await prune(at, list);
      return list;
    }
    for (let i = 0; i < chunks.length; i += 1) await kvs.set(chunkKey(at, i), chunks[i]);
    await kvs.set(META, { at, n: list.length, gen: at, chunks: chunks.length });
    const won = (await kvs.get(META))?.gen === at;
    const stale = won ? old : { gen: at, chunks: chunks.length };
    if (stale && stale.gen !== (won ? at : null)) await drop(stale);
    await prune(at, list);
    return list;
  }

  async function recent(meta) {
    try {
      const { records, end } = await jira.recentPrecomputations(meta.at - PCS_RECENT_SKEW_MS);
      if (log && end === 'pages') console.log(`recently used precomputations cut at ${PCS_RECENT_PAGES} pages: ${records.length} read`);
      if (log && end === 'points') console.log(`recently used precomputations cut by the points budget: ${records.length} read`);
      return records.map(slimRecord);
    } catch (error) {
      if (error?.name !== 'JiraError') throw error;
      console.error(`recently used precomputations not read: ${error.status ?? ''}`);
      return [];
    }
  }

  return {
    /**
     * The precomputation list: the cached chunks while they are fresh, with the precomputations Jira used since they were read laid over
     * them (else Jira's whole list, read inside `full`), and the records function calls added over that.
     */
    async list({ full = (task) => task() } = {}) {
      const meta = await kvs.get(META);
      const cached = await stored(meta);
      const newer = new Map((cached ? await recent(meta) : []).map((pc) => [pc.id, pc]));
      const known = new Set((cached ?? []).map((pc) => pc.id));
      const base = cached ? [...cached.map((pc) => newer.get(pc.id) ?? pc), ...[...newer.values()].filter((pc) => !known.has(pc.id))] : await fresh(meta, full);
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
