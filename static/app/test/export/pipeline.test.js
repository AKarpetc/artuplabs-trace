import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { runExport, PIPELINE_WARNING_KINDS } from '../../src/export/pipeline.js';
import { scanTree } from '../../src/export/tree.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';
import { labelsHash, parseManifest } from '../../src/core/manifest.js';
import { storageToMarkdown } from '../../src/core/convert/index.js';
import { createFakeConfluence } from '../fixtures/fakeConfluence.js';

const PNG = new Uint8Array([137, 80, 78, 71]);
const pages = () => [
  { id: '1', title: 'Home', parentId: null, position: 0, version: 3, authorId: 'u1', labels: ['doc'], body: '<p>Welcome to <ac:link><ri:page ri:content-title="API"/></ac:link></p>', attachments: [] },
  { id: '2', title: 'API', parentId: '1', position: 0, version: 1, authorId: 'u1', labels: [], body: '<p><ac:image><ri:attachment ri:filename="d.png"/></ac:image></p>', attachments: [{ id: 'a1', title: 'd.png', version: 1, bytes: PNG }] },
  { id: '3', title: 'Café', parentId: '1', position: 1, version: 1, authorId: 'u2', labels: [], body: '<p>Back to <ac:link><ri:page ri:content-title="Home"/></ac:link></p>', attachments: [] },
];
const files = async (result) => Object.fromEntries(Object.entries(unzipSync(new Uint8Array(await result.blob.arrayBuffer()))).map(([k, v]) => [k, k.endsWith('.png') ? [...v] : strFromU8(v)]));
const run = (fake, over = {}) => runExport({
  client: fake.client, target: { kind: 'space', spaceKey: 'ENG' }, options: DEFAULT_OPTIONS, previousManifest: null,
  siteUrl: 'https://x.atlassian.net', signal: new AbortController().signal, onProgress: () => {}, now: new Date(2026, 8, 28), ...over,
});

describe('runExport', () => {
  it('exports the whole space with paths, front-matter, links and attachments', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const out = await files(await run(fake));
    expect(Object.keys(out).sort()).toEqual(['export-manifest.json', 'home/api.assets/d.png', 'home/api.md', 'home/cafe.md', 'home/index.md']);
    expect(out['home/index.md']).toContain('title: "Home"');
    expect(out['home/index.md']).toContain('confluence_url: "https://x.atlassian.net/wiki/spaces/ENG/pages/1"\n---\n');
    expect(out['home/index.md']).not.toMatch(/^source:/m);
    expect(out['home/index.md']).toContain('Welcome to [API](api.md)');
    expect(out['home/cafe.md']).toContain('Back to [Home](index.md)');
    expect(out['home/api.md']).toContain('![](api.assets/d.png)');
    expect(out['home/api.assets/d.png']).toEqual([...PNG]);
  });

  it('gives byte-identical files on a repeated export (zero diff)', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const first = await files(await run(fake));
    const second = await files(await run(fake, { now: new Date(2027, 0, 1) }));
    expect(second).toEqual(first);
  });

  it('update export writes only changed pages and lists deletions', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const first = await files(await run(fake));
    const previousManifest = JSON.parse(first['export-manifest.json']);
    fake.update('3', { title: 'Cafe Renamed', version: 2 });
    fake.remove('2');
    const result = await run(fake, { previousManifest });
    const out = await files(result);
    expect(result.mode).toBe('update');
    expect(Object.keys(out).sort()).toEqual(['export-deleted.txt', 'export-manifest.json', 'home/cafe-renamed.md', 'home/index.md']);
    expect(out['export-deleted.txt']).toBe('home/api.assets/d.png\nhome/api.md\nhome/cafe.md\n');
    expect(out['home/index.md']).toContain('[API](https://x.atlassian.net/wiki/display/ENG/API)');
    expect(result.stats).toMatchObject({ moved: 1, missing: 1 });
  });

  it('an update with no changes writes only the manifest, identical to the previous one', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const first = await files(await run(fake));
    const result = await run(fake, { previousManifest: JSON.parse(first['export-manifest.json']) });
    const out = await files(result);
    expect(Object.keys(out)).toEqual(['export-manifest.json']);
    expect(out['export-manifest.json']).toBe(first['export-manifest.json']);
    expect(fake.calls.download).toBe(1);
  });

  it('falls back to a full export when options changed', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: {} });
    const first = await files(await run(fake));
    const result = await run(fake, { previousManifest: JSON.parse(first['export-manifest.json']), options: { ...DEFAULT_OPTIONS, preset: 'hugo' } });
    expect(result).toMatchObject({ mode: 'full', fullReason: 'options-changed' });
  });

  it('skips attachments above the size limit with a warning', async () => {
    const big = pages();
    big[1].attachments[0].bytes = new Uint8Array(2 * 1024 * 1024);
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: big, users: {} });
    const result = await run(fake, { options: { ...DEFAULT_OPTIONS, maxAttachmentMb: 1 } });
    expect(Object.keys(await files(result))).not.toContain('home/api.assets/d.png');
    expect(result.warnings).toContainEqual({ pageId: '2', title: 'API', kind: 'attachment-too-large', detail: 'd.png' });
  });

  it('exports a branch and a single page', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: {} });
    const branch = await files(await run(fake, { target: { kind: 'branch', spaceKey: 'ENG', pageId: '1' } }));
    expect(Object.keys(branch)).toContain('home/cafe.md');
    const single = await files(await run(fake, { target: { kind: 'page', spaceKey: 'ENG', pageId: '3' } }));
    expect(Object.keys(single).sort()).toEqual(['cafe.md', 'export-manifest.json']);
  });

  it('reports progress per stage and can be cancelled', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: {} });
    const stages = [];
    await run(fake, { onProgress: (p) => stages.push(p.stage) });
    expect([...new Set(stages)]).toEqual(['scan', 'pages', 'attachments', 'pack']);
    const controller = new AbortController();
    const pending = run(fake, { signal: controller.signal, onProgress: (p) => p.stage === 'pages' && controller.abort() });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resolves 1 000 pages in a deep tree without duplicate paths', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 1), title: i % 7 === 0 ? 'Notes' : `Page ${i}`, parentId: i === 0 ? null : String(Math.floor(i / 4) + 1), position: i, version: 1, authorId: 'u1', labels: [], body: '<p>x</p>', attachments: [] }));
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: many, users: {} });
    const out = await files(await run(fake));
    const mdFiles = Object.keys(out).filter((k) => k.endsWith('.md'));
    expect(mdFiles).toHaveLength(1000);
    expect(new Set(mdFiles.map((f) => f.toLowerCase())).size).toBe(1000);
  });
});

