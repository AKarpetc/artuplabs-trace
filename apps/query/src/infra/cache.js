import { CACHE_CHUNK } from '../core/limits.js';

/** Value cache of a precomputation group: meta `v:<h>:m`, values `v:<h>:c<i>`, watched ids `v:<h>:w<i>`, ≤ 5 000 ids per key. */
export function createValueCache({ kvs, hash }) {
  const base = (key) => `v:${hash(key)}`;

  async function readChunks(prefix, from, to) {
    const first = Math.floor(from / CACHE_CHUNK);
    const out = [];
    for (let c = first; c * CACHE_CHUNK < to; c += 1) out.push(...((await kvs.get(`${prefix}${c}`)) ?? []));
    return out.slice(from - first * CACHE_CHUNK, to - first * CACHE_CHUNK);
  }

  async function writeChunks(prefix, list, oldCount) {
    const count = Math.ceil(list.length / CACHE_CHUNK);
    for (let c = 0; c < count; c += 1) await kvs.set(`${prefix}${c}`, list.slice(c * CACHE_CHUNK, (c + 1) * CACHE_CHUNK));
    for (let c = count; c < oldCount; c += 1) await kvs.delete(`${prefix}${c}`);
  }

  async function meta(key) {
    return (await kvs.get(`${base(key)}:m`)) ?? null;
  }

  return {
    meta,
    values: (key, m, from, to) => readChunks(`${base(key)}:c`, from, Math.min(to, m.n)),
    async watch(key) {
      const m = await meta(key);
      if (!m || m.nw === null || m.nw === undefined) return null;
      return new Set(await readChunks(`${base(key)}:w`, 0, m.nw));
    },
    async write(key, { values, watch, field, rootFilter, at, source }) {
      const old = await meta(key);
      await writeChunks(`${base(key)}:c`, values, Math.ceil((old?.n ?? 0) / CACHE_CHUNK));
      await writeChunks(`${base(key)}:w`, watch ?? [], Math.ceil((old?.nw ?? 0) / CACHE_CHUNK));
      await kvs.set(`${base(key)}:m`, { at, n: values.length, nw: watch ? watch.length : null, field, rootFilter: rootFilter ?? null, source });
    },
  };
}
