import { createPool } from './pool.js';

const BATCH = 250;
const USERS_BATCH = 100;
const CQL_BATCH = 100;
const MAX_ATTEMPTS = 8;
const MAX_RETRY_AFTER_S = 120;
const MAX_BACKOFF_S = 30;
const TREE_TYPES = new Set(['page', 'folder']);

/** Confluence REST failure with its HTTP status. */
export class ConfluenceError extends Error {
  constructor(status, path) {
    super(`confluence ${status} ${path}`);
    this.name = 'ConfluenceError';
    this.status = status;
  }
}

const sanitize = (value) => String(value).replace(/["\\]/g, '');

function chunks(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}

/** Confluence REST client over requestConfluence with a concurrency pool, retries and cancellation. */
export function createConfluenceClient({ request, sleep, concurrency = 6, signal }) {
  const run = createPool(concurrency);
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const send = (path, parse) => run(async () => {
    for (let attempt = 0; ; attempt += 1) {
      checkAbort();
      let response;
      try {
        response = await request(path, { headers: { Accept: 'application/json' } });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (attempt >= MAX_ATTEMPTS - 1) throw new ConfluenceError(0, path);
        await sleep(Math.min(MAX_BACKOFF_S, 2 ** attempt) * 1000);
        continue;
      }
      if (response.ok) return parse(response);
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt >= MAX_ATTEMPTS - 1) throw new ConfluenceError(response.status, path);
      const header = Number(response.headers.get('retry-after'));
      await sleep((Number.isFinite(header) && header > 0 ? Math.min(MAX_RETRY_AFTER_S, header) : Math.min(MAX_BACKOFF_S, 2 ** attempt)) * 1000);
    }
  });
  const getJson = (path) => send(path, (r) => r.json());
  const all = async (path) => {
    const results = [];
    const seen = new Set();
    let next = path;
    let pageCount = 0;
    while (next) {
      if (seen.has(next) || pageCount >= 1000) throw new ConfluenceError(508, path);
      seen.add(next);
      pageCount += 1;
      const page = await getJson(next);
      results.push(...(page.results ?? []));
      next = page._links?.next ?? null;
    }
    return results;
  };
  return {
    async getSpace(key) {
      const page = await getJson(`/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}`);
      const space = page.results?.[0];
      if (!space) throw new ConfluenceError(404, `space ${key}`);
      return { id: String(space.id), key: space.key, name: space.name, homepageId: space.homepageId ? String(space.homepageId) : null };
    },
    async listRootPages(spaceId) {
      const rows = await all(`/wiki/api/v2/spaces/${spaceId}/pages?depth=root&limit=${BATCH}`);
      return rows.map((r) => ({ id: String(r.id), title: r.title, position: r.position ?? 0 })).sort((a, b) => a.position - b.position);
    },
    async listChildren(id, type = 'page') {
      const toRow = (r) => ({ id: String(r.id), title: r.title, position: r.childPosition ?? 0, type: r.type ?? 'page' });
      let rows;
      try {
        rows = await all(`/wiki/api/v2/${type === 'folder' ? 'folders' : 'pages'}/${id}/direct-children?limit=${BATCH}`);
      } catch (error) {
        if (type === 'folder' || error?.status !== 404) throw error;
        rows = await all(`/wiki/api/v2/pages/${id}/children?limit=${BATCH}`);
      }
      return rows.map(toRow).filter((r) => TREE_TYPES.has(r.type)).sort((a, b) => a.position - b.position);
    },
    async getPages(ids, { withBody }) {
      const validIds = ids.filter((id) => /^\d+$/.test(id));
      if (validIds.length === 0) return [];
      const batches = await Promise.all(chunks(validIds, BATCH).map((batch) => all(`/wiki/api/v2/pages?id=${batch.map(encodeURIComponent).join(',')}&limit=${BATCH}${withBody ? '&body-format=storage' : ''}`)));
      return batches.flat().map((p) => ({
        id: String(p.id), title: p.title, parentId: p.parentId ? String(p.parentId) : null, spaceId: String(p.spaceId),
        version: { number: p.version?.number ?? 0, createdAt: p.version?.createdAt ?? '', authorId: p.version?.authorId ?? null },
        body: withBody ? p.body?.storage?.value ?? '' : null,
      }));
    },
    async getLabels(pageId) {
      return (await all(`/wiki/api/v2/pages/${pageId}/labels?limit=${BATCH}`)).map((l) => l.name);
    },
    async getLabelsOf(ids) {
      const result = new Map();
      const validIds = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
      for (const batch of chunks(validIds, CQL_BATCH)) {
        const cql = `id in (${batch.join(',')})`;
        const page = await getJson(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${CQL_BATCH}&expand=content.metadata.labels`);
        (page.results ?? []).forEach((r) => {
          if (r.content?.id) result.set(String(r.content.id), (r.content.metadata?.labels?.results ?? []).map((l) => l.name));
        });
      }
      return result;
    },
    async listAttachments(pageId) {
      return (await all(`/wiki/api/v2/pages/${pageId}/attachments?limit=${BATCH}`)).map((a) => ({
        id: String(a.id), title: a.title, fileSize: a.fileSize ?? 0, mediaType: a.mediaType ?? '', version: a.version?.number ?? 0,
        createdAt: a.version?.createdAt ?? '', downloadLink: a.downloadLink,
      }));
    },
    download(downloadLink) {
      return send(`/wiki${downloadLink}`, async (r) => new Uint8Array(await r.arrayBuffer()));
    },
    async getUsers(accountIds) {
      const result = new Map();
      for (const batch of chunks([...new Set(accountIds)], USERS_BATCH)) {
        const page = await getJson(`/wiki/rest/api/user/bulk?${batch.map((id) => `accountId=${encodeURIComponent(id)}`).join('&')}`);
        (page.results ?? []).forEach((u) => result.set(u.accountId, u.displayName ?? u.publicName ?? null));
      }
      return result;
    },
    async searchPages(spaceKey, text) {
      const cql = `type=page AND space="${sanitize(spaceKey)}" AND title~"${sanitize(text)}*"`;
      const page = await getJson(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=20&expand=content.ancestors`);
      return (page.results ?? []).map((r) => ({
        id: String(r.content?.id ?? r.id), title: r.content?.title ?? r.title, ancestors: (r.content?.ancestors ?? []).map((a) => a.title),
      }));
    },
    async countPages(spaceKey, ancestorId) {
      if (ancestorId != null && !/^\d+$/.test(String(ancestorId))) return null;
      const cql = `type=page AND space="${sanitize(spaceKey)}"${ancestorId != null ? ` AND ancestor=${ancestorId}` : ''}`;
      const page = await getJson(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=1`);
      if (typeof page.totalSize !== 'number') return null;
      return page.totalSize + (ancestorId != null ? 1 : 0);
    },
  };
}