describe('runExport edge cases', () => {
  const eng = { id: '5', key: 'ENG', name: 'Eng' };

  it('writes front-matter with author, labels, version date and the parent outside a branch', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const single = await files(await run(fake, { target: { kind: 'page', spaceKey: 'ENG', pageId: '3' } }));
    expect(single['cafe.md']).toContain('parent_id: "1"');
    expect(single['cafe.md']).toContain('author: "Bo"');
    expect(single['cafe.md']).toContain('Back to [Home](https://x.atlassian.net/wiki/display/ENG/Home)');
    const whole = await files(await run(fake));
    expect(whole['home/index.md']).toContain('updated: "2026-01-03T00:00:00.000Z"');
    expect(whole['home/index.md']).toContain('labels:\n  - "doc"');
    expect(whole['home/index.md']).not.toContain('parent_id');
  });

  it('keeps a page whose conversion throws, with a placeholder and a convert-failed warning', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const convert = (xhtml, ctx) => {
      if (xhtml.includes('Back to')) throw new Error('boom');
      return storageToMarkdown(xhtml, ctx);
    };
    const result = await run(fake, { convert });
    const out = await files(result);
    expect(out['home/cafe.md']).toMatch(/^---\n[\s\S]*\n---\n<!-- confluence:convert-failed -->\n$/);
    expect(result.warnings).toContainEqual({ pageId: '3', title: 'Café', kind: 'convert-failed', detail: 'boom' });
    expect(PIPELINE_WARNING_KINDS).toEqual(['attachment-too-large', 'convert-failed']);
  });

  it('writes the convert-failed placeholder in the flavour of the preset', async () => {
    const convert = (xhtml, ctx) => {
      if (xhtml.includes('Back to')) throw new Error('boom');
      return storageToMarkdown(xhtml, ctx);
    };
    const bodies = {};
    for (const preset of ['generic', 'docusaurus', 'mkdocs']) {
      const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
      const out = await files(await run(fake, { convert, options: { ...DEFAULT_OPTIONS, preset } }));
      bodies[preset] = out['home/cafe.md'].split('---\n').slice(2).join('---\n');
    }
    expect(bodies).toEqual({ generic: '<!-- confluence:convert-failed -->\n', docusaurus: '{/* confluence:convert-failed */}\n', mkdocs: '<!-- confluence:convert-failed -->\n' });
  });

  it('never reports titles of pages that are missing now and counts them only', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previous = JSON.parse((await files(await run(fake)))['export-manifest.json']);
    previous.pages.push({ id: '99', title: 'Secret Plans', parentId: '1', version: 1, path: 'home/secret-plans.md', name: 'secret-plans', weight: 30, links: [], attachments: [] });
    previous.warnings.push({ pageId: '99', kind: 'unknown-macro', detail: 'drawio' });
    const result = await run(fake, { previousManifest: previous });
    const out = await files(result);
    expect(result.stats).toMatchObject({ missing: 1, deleted: 1 });
    expect(result.deletePaths).toEqual(['home/secret-plans.md']);
    expect(JSON.stringify({ stats: result.stats, warnings: result.warnings })).not.toContain('Secret');
    expect(out['export-manifest.json']).not.toContain('Secret');
  });

  it('never lists unsafe paths from a crafted previous manifest for deletion', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previous = JSON.parse((await files(await run(fake)))['export-manifest.json']);
    ['../outside.md', '/etc/passwd', 'home/../../x.md', 'home\\x.md', 'evil\n/Users/victim/.zshrc', '.github/ci.md', 'export-manifest.json', 'mkdocs.yml'].forEach((path, i) => previous.pages.push({
      id: String(90 + i), title: `Gone ${i}`, parentId: '1', version: 1, path, name: 'x', weight: 40 + i, links: [], attachments: [],
    }));
    previous.pages.push({ id: '99', title: 'Gone', parentId: '1', version: 1, path: 'home/gone.md', name: 'gone', weight: 99, links: [], attachments: [{ id: 'x1', version: 1, path: 'home/.ssh/id_rsa' }, { id: 'x2', version: 1, path: 'home/gone.assets/a.png' }] });
    const result = await run(fake, { previousManifest: previous });
    const out = await files(result);
    expect(result.deletePaths).toEqual(['home/gone.assets/a.png', 'home/gone.md']);
    expect(out['export-deleted.txt']).toBe('home/gone.assets/a.png\nhome/gone.md\n');
  });

  it('reports full stats and a dated file name', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const result = await run(fake);
    expect(result.fileName).toBe('artup-export-ENG-2026-09-28.zip');
    expect(result.stats).toMatchObject({ pages: 3, written: 3, attachments: 1, skippedAttachments: 0, deleted: 0, added: 3, relinked: 0 });
    expect(result.stats.bytes).toBe(result.blob.size);
    expect(result.fullReason).toBeNull();
  });

  it('marks an update of another source as full and names the zip after the branch root', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previous = JSON.parse((await files(await run(fake)))['export-manifest.json']);
    const result = await run(fake, { previousManifest: previous, target: { kind: 'branch', spaceKey: 'ENG', pageId: '1' } });
    expect(result).toMatchObject({ mode: 'full', fullReason: 'other-source', fileName: 'artup-export-ENG-home-2026-09-28.zip' });
  });

  it('writes only referenced attachments in referenced mode and none in none mode', async () => {
    const withExtra = pages();
    withExtra[1].attachments.push({ id: 'a2', title: 'unused.pdf', version: 1, bytes: PNG });
    const fake = createFakeConfluence({ space: eng, pages: withExtra, users: {} });
    const referenced = await files(await run(fake, { options: { ...DEFAULT_OPTIONS, attachments: 'referenced' } }));
    expect(Object.keys(referenced)).toContain('home/api.assets/d.png');
    expect(Object.keys(referenced)).not.toContain('home/api.assets/unused.pdf');
    const all = await files(await run(fake));
    expect(Object.keys(all)).toContain('home/api.assets/unused.pdf');
    const listed = fake.calls.listAttachments;
    const none = await files(await run(fake, { options: { ...DEFAULT_OPTIONS, attachments: 'none' } }));
    expect(Object.keys(none).filter((k) => k.includes('.assets/'))).toEqual([]);
    expect(fake.calls.listAttachments).toBe(listed);
  });

  it('downloads only a changed attachment of an unchanged page in an update', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previous = JSON.parse((await files(await run(fake)))['export-manifest.json']);
    const source = pages();
    source[1].attachments[0] = { id: 'a1', title: 'd.png', version: 2, bytes: new Uint8Array([1, 2]) };
    const changed = createFakeConfluence({ space: eng, pages: source, users: {} });
    const result = await run(changed, { previousManifest: previous });
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual(['export-manifest.json', 'home/api.assets/d.png']);
    expect(JSON.parse(out['export-manifest.json']).pages.find((p) => p.id === '2').attachments).toEqual([{ id: 'a1', version: 2, path: 'home/api.assets/d.png' }]);
  });

  it('adds preset navigation files', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const out = await files(await run(fake, { options: { ...DEFAULT_OPTIONS, preset: 'docusaurus' } }));
    expect(JSON.parse(out['home/_category_.json'])).toEqual({ label: 'Home', position: 10 });
  });

  it('emits the admonition flavour of the chosen preset', async () => {
    const withPanel = pages();
    withPanel[2].body = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Hi {x}</p></ac:rich-text-body></ac:structured-macro>';
    const outputs = {};
    for (const preset of ['generic', 'hugo', 'docusaurus', 'mkdocs']) {
      const fake = createFakeConfluence({ space: eng, pages: withPanel, users: {} });
      const out = await files(await run(fake, { options: { ...DEFAULT_OPTIONS, preset } }));
      outputs[preset] = out['home/cafe.md'].split('---\n').slice(2).join('---\n');
    }
    expect(outputs).toEqual({
      generic: '> [!NOTE]\n> Hi {x}\n',
      hugo: '> [!NOTE]\n> Hi {x}\n',
      docusaurus: ':::note\n\nHi \\{x\\}\n\n:::\n',
      mkdocs: '!!! note\n    Hi \\{x\\}\n',
    });
  });

  it('rejects with AbortError when aborted before start', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const controller = new AbortController();
    controller.abort();
    await expect(run(fake, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.calls.getSpace + fake.calls.listRootPages).toBe(0);
  });
});

