const createdAt = (version) => `2026-01-${String(version).padStart(2, '0')}T00:00:00.000Z`;

/** In-memory Confluence client with the createConfluenceClient interface, call counters and mutators for update tests. */
export function createFakeConfluence({ space, pages, users = {} }) {
  const byId = new Map(pages.map((p) => [p.id, { ...p }]));
  const calls = { getSpace: 0, listRootPages: 0, listChildren: 0, getPages: 0, getLabels: 0, getLabelsOf: 0, listAttachments: 0, download: 0, getUsers: 0 };
  const isFolder = (p) => p?.type === 'folder';
  const notFound = (what) => Object.assign(new Error(`not found ${what}`), { status: 404 });
  const count = (name) => {
    calls[name] += 1;
  };
  const listed = (filter) => [...byId.values()].filter(filter).sort((a, b) => a.position - b.position)
    .map((p) => ({ id: p.id, title: p.title, position: p.position, type: p.type ?? 'page' }));
  const ancestorsOf = (page) => {
    const chain = [];
    for (let parent = byId.get(page.parentId); parent; parent = byId.get(parent.parentId)) chain.unshift(parent);
    return chain;
  };
  const client = {
    async getSpace(key) {
      count('getSpace');
      if (key !== space.key) throw Object.assign(new Error(`space ${key}`), { status: 404 });
      return { id: space.id, key: space.key, name: space.name, homepageId: listed((p) => !p.parentId && !isFolder(p))[0]?.id ?? null };
    },
    async listRootPages() {
      count('listRootPages');
      return listed((p) => !p.parentId && !isFolder(p)).map(({ id, title, position }) => ({ id, title, position }));
    },
    async listChildren(id, type = 'page') {
      count('listChildren');
      if (!byId.has(id) || isFolder(byId.get(id)) !== (type === 'folder')) throw notFound(`${type} ${id}`);
      return listed((p) => p.parentId === id);
    },
    async getPages(ids, { withBody }) {
      count('getPages');
      return ids.filter((id) => byId.has(id) && !isFolder(byId.get(id))).map((id) => {
        const p = byId.get(id);
        return {
          id: p.id, title: p.title, parentId: p.parentId ?? null, spaceId: space.id,
          version: { number: p.version, createdAt: createdAt(p.version), authorId: p.authorId ?? null },
          body: withBody ? p.body ?? '' : null,
        };
      });
    },
    async getLabels(pageId) {
      count('getLabels');
      return [...(byId.get(pageId)?.labels ?? [])];
    },
    async getLabelsOf(ids) {
      count('getLabelsOf');
      return new Map(ids.filter((id) => byId.has(id) && !isFolder(byId.get(id))).map((id) => [id, [...(byId.get(id).labels ?? [])]]));
    },
    async listAttachments(pageId) {
      count('listAttachments');
      if (!byId.has(pageId) || isFolder(byId.get(pageId))) throw notFound(`page ${pageId}`);
      return (byId.get(pageId)?.attachments ?? []).map((a) => ({
        id: a.id, title: a.title, fileSize: a.fileSize ?? a.bytes.length, mediaType: '', version: a.version,
        createdAt: createdAt(a.version), downloadLink: `/download/${pageId}/${a.id}`,
      }));
    },
    async download(downloadLink) {
      count('download');
      const [, , pageId, attachmentId] = downloadLink.split('/');
      return byId.get(pageId).attachments.find((a) => a.id === attachmentId).bytes;
    },
    async getUsers(accountIds) {
      count('getUsers');
      return new Map([...new Set(accountIds)].filter((id) => id in users).map((id) => [id, users[id]]));
    },
    async searchPages(spaceKey, text) {
      return [...byId.values()].filter((p) => p.title.toLowerCase().startsWith(String(text).toLowerCase()))
        .map((p) => ({ id: p.id, title: p.title, ancestors: ancestorsOf(p).map((a) => a.title) }));
    },
    async countPages(spaceKey, ancestorId) {
      const pagesOnly = [...byId.values()].filter((p) => !isFolder(p));
      if (!ancestorId) return pagesOnly.length;
      return pagesOnly.filter((p) => ancestorsOf(p).some((a) => a.id === ancestorId)).length + 1;
    },
  };
  return {
    client,
    calls,
    update(id, patch) {
      const page = byId.get(id);
      for (const key of ['title', 'version', 'body', 'parentId', 'position', 'labels']) {
        if (key in patch) page[key] = patch[key];
      }
    },
    remove(id) {
      const { parentId } = byId.get(id);
      byId.delete(id);
      for (const page of byId.values()) {
        if (page.parentId === id) page.parentId = parentId ?? null;
      }
    },
  };
}
