import { TEMPLATE_MAX_PARTS } from './limits.js';

const PAGE = 100;

const metaKey = (scope, scopeId, id) => `tpl:${scope}:${scopeId}:${id}`;
const indexKey = (id) => `tplid:${id}`;
const partKey = (id, n) => `tplbin:${id}:${n}`;

/** Template storage in KVS: metadata by scope, an id index and .docx parts. */
export function createTemplateStore({ kvs, beginsWith, newId }) {
  async function list(scope, scopeId) {
    const prefix = `tpl:${scope}:${scopeId}:`;
    const found = [];
    let cursor;
    do {
      let query = kvs.query().where('key', beginsWith(prefix)).limit(PAGE);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      found.push(...(page.results ?? []).map((r) => r.value));
      cursor = page.nextCursor;
    } while (cursor);
    return found;
  }

  async function get(id) {
    const index = await kvs.get(indexKey(id));
    if (!index) return undefined;
    return kvs.get(metaKey(index.scope, index.scopeId, id));
  }

  async function save(meta) {
    const saved = { ...meta, id: meta.id ?? newId() };
    await kvs.set(metaKey(saved.scope, saved.scopeId, saved.id), saved);
    await kvs.set(indexKey(saved.id), { scope: saved.scope, scopeId: saved.scopeId });
    return saved;
  }

  async function removePartsFrom(id, n) {
    for (let i = n; i < TEMPLATE_MAX_PARTS; i += 1) await kvs.delete(partKey(id, i));
  }

  async function remove(id) {
    const index = await kvs.get(indexKey(id));
    if (index) await kvs.delete(metaKey(index.scope, index.scopeId, id));
    await kvs.delete(indexKey(id));
    await removePartsFrom(id, 0);
  }

  return {
    list,
    get,
    save,
    remove,
    removePartsFrom,
    putPart: (id, n, data) => kvs.set(partKey(id, n), data),
    getPart: (id, n) => kvs.get(partKey(id, n)),
  };
}