describe('scanTree', () => {
  const eng = { id: '5', key: 'ENG', name: 'Eng' };
  const rows = () => [
    { id: '10', title: 'A', parentId: null, position: 1, version: 1, attachments: [] },
    { id: '11', title: 'B', parentId: null, position: 0, version: 1, attachments: [] },
    { id: '12', title: 'A2', parentId: '10', position: 5, version: 1, attachments: [] },
    { id: '13', title: 'A1', parentId: '10', position: 2, version: 1, attachments: [] },
    { id: '14', title: 'A1x', parentId: '13', position: 0, version: 1, attachments: [] },
  ];

  it('walks several roots level by level with children in position order', async () => {
    const fake = createFakeConfluence({ space: eng, pages: rows(), users: {} });
    const progress = [];
    const tree = await scanTree(fake.client, { kind: 'space', spaceKey: 'ENG' }, (p) => progress.push(p));
    expect(tree.rootIds).toEqual(['11', '10']);
    expect([...tree.nodes.keys()]).toEqual(['11', '10', '13', '12', '14']);
    expect(tree.nodes.get('10')).toEqual({ id: '10', title: 'A', parentId: null, childIds: ['13', '12'] });
    expect(tree.nodes.get('14').parentId).toBe('13');
    expect(progress.map((p) => p.done)).toEqual([2, 4, 5, 5]);
    expect(progress.every((p) => p.stage === 'scan' && p.total === 0)).toBe(true);
  });

  it('scans a branch from its page and a single page without children', async () => {
    const fake = createFakeConfluence({ space: eng, pages: rows(), users: {} });
    const branch = await scanTree(fake.client, { kind: 'branch', spaceKey: 'ENG', pageId: '10' }, () => {});
    expect(branch.rootIds).toEqual(['10']);
    expect([...branch.nodes.keys()]).toEqual(['10', '13', '12', '14']);
    const single = await scanTree(fake.client, { kind: 'page', spaceKey: 'ENG', pageId: '13' }, () => {});
    expect(single.rootIds).toEqual(['13']);
    expect(single.nodes.get('13')).toEqual({ id: '13', title: 'A1', parentId: '10', childIds: [] });
  });

  it('walks into folders and marks them as folder nodes', async () => {
    const fake = createFakeConfluence({ space: eng, pages: [...rows(), { id: '20', type: 'folder', title: 'F', parentId: '11', position: 0 }, { id: '21', title: 'In F', parentId: '20', position: 0, version: 1, attachments: [] }], users: {} });
    const tree = await scanTree(fake.client, { kind: 'space', spaceKey: 'ENG' }, () => {});
    expect(tree.nodes.get('11').childIds).toEqual(['20']);
    expect(tree.nodes.get('20')).toEqual({ id: '20', title: 'F', parentId: '11', childIds: ['21'], type: 'folder' });
    expect(tree.nodes.get('21')).toEqual({ id: '21', title: 'In F', parentId: '20', childIds: [] });
  });

  it('stops after maxDepth levels below the roots', async () => {
    const fake = createFakeConfluence({ space: eng, pages: rows(), users: {} });
    const space = await scanTree(fake.client, { kind: 'space', spaceKey: 'ENG' }, () => {}, undefined, { maxDepth: 1 });
    expect([...space.nodes.keys()]).toEqual(['11', '10', '13', '12']);
    expect(space.nodes.get('13').childIds).toEqual([]);
    const roots = await scanTree(fake.client, { kind: 'branch', spaceKey: 'ENG', pageId: '10' }, () => {}, undefined, { maxDepth: 0 });
    expect([...roots.nodes.keys()]).toEqual(['10']);
  });
});

