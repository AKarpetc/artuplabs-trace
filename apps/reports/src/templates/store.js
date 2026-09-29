import { TEMPLATE_MAX_PARTS } from './limits.js';

const PAGE = 100;

const metaKey = (scope, scopeId, id) => `tpl:${scope}:${scopeId}:${id}`;
const indexKey = (id) => `tplid:${id}`;
const partKey = (id, gen, n) => `tplbin:${id}:${gen}:${n}`;

/** Template storage in KVS: metadata by scope, an id index and .docx parts grouped by upload generation. */
export function createTemplateStore({ kvs, beginsWith, newId }) {
  async function scan(prefix) {
    const found = [];
    let cursor;
    do {
      let query = kvs.query().where('key', beginsWith(prefix)).limit(PAGE);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      found.push(...(page.results ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return found;
  }

  async function list(scope, scopeId) {
    const found = await scan(`tpl:${scope}:${scopeId}:`);
    return found.map((r) => r.value).filter((m) => m?.scope === scope && m?.scopeId === scopeId);
  }

  async function get(id) {
    const index = await kvs.get(indexKey(id));
    if (!index) return undefined;
    return kvs.get(metaKey(index.scope, index.scopeId, id));
  }

  async function save(meta) {
    const saved = { ...meta, id: meta.id ?? newId() };
    await kvs.set(indexKey(saved.id), { scope: saved.scope, scopeId: saved.scopeId });
    await kvs.set(metaKey(saved.scope, saved.scopeId, saved.id), saved);
    return saved;
  }

  async function partIndexes(id, gen) {
    const prefix = `tplbin:${id}:${gen}:`;
    const found = await scan(prefix);
    return found.map((r) => Number(r.key.slice(prefix.length))).filter(Number.isInteger).sort((a, b) => a - b);
  }

  async function removeGeneration(id, gen) {
    for (let i = 0; i < TEMPLATE_MAX_PARTS; i += 1) await kvs.delete(partKey(id, gen, i));
  }

  async function remove(id) {
    const index = await kvs.get(indexKey(id));
    for (const { key } of await scan(`tplbin:${id}:`)) await kvs.delete(key);
    if (index) await kvs.delete(metaKey(index.scope, index.scopeId, id));
    await kvs.delete(indexKey(id));
  }

  return {
    list,
    get,
    save,
    remove,
    partIndexes,
    removeGeneration,
    putPart: (id, gen, n, data) => kvs.set(partKey(id, gen, n), data),
    getPart: (id, gen, n) => kvs.get(partKey(id, gen, n)),
  };
}
