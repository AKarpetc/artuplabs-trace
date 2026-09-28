// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createConfluenceClient } from '../src/infra/confluence.js';
import { scanTree } from '../src/export/tree.js';
import { runExport } from '../src/export/pipeline.js';
import { DEFAULT_OPTIONS } from '../src/core/presets.js';
import { PAGES, SPACE, routeConfluence } from '../preview/fixtures.js';

const client = () => createConfluenceClient({ request: async (path) => routeConfluence(path), sleep: async () => {} });

describe('preview fixture Confluence', () => {
  it('serves a 60-page space that the real client scans completely', async () => {
    const { rootIds, nodes } = await scanTree(client(), { kind: 'space', spaceKey: SPACE.key }, () => {}, undefined);
    expect(PAGES).toHaveLength(60);
    expect(rootIds).toHaveLength(2);
    expect(nodes.size).toBe(60);
  });

  it('answers pages with bodies, labels, attachments, downloads, users and search', async () => {
    const c = client();
    const space = await c.getSpace(SPACE.key);
    expect(space).toMatchObject({ id: SPACE.id, key: SPACE.key, homepageId: PAGES[0].id });
    const withAttachments = PAGES.filter((page) => page.attachments.length > 0);
    expect(withAttachments.flatMap((page) => page.attachments)).toHaveLength(5);
    const [page] = await c.getPages([withAttachments[0].id], { withBody: true });
    expect(page.body).toContain('ac:image');
    const [attachment] = await c.listAttachments(page.id);
    const bytes = await c.download(attachment.downloadLink);
    expect(bytes.length).toBe(attachment.fileSize);
    expect(await c.getLabels(PAGES[0].id)).toEqual(['docs', 'reviewed']);
    const users = await c.getUsers(['u-ann', 'u-gone']);
    expect([...users.entries()]).toEqual([['u-ann', 'Ann Lee']]);
    expect((await c.searchPages(SPACE.key, 'Ёж')).map((r) => r.title)).toEqual(['Ёж']);
  });

  it('includes Cyrillic, CJK, case-colliding and 250-character titles', () => {
    const titles = PAGES.map((page) => page.title);
    expect(titles).toEqual(expect.arrayContaining(['Ёж', 'Еж', 'API', 'api', 'Café', 'Cafe', '認証']));
    expect(Math.max(...titles.map((title) => title.length))).toBeGreaterThanOrEqual(250);
  });

  it('pages through children with cursor links and answers 404 for unknown paths', async () => {
    const first = await (await routeConfluence(`/wiki/api/v2/pages/${PAGES[0].id}/children?limit=2`)).json();
    expect(first.results).toHaveLength(2);
    expect(first._links.next).toContain('cursor=2');
    expect((await routeConfluence('/wiki/api/v2/unknown')).status).toBe(404);
  });

  it('runs a full export with converter warnings', async () => {
    const result = await runExport({
      client: client(), target: { kind: 'space', spaceKey: SPACE.key }, options: DEFAULT_OPTIONS, previousManifest: null,
      siteUrl: 'https://preview.atlassian.net', signal: new AbortController().signal, onProgress: () => {}, now: new Date(2026, 8, 29),
    });
    const kinds = new Set(result.warnings.map((w) => w.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(['unknown-macro', 'dynamic-macro', 'adf-extension', 'complex-table', 'unresolved-user', 'missing-attachment']));
  });
});
