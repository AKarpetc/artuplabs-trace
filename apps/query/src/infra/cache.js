import { CACHE_CHUNK, REFRESH_GROUP_BUDGET_MS } from '../core/limits.js';

const chunksOf = (list) => Array.from({ length: Math.ceil(list.length / CACHE_CHUNK) }, (_, i) => list.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK));
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isHeavy = (ms) => (ms ?? 0) >= REFRESH_GROUP_BUDGET_MS;
const rangeOf = (chunk) => {
  const sorted = chunk.map(Number).sort((a, b) => a - b);
  return [String(sorted[0]), String(sorted[sorted.length - 1])];
};
const covers = ([low, high], id) => Number(id) >= Number(low) && Number(id) <= Number(high);
const hashesOf = (m) => new Set([...(m?.c ?? []), ...(m?.w ?? [])]);
const sameChunks = (a, b) => Boolean(a) && Boolean(b) && sameList(a.c ?? [], b.c ?? []) && sameList(a.w ?? [], b.w ?? []);

/**
 * Value cache of a precomputation group: meta `v:<h>:m` lists the content hashes of its value chunks (`c`) and watched-id chunks (`w`),
 * each stored once as `v:<h>:k<hash>` (≤ 5 000 ids). A write stores only chunks it does not have yet, rewrites the meta only when something
 * a reader uses changed, then deletes chunks nothing references; a read that meets a missing chunk answers null, never a partial list.
 * The meta also keeps the lowest and highest id of each watch chunk (`wr`), so a membership check reads only the chunks that can hold an id,
 * and, when given, the Jira points the computation cost (`pts`; the meta is rewritten only when `costClass` of it changes) and the levels of
 * the stored tree (`lv`), and whether every precomputation of the group was written with this value (`posted`).
 * Writers are ordered by the start of their computation (`startedAt` in the meta): an older computation never replaces a newer one, a writer
 * re-stores reused chunks a concurrent writer removed, deletes chunks only while its own meta is the current one, and a read that finds a
 * chunk of the current meta gone drops that meta, so the group is computed and stored again.
 */
export function createValueCache({ kvs, hash, chunkHash = hash, costClass = (pts) => pts }) {
  const base = (key) => `v:${hash(key)}`;
  const chunkKey = (key, h) => `${base(key)}:k${h}`;

  async function meta(key) {
    return (await kvs.get(`${base(key)}:m`)) ?? null;
  }

  async function dropIfDangling(key, missing) {
    const current = await meta(key);
    if (current && hashesOf(current).has(missing)) await kvs.delete(`${base(key)}:m`);
  }

  async function readChunk(key, h) {
    const chunk = await kvs.get(chunkKey(key, h));
    if (!chunk) await dropIfDangling(key, h);
    return chunk ?? null;
  }

  async function readChunks(key, hashes, from, to) {
    const first = Math.floor(from / CACHE_CHUNK);
    const out = [];
    for (let c = first; c * CACHE_CHUNK < to; c += 1) {
      const chunk = await readChunk(key, hashes[c]);
      if (!chunk) return null;
      out.push(...chunk);
    }
    return out.slice(from - first * CACHE_CHUNK, to - first * CACHE_CHUNK);
  }

  async function storeChunks(key, list, known, contents) {
    const hashes = [];
    for (const chunk of chunksOf(list)) {
      const h = chunkHash(JSON.stringify(chunk));
      contents.set(h, chunk);
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
    /** Takes the posted mark off a group's meta: a precomputation Jira creates may hold a value its other writes never saw. */
    async unpost(key) {
      const m = await meta(key);
      if (!m?.posted || (await meta(key))?.startedAt !== m.startedAt) return;
      const { posted, ...rest } = m;
      await kvs.set(`${base(key)}:m`, rest);
    },
    /** Whether a computed entry holds what the meta describes: the same value chunks, count, field, filter and tree levels. */
    matches(m, entry) {
      if (!m) return false;
      const c = chunksOf(entry.values).map((chunk) => chunkHash(JSON.stringify(chunk)));
      return m.n === entry.values.length && sameList(m.c ?? [], c) && m.field === entry.field && (m.rootFilter ?? null) === (entry.rootFilter ?? null)
        && (m.lv ?? null) === (entry.lv ?? null);
    },
    values: (key, m, from, to) => readChunks(key, m.c ?? [], from, Math.min(to, m.n)),
    async watchHit(key, ids) {
      const m = await meta(key);
      if (!m || m.nw === null || m.nw === undefined) return null;
      if (!Array.isArray(m.wr)) {
        const list = await readChunks(key, m.w ?? [], 0, m.nw);
        return list ? ids.some((id) => list.includes(String(id))) : null;
      }
      for (let c = 0; c < m.wr.length; c += 1) {
        const wanted = ids.filter((id) => covers(m.wr[c], id)).map(String);
        if (!wanted.length) continue;
        const chunk = await readChunk(key, m.w[c]);
        if (!chunk) return null;
        if (wanted.some((id) => chunk.includes(id))) return true;
      }
      return false;
    },
    async watch(key) {
      const m = await meta(key);
      if (!m || m.nw === null || m.nw === undefined) return null;
      const list = await readChunks(key, m.w ?? [], 0, m.nw);
      return list ? new Set(list) : null;
    },
    async write(key, { values, watch, field, rootFilter, at, source, ms = null, pts = null, lv = null, posted = false, startedAt = 0 }) {
      const old = await meta(key);
      if ((old?.startedAt ?? 0) > startedAt) return;
      const oldHashes = hashesOf(old);
      const known = new Set(oldHashes);
      const contents = new Map();
      const c = await storeChunks(key, values, known, contents);
      const w = await storeChunks(key, watch ?? [], known, contents);
      const wr = watch ? chunksOf(watch).map(rangeOf) : null;
      const next = { at, startedAt, n: values.length, nw: watch ? watch.length : null, field, rootFilter: rootFilter ?? null, source, c, w, ...(wr ? { wr } : {}), ...(ms === null ? {} : { ms }), ...(pts === null ? {} : { pts }), ...(lv === null ? {} : { lv }), ...(posted ? { posted } : {}) };
      const unchanged = old && old.n === next.n && old.nw === next.nw && old.field === next.field && old.rootFilter === next.rootFilter
        && old.source === source && sameList(old.c ?? [], c) && sameList(old.w ?? [], w) && isHeavy(old.ms) === isHeavy(next.ms)
        && (wr === null || Array.isArray(old.wr)) && costClass(old.pts ?? null) === costClass(pts) && (old.lv ?? null) === lv && Boolean(old.posted) === posted;
      if (unchanged && source !== 'job') return;
      const current = await meta(key);
      if ((current?.startedAt ?? 0) > startedAt) return;
      const used = new Set([...c, ...w]);
      if (!sameChunks(current, old)) {
        const present = hashesOf(current);
        for (const h of used) if (oldHashes.has(h) && !present.has(h)) await kvs.set(chunkKey(key, h), contents.get(h));
      }
      await kvs.set(`${base(key)}:m`, next);
      const after = await meta(key);
      if (!sameChunks(after, next) || after.startedAt !== startedAt) return;
      for (const h of new Set([...oldHashes, ...hashesOf(current)])) if (!used.has(h)) await kvs.delete(chunkKey(key, h));
    },
  };
}
