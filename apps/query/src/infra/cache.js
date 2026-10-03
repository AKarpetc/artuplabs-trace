import { CACHE_CHUNK, REFRESH_GROUP_BUDGET_MS } from '../core/limits.js';

const chunksOf = (list) => Array.from({ length: Math.ceil(list.length / CACHE_CHUNK) }, (_, i) => list.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK));
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isHeavy = (ms) => (ms ?? 0) >= REFRESH_GROUP_BUDGET_MS;

/**
 * Value cache of a precomputation group: meta `v:<h>:m` lists the content hashes of its value chunks (`c`) and watched-id chunks (`w`),
 * each stored once as `v:<h>:k<hash>` (≤ 5 000 ids). A write stores only chunks it does not have yet, rewrites the meta only when something
 * a reader uses changed, then deletes chunks nothing references; a read that meets a missing chunk answers null, never a partial list.
 */
export function createValueCache({ kvs, hash, chunkHash = hash }) {
  const base = (key) => `v:${hash(key)}`;
  const chunkKey = (key, h) => `${base(key)}:k${h}`;

  async function readChunks(key, hashes, from, to) {
    const first = Math.floor(from / CACHE_CHUNK);
    const out = [];
    for (let c = first; c * CACHE_CHUNK < to; c += 1) {
      const chunk = await kvs.get(chunkKey(key, hashes[c]));
      if (!chunk) return null;
      out.push(...chunk);
    }
    return out.slice(from - first * CACHE_CHUNK, to - first * CACHE_CHUNK);
  }

  async function meta(key) {
    return (await kvs.get(`${base(key)}:m`)) ?? null;
  }

  async function storeChunks(key, list, known) {
    const hashes = [];
    for (const chunk of chunksOf(list)) {
      const h = chunkHash(JSON.stringify(chunk));
      if (!known.has(h)) {
        await kvs.set(chunkKey(key, h), chunk);
        known.add(h);
      }
      hashes.push(h);
    }
    return hashes;
  }

  return {
    meta,
    values: (key, m, from, to) => readChunks(key, m.c ?? [], from, Math.min(to, m.n)),
    async watch(key) {
      const m = await meta(key);
      if (!m || m.nw === null || m.nw === undefined) return null;
      const list = await readChunks(key, m.w ?? [], 0, m.nw);
      return list ? new Set(list) : null;
    },
    async write(key, { values, watch, field, rootFilter, at, source, ms = null }) {
      const old = await meta(key);
      const oldHashes = new Set([...(old?.c ?? []), ...(old?.w ?? [])]);
      const known = new Set(oldHashes);
      const c = await storeChunks(key, values, known);
      const w = await storeChunks(key, watch ?? [], known);
      const next = { at, n: values.length, nw: watch ? watch.length : null, field, rootFilter: rootFilter ?? null, source, c, w, ...(ms === null ? {} : { ms }) };
      const unchanged = old && old.n === next.n && old.nw === next.nw && old.field === next.field && old.rootFilter === next.rootFilter
        && old.source === source && sameList(old.c ?? [], c) && sameList(old.w ?? [], w) && isHeavy(old.ms) === isHeavy(next.ms);
      if (unchanged && source !== 'job') return;
      await kvs.set(`${base(key)}:m`, next);
      const used = new Set([...c, ...w]);
      for (const h of oldHashes) if (!used.has(h)) await kvs.delete(chunkKey(key, h));
    },
  };
}
