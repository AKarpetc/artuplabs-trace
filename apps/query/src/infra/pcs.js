import { errorKindOf } from '../core/affected.js';
import { PCS_CACHE_MS, PCS_CHUNK } from '../core/limits.js';

const META = 'q:pcs:m';
const DIRTY = 'q:pcs:dirty';
const chunkKey = (i) => `q:pcs:${i}`;

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
 * Cache of Jira's precomputation list in KVS: `q:pcs:<i>` hold PCS_CHUNK slim records each and `q:pcs:m` `{ at, n }`; the list is read from
 * Jira again after PCS_CACHE_MS, after a function call marked it stale (`q:pcs:dirty`) or when a chunk is missing. Whoever reads Jira writes it.
 */
export function createPcsCache({ kvs, jira, clock = Date.now }) {
  async function stored() {
    const [meta, dirty] = await Promise.all([kvs.get(META), kvs.get(DIRTY)]);
    if (!meta || clock() - meta.at >= PCS_CACHE_MS || (dirty ?? 0) > meta.at) return null;
    const chunks = await Promise.all(Array.from({ length: Math.ceil(meta.n / PCS_CHUNK) }, (_, i) => kvs.get(chunkKey(i))));
    return chunks.every(Array.isArray) ? chunks.flat() : null;
  }

  async function fresh() {
    const at = clock();
    const list = ((await jira.precomputations()) ?? []).map(slimRecord);
    const old = (await kvs.get(META))?.n ?? 0;
    const count = Math.ceil(list.length / PCS_CHUNK);
    for (let i = 0; i < count; i += 1) await kvs.set(chunkKey(i), list.slice(i * PCS_CHUNK, (i + 1) * PCS_CHUNK));
    await kvs.set(META, { at, n: list.length });
    for (let i = count; i < Math.ceil(old / PCS_CHUNK); i += 1) await kvs.delete(chunkKey(i));
    return list;
  }

  return {
    /** The precomputation list, from the cache while it is fresh, else from Jira. */
    list: async () => (await stored()) ?? fresh(),
    /** Marks the cached list stale, so the next read asks Jira (a function call made Jira create a precomputation). */
    markDirty: () => kvs.set(DIRTY, clock()),
  };
}
