import { describe, expect, it, vi } from 'vitest';
import { createConfluenceClient } from '../../src/infra/confluence.js';

const json = (body, status = 200, headers = {}) => ({
  ok: status < 400, status, headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
});

describe('confluence client', () => {
  it('follows pagination and sorts children by position', async () => {
    const request = vi.fn(async (path) => {
      if (path === '/wiki/api/v2/pages/1/children?limit=250') return json({ results: [{ id: '3', title: 'B', childPosition: 2 }], _links: { next: '/wiki/api/v2/pages/1/children?cursor=x&limit=250' } });
      return json({ results: [{ id: '2', title: 'A', childPosition: 1 }], _links: {} });
    });
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.listChildren('1')).toEqual([{ id: '2', title: 'A', position: 1 }, { id: '3', title: 'B', position: 2 }]);
  });

  it('retries 429 using Retry-After, then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi.fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json({ results: [{ id: '5', key: 'ENG', name: 'Eng', homepageId: '6' }] }));
    const client = createConfluenceClient({ request, sleep });
    expect(await client.getSpace('ENG')).toEqual({ id: '5', key: 'ENG', name: 'Eng', homepageId: '6' });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('fails fast on 403 with the status', async () => {
    const client = createConfluenceClient({ request: async () => json({}, 403), sleep: async () => {} });
    await expect(client.getSpace('ENG')).rejects.toMatchObject({ name: 'ConfluenceError', status: 403 });
  });

  it('batches page ids by 250 and maps pages', async () => {
    const ids = Array.from({ length: 260 }, (_, i) => String(i + 1));
    const request = vi.fn(async (path) => {
      const batch = new URL(`https://h${path}`).searchParams.get('id').split(',');
      return json({ results: batch.map((id) => ({ id, title: `T${id}`, parentId: '0', spaceId: '5', version: { number: 1, createdAt: '2026-01-01T00:00:00Z', authorId: 'u1' }, body: { storage: { value: '<p/>' } } })) });
    });
    const pages = await createConfluenceClient({ request, sleep: async () => {} }).getPages(ids, { withBody: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(pages).toHaveLength(260);
    expect(pages[0]).toEqual({ id: '1', title: 'T1', parentId: '0', spaceId: '5', version: { number: 1, createdAt: '2026-01-01T00:00:00Z', authorId: 'u1' }, body: '<p/>' });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createConfluenceClient({ request: async () => json({}), sleep: async () => {}, signal: controller.signal });
    await expect(client.getSpace('ENG')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('downloads bytes and resolves users in chunks', async () => {
    const request = vi.fn(async (path) => (path.startsWith('/wiki/download') ? json({}) : json({ results: [{ accountId: 'u1', displayName: 'Ann' }] })));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect([...(await client.download('/download/attachments/1/a.png'))]).toEqual([1, 2, 3]);
    expect(await client.getUsers(['u1'])).toEqual(new Map([['u1', 'Ann']]));
  });
});
