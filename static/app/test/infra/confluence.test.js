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

  it('retries a rejecting request with the same backoff, then throws ConfluenceError status 0 after 5 attempts', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const client = createConfluenceClient({ request, sleep });
    await expect(client.getSpace('ENG')).rejects.toMatchObject({ name: 'ConfluenceError', status: 0 });
    expect(request).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000]);
  });

  it('succeeds on the 2nd attempt after one rejecting request', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(json({ results: [{ id: '5', key: 'ENG', name: 'Eng', homepageId: '6' }] }));
    const client = createConfluenceClient({ request, sleep });
    expect(await client.getSpace('ENG')).toEqual({ id: '5', key: 'ENG', name: 'Eng', homepageId: '6' });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('rejects AbortError when aborted during the backoff wait after a rejecting request', async () => {
    const controller = new AbortController();
    const sleep = vi.fn(async () => {
      controller.abort();
    });
    const request = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const client = createConfluenceClient({ request, sleep, signal: controller.signal });
    await expect(client.getSpace('ENG')).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('sanitises the space key the same way as the search text', async () => {
    const request = vi.fn(async () => json({ results: [] }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    await client.searchPages('ENG" OR space="X', 'caf"é');
    const [calledPath] = request.mock.calls[0];
    const cql = decodeURIComponent(new URL(`https://h${calledPath}`).searchParams.get('cql'));
    expect(cql).toBe('type=page AND space="ENG OR space=X" AND title~"café*"');
  });

  it('returns search results with ancestor titles as breadcrumbs', async () => {
    const request = vi.fn(async () => json({ results: [{ content: { id: 7, title: 'Café', ancestors: [{ id: 1, title: 'Eng' }, { id: 2, title: 'Docs' }] } }, { content: { id: 8, title: 'Cafe' } }] }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.searchPages('ENG', 'caf')).toEqual([{ id: '7', title: 'Café', ancestors: ['Eng', 'Docs'] }, { id: '8', title: 'Cafe', ancestors: [] }]);
    expect(new URL(`https://h${request.mock.calls[0][0]}`).searchParams.get('expand')).toBe('content.ancestors');
  });

  it('counts pages of a space, or a branch including its root, from the CQL totalSize', async () => {
    const request = vi.fn(async () => json({ results: [], totalSize: 41, size: 0 }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.countPages('ENG')).toBe(41);
    expect(await client.countPages('EN"G', '12')).toBe(42);
    const cqls = request.mock.calls.map(([path]) => new URL(`https://h${path}`).searchParams.get('cql'));
    expect(cqls).toEqual(['type=page AND space="ENG"', 'type=page AND space="ENG" AND ancestor=12']);
  });

  it('counts null when totalSize is missing and refuses a non-numeric ancestor', async () => {
    const request = vi.fn(async () => json({ results: [] }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.countPages('ENG')).toBeNull();
    expect(await client.countPages('ENG', '1 OR 1=1')).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('drops non-numeric page ids and sends no request when none remain', async () => {
    const request = vi.fn(async () => json({ results: [] }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.getPages(['abc', 'x1', ''], { withBody: false })).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('filters non-numeric ids out of a mixed id list before batching', async () => {
    const request = vi.fn(async (path) => {
      const idsParam = new URL(`https://h${path}`).searchParams.get('id');
      return json({
        results: idsParam.split(',').map((id) => ({ id, title: `T${id}`, parentId: null, spaceId: '1', version: {}, body: null })),
      });
    });
    const client = createConfluenceClient({ request, sleep: async () => {} });
    const pages = await client.getPages(['1', 'abc', '2', '3x'], { withBody: false });
    expect(pages.map((p) => p.id)).toEqual(['1', '2']);
  });

  it('sorts root pages by position', async () => {
    const request = vi.fn(async () => json({ results: [{ id: '3', title: 'B', position: 2 }, { id: '2', title: 'A', position: 1 }], _links: {} }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.listRootPages('9')).toEqual([{ id: '2', title: 'A', position: 1 }, { id: '3', title: 'B', position: 2 }]);
  });

  it('returns label names', async () => {
    const request = vi.fn(async () => json({ results: [{ name: 'howto' }, { name: 'draft' }], _links: {} }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.getLabels('42')).toEqual(['howto', 'draft']);
  });

  it('maps attachments including downloadLink and createdAt', async () => {
    const request = vi.fn(async () => json({
      results: [{
        id: '9', title: 'logo.png', fileSize: 123, mediaType: 'image/png',
        version: { number: 2, createdAt: '2026-02-01T00:00:00Z' },
        downloadLink: '/download/attachments/1/logo.png',
      }],
      _links: {},
    }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.listAttachments('1')).toEqual([{
      id: '9', title: 'logo.png', fileSize: 123, mediaType: 'image/png', version: 2,
      createdAt: '2026-02-01T00:00:00Z', downloadLink: '/download/attachments/1/logo.png',
    }]);
  });

  it('throws ConfluenceError 404 when the space is not found', async () => {
    const request = vi.fn(async () => json({ results: [] }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    await expect(client.getSpace('MISSING')).rejects.toMatchObject({ name: 'ConfluenceError', status: 404 });
  });

  it('stops with ConfluenceError 508 when a pagination next URL repeats', async () => {
    const request = vi.fn(async () => json({
      results: [{ id: '1', title: 'A', childPosition: 1 }],
      _links: { next: '/wiki/api/v2/pages/1/children?limit=250' },
    }));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    await expect(client.listChildren('1')).rejects.toMatchObject({ name: 'ConfluenceError', status: 508 });
  });
});
