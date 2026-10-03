import { CACHE_CHUNK } from '../core/limits.js';

const randomGen = () => Math.random().toString(36).slice(2);

/** Value cache of a precomputation group: meta `v:<h>:m` names the live generation of chunks `v:<h>:c<gen>_<i>` and `v:<h>:w<gen>_<i>`, ≤ 5 000 ids per key. */
export function createValueCache({ kvs, hash, random = randomGen }) {
  const base = (key) => `v:${hash(key)}`;
  const chunkKey = (key, kind, gen, c) => `${base(key)}:${kind}${gen}_${c}`;
  const chunkCount = (n) => Math.ceil((n ?? 0) / CACHE_CHUNK);

  async function readChunks(key, kind, gen, from, to) {
    const first = Math.floor(from / CACHE_CHUNK);
    const out = [];
    for (let c = first; c * CACHE_CHUNK < to; c += 1) out.push(...((await kvs.get(chunkKey(key, kind, gen, c))) ?? []));
    return out.slice(from - first * CACHE_CHUNK, to - first * CACHE_CHUNK);
  }

  async function writeChunks(key, kind, gen, list) {
    for (let c = 0; c < chunkCount(list.length); c += 1) {
      await kvs.set(chunkKey(key, kind, gen, c), list.slice(c * CACHE_CHUNK, (c + 1) * CACHE_CHUNK));
    }
  }

  async function dropChunks(key, kind, gen, from, to) {
    for (let c = from; c < to; c += 1) await kvs.delete(chunkKey(key, kind, gen, c));
  }

  async function meta(key) {
    return (await kvs.get(`${base(key)}:m`)) ?? null;
  }

  return {
    meta,
    values: (key, m, from, to) => readChunks(key, 'c', m.gen, from, Math.min(to, m.n)),
    async watch(key) {
      const m = await meta(key);
      if (!m || m.nw === null || m.nw === undefined) return null;
      return new Set(await readChunks(key, 'w', m.gen, 0, m.nw));
    },
    async write(key, { values, watch, field, rootFilter, at, source }) {
      const gen = random();
      await writeChunks(key, 'c', gen, values);
      await writeChunks(key, 'w', gen, watch ?? []);
      const old = await meta(key);
      const nw = watch ? watch.length : null;
      await kvs.set(`${base(key)}:m`, { at, n: values.length, nw, field, rootFilter: rootFilter ?? null, source, gen });
      if (!old) return;
      const same = old.gen === gen;
      await dropChunks(key, 'c', old.gen, same ? chunkCount(values.length) : 0, chunkCount(old.n));
      await dropChunks(key, 'w', old.gen, same ? chunkCount(nw) : 0, chunkCount(old.nw));
    },
  };
}