describe('runExport relinking, cancellation and vanished pages', () => {
  const eng = { id: '5', key: 'ENG', name: 'Eng' };
  const CHILDREN = '<p>Hub</p><ac:structured-macro ac:name="children"/>';
  const OWNED = '<p><ac:image><ri:attachment ri:filename="d.png"><ri:page ri:content-title="API"/></ri:attachment></ac:image></p>';
  const withHome = (body) => {
    const list = pages();
    list[0].body = body;
    return list;
  };
  const previousOf = async (fake, over = {}) => JSON.parse((await files(await run(fake, over)))['export-manifest.json']);

  it('rewrites a parent with a children macro when a child is renamed', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withHome(CHILDREN), users: {} });
    const previousManifest = await previousOf(fake);
    fake.update('3', { title: 'Cafe Renamed', version: 2 });
    const out = await files(await run(fake, { previousManifest }));
    expect(out['home/index.md']).toContain('[Cafe Renamed](cafe-renamed.md)');
    expect(out['home/index.md']).not.toContain('(cafe.md)');
    expect(out['export-deleted.txt']).toBe('home/cafe.md\n');
  });

  it('rewrites a parent when a child is added', async () => {
    const previousManifest = await previousOf(createFakeConfluence({ space: eng, pages: withHome(CHILDREN), users: {} }));
    const more = [...withHome(CHILDREN), { id: '4', title: 'Zeta', parentId: '1', position: 2, version: 1, authorId: 'u1', labels: [], body: '<p>z</p>', attachments: [] }];
    const result = await run(createFakeConfluence({ space: eng, pages: more, users: {} }), { previousManifest });
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual(['export-manifest.json', 'home/index.md', 'home/zeta.md']);
    expect(out['home/index.md']).toContain('[Zeta](zeta.md)');
    expect(result.stats).toMatchObject({ added: 1, relinked: 1, unchanged: 2 });
  });

  it('rewrites a parent when its children are reordered', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withHome(CHILDREN), users: {} });
    const previousManifest = await previousOf(fake);
    fake.update('3', { position: -1 });
    const out = await files(await run(fake, { previousManifest }));
    const index = out['home/index.md'];
    expect(index.indexOf('[Café](cafe.md)')).toBeGreaterThan(-1);
    expect(index.indexOf('[Café](cafe.md)')).toBeLessThan(index.indexOf('[API](api.md)'));
  });

  it('keeps an attachment embedded by an unchanged page when its owner changes in referenced mode', async () => {
    const list = withHome(OWNED);
    list[1].body = '<p>api</p>';
    const fake = createFakeConfluence({ space: eng, pages: list, users: {} });
    const options = { ...DEFAULT_OPTIONS, attachments: 'referenced' };
    const previousManifest = await previousOf(fake, { options });
    expect(previousManifest.pages.find((p) => p.id === '2').attachments.map((a) => a.id)).toEqual(['a1']);
    fake.update('2', { version: 2 });
    const result = await run(fake, { previousManifest, options });
    const out = await files(result);
    expect(result.deletePaths).toEqual([]);
    expect(Object.keys(out)).not.toContain('export-deleted.txt');
    expect(JSON.parse(out['export-manifest.json']).pages.find((p) => p.id === '2').attachments.map((a) => a.id)).toEqual(['a1']);
  });

  it('rewrites a page that embeds another page\'s attachment when the owner moves', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withHome(OWNED), users: {} });
    const first = await files(await run(fake));
    expect(first['home/index.md']).toContain('![](api.assets/d.png)');
    fake.update('2', { parentId: '3', version: 2 });
    const out = await files(await run(fake, { previousManifest: JSON.parse(first['export-manifest.json']) }));
    expect(out['home/index.md']).toContain('![](cafe/api.assets/d.png)');
    expect(out['home/cafe/api.assets/d.png']).toEqual([...PNG]);
    expect(out['export-deleted.txt']).toBe('home/api.assets/d.png\nhome/api.md\nhome/cafe.md\n');
  });

  it('stops promptly when cancelled while downloads are in flight', async () => {
    const list = pages();
    list[1].attachments = Array.from({ length: 5 }, (_, i) => ({ id: `a${i + 1}`, title: `f${i}.png`, version: 1, bytes: PNG }));
    const fake = createFakeConfluence({ space: eng, pages: list, users: {} });
    let finished = 0;
    const slow = { ...fake.client, download: async (link) => {
      await new Promise((resolve) => setTimeout(resolve, link.endsWith('/a1') ? 1 : 300));
      finished += 1;
      return fake.client.download(link);
    } };
    const controller = new AbortController();
    const pending = runExport({
      client: slow, target: { kind: 'space', spaceKey: 'ENG' }, options: DEFAULT_OPTIONS, previousManifest: null, siteUrl: 'https://x.atlassian.net',
      signal: controller.signal, onProgress: (p) => p.stage === 'attachments' && p.done === 1 && controller.abort(), now: new Date(2026, 8, 28),
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(finished).toBeLessThan(5);
  });

  it('keeps reporting scan progress while loading metadata and attachment lists', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const scan = [];
    await run(fake, { onProgress: (p) => p.stage === 'scan' && scan.push(p) });
    const done = scan.map((p) => p.done);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBe(9);
    expect(scan.every((p) => p.total === 0)).toBe(true);
  });

  it('lists previous files that a forced full export no longer writes', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previousManifest = await previousOf(fake);
    const result = await run(fake, { previousManifest, options: { ...DEFAULT_OPTIONS, preset: 'hugo' } });
    const out = await files(result);
    expect(Object.keys(out)).toContain('home/_index.md');
    expect(result.deletePaths).toEqual(['home/index.md']);
    expect(out['export-deleted.txt']).toBe('home/index.md\n');
    expect(result.stats).toMatchObject({ deleted: 1, missing: 0 });
  });

  const vanishing = (fake, id, withBody) => ({
    ...fake,
    client: { ...fake.client, getPages: async (ids, opts) => (await fake.client.getPages(ids, opts)).filter((p) => !(p.id === id && opts.withBody === withBody)) },
  });

  it('drops a page that vanished before its body was fetched and counts it as missing', async () => {
    const fake = vanishing(createFakeConfluence({ space: eng, pages: pages(), users: {} }), '3', true);
    const result = await run(fake);
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual(['export-manifest.json', 'home/api.assets/d.png', 'home/api.md', 'home/index.md']);
    expect(result.stats).toMatchObject({ pages: 2, written: 2, missing: 1 });
    expect(JSON.parse(out['export-manifest.json']).pages.map((p) => p.id)).toEqual(['2', '1']);
  });

  it('drops a parent that vanished before metadata and keeps its children in its place', async () => {
    const fake = vanishing(createFakeConfluence({ space: eng, pages: pages(), users: {} }), '1', false);
    const result = await run(fake);
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual(['api.assets/d.png', 'api.md', 'cafe.md', 'export-manifest.json']);
    expect(result.stats).toMatchObject({ pages: 2, missing: 1 });
    expect(out['cafe.md']).toContain('[Home](https://x.atlassian.net/wiki/display/ENG/Home)');
  });
});

describe('runExport with Confluence folders', () => {
  const eng = { id: '5', key: 'ENG', name: 'Eng' };
  const withFolder = () => [
    ...pages(),
    { id: '40', type: 'folder', title: 'Folder test', parentId: '1', position: 2 },
    { id: '41', title: 'Page in folder', parentId: '40', position: 0, version: 1, authorId: 'u1', labels: [], body: '<p>Inside</p>', attachments: [{ id: 'a9', title: 'f.png', version: 1, bytes: PNG }] },
    { id: '42', type: 'folder', title: 'Empty folder', parentId: '1', position: 3 },
  ];
  const spy = (fake) => {
    const asked = [];
    const getPages = fake.client.getPages;
    fake.client.getPages = (ids, opts) => {
      asked.push(...ids);
      return getPages(ids, opts);
    };
    return asked;
  };

  it('exports pages inside a folder into a plain directory and records the folder in the manifest', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withFolder(), users: {} });
    const asked = spy(fake);
    const result = await run(fake);
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual([
      'export-manifest.json', 'home/api.assets/d.png', 'home/api.md', 'home/cafe.md', 'home/folder-test/page-in-folder.assets/f.png',
      'home/folder-test/page-in-folder.md', 'home/index.md',
    ]);
    expect(out['home/folder-test/page-in-folder.md']).toContain('parent_id: "40"');
    expect(asked).not.toContain('40');
    expect(asked).not.toContain('42');
    const manifest = JSON.parse(out['export-manifest.json']);
    expect(manifest.pages.find((p) => p.id === '40')).toEqual({ id: '40', type: 'folder', title: 'Folder test', parentId: '1', path: 'home/folder-test', name: 'folder-test', weight: 30, links: [], attachments: [] });
    expect(manifest.pages.some((p) => p.id === '42')).toBe(false);
    expect(result.stats).toMatchObject({ pages: 4, written: 4, added: 4 });
  });

  it('lists a folder in the parent children macro as its directory', async () => {
    const list = withFolder();
    list[0].body = '<ac:structured-macro ac:name="children"/>';
    const out = await files(await run(createFakeConfluence({ space: eng, pages: list, users: {} })));
    expect(out['home/index.md']).toContain('- [Folder test](folder-test)');
  });

  it('writes folder navigation files for docusaurus and mkdocs', async () => {
    const docusaurus = await files(await run(createFakeConfluence({ space: eng, pages: withFolder(), users: {} }), { options: { ...DEFAULT_OPTIONS, preset: 'docusaurus' } }));
    expect(docusaurus['home/folder-test/_category_.json']).toBe('{\n  "label": "Folder test",\n  "position": 30\n}\n');
    const mkdocs = await files(await run(createFakeConfluence({ space: eng, pages: withFolder(), users: {} }), { options: { ...DEFAULT_OPTIONS, preset: 'mkdocs' } }));
    expect(mkdocs['home/folder-test/.pages']).toBe('title: "Folder test"\nnav:\n  - "page-in-folder.md"\n');
    expect(mkdocs['home/.pages']).toContain('  - "folder-test"\n');
    expect(mkdocs['home/.pages']).not.toContain('empty-folder');
  });

  it('keeps an unchanged export with folders as a no-op update', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withFolder(), users: {} });
    const first = await files(await run(fake));
    const result = await run(fake, { previousManifest: JSON.parse(first['export-manifest.json']) });
    const out = await files(result);
    expect(Object.keys(out)).toEqual(['export-manifest.json']);
    expect(out['export-manifest.json']).toBe(first['export-manifest.json']);
    expect(result.stats).toMatchObject({ missing: 0, unchanged: 4, deleted: 0 });
  });

  it('moves the pages of a renamed folder and never lists the folder directory for deletion', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withFolder(), users: {} });
    const previousManifest = JSON.parse((await files(await run(fake)))['export-manifest.json']);
    fake.update('40', { title: 'Renamed folder' });
    const result = await run(fake, { previousManifest });
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual([
      'export-deleted.txt', 'export-manifest.json', 'home/renamed-folder/page-in-folder.assets/f.png', 'home/renamed-folder/page-in-folder.md',
    ]);
    expect(out['export-deleted.txt']).toBe('home/folder-test/page-in-folder.assets/f.png\nhome/folder-test/page-in-folder.md\n');
    expect(result.stats).toMatchObject({ moved: 1, missing: 0 });
  });

  it('drops a removed folder from the manifest without counting it as a missing page', async () => {
    const fake = createFakeConfluence({ space: eng, pages: withFolder(), users: {} });
    const previousManifest = JSON.parse((await files(await run(fake)))['export-manifest.json']);
    fake.remove('40');
    const result = await run(fake, { previousManifest });
    const out = await files(result);
    expect(out['home/page-in-folder.md']).toContain('Inside');
    expect(JSON.parse(out['export-manifest.json']).pages.some((p) => p.id === '40')).toBe(false);
    expect(result.stats).toMatchObject({ moved: 1, missing: 0 });
  });

  it('exports a branch rooted above a folder', async () => {
    const out = await files(await run(createFakeConfluence({ space: eng, pages: withFolder(), users: {} }), { target: { kind: 'branch', spaceKey: 'ENG', pageId: '1' } }));
    expect(Object.keys(out)).toContain('home/folder-test/page-in-folder.md');
  });
});

describe('runExport sources and labels', () => {
  const eng = { id: '5', key: 'ENG', name: 'Eng' };
  const manifestOf = async (result) => parseManifest((await files(result))['export-manifest.json']).manifest;

  it('treats a branch manifest reused for a single-page export as another source', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const manifest = await manifestOf(await run(fake, { target: { kind: 'branch', spaceKey: 'ENG', pageId: '1' } }));
    expect(manifest.source).toEqual({ siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: '1', kind: 'branch' });
    const single = await run(fake, { target: { kind: 'page', spaceKey: 'ENG', pageId: '1' }, previousManifest: manifest });
    expect(single).toMatchObject({ mode: 'full', fullReason: 'other-source', deletePaths: [] });
    expect(single.stats.missing).toBe(0);
    expect(Object.keys(await files(single)).sort()).toEqual(['export-manifest.json', 'home.md']);
  });

  it('treats a manifest without a target kind as another source', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const manifest = await manifestOf(await run(fake));
    delete manifest.source.kind;
    expect(await run(fake, { previousManifest: manifest })).toMatchObject({ mode: 'full', fullReason: 'other-source' });
  });

  it('records a labels hash per page and rewrites an unchanged page whose labels changed', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previousManifest = await manifestOf(await run(fake));
    expect(previousManifest.pages.find((p) => p.id === '1').labelsHash).toBe(labelsHash(['doc']));
    fake.update('3', { labels: ['reviewed', 'faq'] });
    const result = await run(fake, { previousManifest });
    const out = await files(result);
    expect(Object.keys(out).sort()).toEqual(['export-manifest.json', 'home/cafe.md']);
    expect(out['home/cafe.md']).toContain('labels:\n  - "faq"\n  - "reviewed"\n');
    expect(result.stats).toMatchObject({ changed: 1, unchanged: 2 });
    expect(JSON.parse(out['export-manifest.json']).pages.find((p) => p.id === '3').labelsHash).toBe(labelsHash(['faq', 'reviewed']));
  });

  it('reads labels in one batch for an update and per page only for fetched pages', async () => {
    const fake = createFakeConfluence({ space: eng, pages: pages(), users: {} });
    const previousManifest = await manifestOf(await run(fake));
    expect(fake.calls.getLabelsOf).toBe(0);
    const labelsBefore = fake.calls.getLabels;
    await run(fake, { previousManifest });
    expect(fake.calls.getLabelsOf).toBe(1);
    expect(fake.calls.getLabels).toBe(labelsBefore);
  });
});

describe('runExport file embeds', () => {
  it('keeps an attachment shown by a view-file macro in referenced mode', async () => {
    const list = pages();
    list[1].body = '<ac:structured-macro ac:name="viewpdf"><ac:parameter ac:name="name"><ri:attachment ri:filename="d.png"/></ac:parameter></ac:structured-macro>';
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: list, users: {} });
    const out = await files(await run(fake, { options: { ...DEFAULT_OPTIONS, attachments: 'referenced' } }));
    expect(out['home/api.md']).toContain('[d.png](api.assets/d.png)');
    expect(out['home/api.assets/d.png']).toEqual([...PNG]);
  });
});
