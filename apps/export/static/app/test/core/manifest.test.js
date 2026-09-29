import { describe, expect, it } from 'vitest';
import { buildManifest, isDeletablePath, isSafePath, labelsHash, parseManifest, previousNames, sameOptions, sameSource } from '../../src/core/manifest.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

const page = (id, path, over = {}) => ({ id, title: `T${id}`, parentId: null, version: 1, path, name: path.replace(/\.md$/, ''), weight: 10, links: [], attachments: [], ...over });
const input = {
  siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: null, kind: 'space', options: DEFAULT_OPTIONS,
  pages: [page('2', 'b.md', { links: ['9', '1'] }), page('1', 'a.md', { attachments: [{ id: 'att2', version: 1, path: 'a.assets/z.png' }, { id: 'att1', version: 3, path: 'a.assets/y.png' }] })],
  warnings: [{ pageId: '2', kind: 'unknown-macro', detail: 'drawio' }, { pageId: '1', kind: 'dynamic-macro', detail: 'toc' }],
};

describe('manifest', () => {
  it('is deterministic regardless of input order', () => {
    const shuffled = { ...input, pages: [...input.pages].reverse(), warnings: [...input.warnings].reverse() };
    expect(buildManifest(shuffled)).toBe(buildManifest(input));
    expect(buildManifest(input).endsWith('\n')).toBe(true);
    expect(buildManifest(input)).not.toMatch(/"(generatedAt|exportedAt|time)"/);
  });
  it('sorts pages by path and nested arrays', () => {
    const parsed = JSON.parse(buildManifest(input));
    expect(parsed.pages.map((p) => p.id)).toEqual(['1', '2']);
    expect(parsed.pages[0].attachments.map((a) => a.id)).toEqual(['att1', 'att2']);
    expect(parsed.pages[1].links).toEqual(['1', '9']);
    expect(parsed.warnings.map((w) => w.pageId)).toEqual(['1', '2']);
  });
  it('round-trips and exposes previous names', () => {
    const result = parseManifest(buildManifest(input));
    expect(result.ok).toBe(true);
    expect(previousNames(result.manifest)).toEqual(new Map([['1', 'a'], ['2', 'b']]));
    expect(sameSource(result.manifest, { siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: null, kind: 'space' })).toBe(true);
    expect(sameSource(result.manifest, { siteUrl: 'https://x.atlassian.net', spaceKey: 'HR', rootPageId: null, kind: 'space' })).toBe(false);
    expect(sameOptions(result.manifest, DEFAULT_OPTIONS)).toBe(true);
    expect(sameOptions(result.manifest, { ...DEFAULT_OPTIONS, preset: 'hugo' })).toBe(false);
    expect(sameOptions(result.manifest, { ...DEFAULT_OPTIONS, maxAttachmentMb: 10 })).toBe(true);
  });
  it.each([
    ['{', 'not-json'],
    ['{"format":"other","version":1,"pages":[]}', 'not-manifest'],
    ['{"format":"artup-export","version":1}', 'not-manifest'],
    ['{"format":"artup-export","version":2,"pages":[]}', 'newer-version'],
    ['{"format":"artup-export","version":1,"pages":[null]}', 'not-manifest'],
    ['{"format":"artup-export","version":1,"pages":[{"id":"1","path":"a.md","name":"a","version":1,"weight":10,"attachments":[]}]}', 'not-manifest'],
    ['{"format":"artup-export","version":1,"pages":[{"id":"1","path":"a.md","name":"a","version":1,"weight":10,"links":[],"attachments":"nope"}]}', 'not-manifest'],
  ])('rejects %s as %s', (text, error) => expect(parseManifest(text)).toEqual({ ok: false, error }));

  it.each([
    '/etc/passwd', '../x.md', 'a/../../x.md', 'a//b.md', 'a/./b.md', 'a\\b.md', 'a\u0000.md', 'C:/x.md', '', 'a/',
    'evil\n/Users/victim/.zshrc', 'x\r\n/tmp/a.md', 'a\tb.md', 'a\u001fb.md', 'a\u007fb.md', 'a\u2028b.md', 'a\u2029b.md',
  ])('rejects the unsafe page path %j', (path) => {
    const text = buildManifest({ ...input, pages: [page('1', path)] });
    expect(parseManifest(text)).toEqual({ ok: false, error: 'not-manifest' });
    expect(isSafePath(path)).toBe(false);
  });

  it('rejects an unsafe attachment path', () => {
    const text = buildManifest({ ...input, pages: [page('1', 'a.md', { attachments: [{ id: 'x', version: 1, path: '../../.ssh/id_rsa' }] })] });
    expect(parseManifest(text)).toEqual({ ok: false, error: 'not-manifest' });
  });

  it('accepts nested relative paths with dots inside names', () => {
    expect(['a.md', 'home/api/index.md', 'home/a.assets/v1.2.png', 'x/..hidden/.pages'].every(isSafePath)).toBe(true);
  });

  it('drops extra keys from warnings before comparing and serializing', () => {
    const extra = { ...input, warnings: input.warnings.map((w) => ({ ...w, extraKey: 'ignored' })) };
    expect(buildManifest(extra)).toBe(buildManifest(input));
  });

  it('writes a folder as an entry without a version and reads it back', () => {
    const folder = { id: '40', type: 'folder', title: 'Folder test', parentId: '1', path: 'a/folder-test', name: 'folder-test', weight: 20, version: 7, links: ['3'], attachments: [] };
    const text = buildManifest({ ...input, pages: [...input.pages, folder] });
    const entry = JSON.parse(text).pages.find((p) => p.id === '40');
    expect(entry).toEqual({ id: '40', type: 'folder', title: 'Folder test', parentId: '1', path: 'a/folder-test', name: 'folder-test', weight: 20, links: [], attachments: [] });
    expect(parseManifest(text).ok).toBe(true);
    const pageWithoutVersion = JSON.stringify({ format: 'artup-export', version: 1, pages: [{ ...entry, type: undefined }], warnings: [] });
    expect(parseManifest(pageWithoutVersion)).toEqual({ ok: false, error: 'not-manifest' });
  });

  it('records the target kind and treats another kind or a missing kind as another source', () => {
    const branch = parseManifest(buildManifest({ ...input, rootPageId: '1', kind: 'branch' })).manifest;
    expect(branch.source).toEqual({ siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: '1', kind: 'branch' });
    const source = { siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: '1' };
    expect(sameSource(branch, { ...source, kind: 'branch' })).toBe(true);
    expect(sameSource(branch, { ...source, kind: 'page' })).toBe(false);
    const older = { ...branch, source: { siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: '1' } };
    expect(sameSource(older, { ...source, kind: 'branch' })).toBe(false);
  });

  it('stores a short stable labels hash that ignores label order', () => {
    expect(labelsHash(['b', 'a'])).toBe(labelsHash(['a', 'b']));
    expect(labelsHash([])).not.toBe(labelsHash(['a']));
    expect(labelsHash(['a', 'b'])).not.toBe(labelsHash(['ab']));
    expect(labelsHash(['draft'])).toMatch(/^[0-9a-f]{8}$/);
    const text = buildManifest({ ...input, pages: [page('1', 'a.md', { labelsHash: labelsHash(['x']) })] });
    expect(JSON.parse(text).pages[0].labelsHash).toBe(labelsHash(['x']));
    expect(parseManifest(text).ok).toBe(true);
    const bad = JSON.stringify({ ...JSON.parse(text), pages: [{ ...JSON.parse(text).pages[0], labelsHash: 7 }] });
    expect(parseManifest(bad)).toEqual({ ok: false, error: 'not-manifest' });
  });

  it.each([
    [{}], ['x'], [[null]], [[{ pageId: 1, kind: 'k', detail: 'd' }]], [[{ pageId: '1', kind: 'k' }]], [[{ pageId: '1', kind: 'k', detail: {} }]],
  ])('rejects malformed warnings %j', (warnings) => {
    const text = JSON.stringify({ ...JSON.parse(buildManifest(input)), warnings });
    expect(parseManifest(text)).toEqual({ ok: false, error: 'not-manifest' });
  });

  it('accepts a manifest without warnings', () => {
    const { warnings, ...rest } = JSON.parse(buildManifest(input));
    expect(warnings).toHaveLength(2);
    expect(parseManifest(JSON.stringify(rest)).ok).toBe(true);
  });

  it('rejects a crafted manifest whose page path hides a newline', () => {
    const text = JSON.stringify({ format: 'artup-export', version: 1, source: {}, options: {}, pages: [page('999', 'evil\n/Users/victim/.zshrc')], warnings: [] });
    expect(parseManifest(text)).toEqual({ ok: false, error: 'not-manifest' });
  });
});

describe('isDeletablePath', () => {
  it.each([
    'a.md', 'home/api/index.md', 'home/_index.md', 'home/api.assets/v1.2.png', 'home/api.assets/sub/file', 'home/_category_.json', '_category_.json',
    '.pages', 'home/.pages',
  ])('allows the written shape %j', (path) => expect(isDeletablePath(path)).toBe(true));

  it.each([
    'export-manifest.json', 'docs/export-manifest.json', 'export-deleted.txt', 'a/export-deleted.txt', 'a.assets/export-manifest.json',
    '.git/config', '.github/workflows/ci.yml', 'home/.env.md', 'home/.hidden/a.md', '.pages/a.md', 'a.assets/.htaccess',
    'README.txt', 'home/config.yml', 'package.json', 'a.assets', 'home/api.assets', 'mkdocs.yml',
    'evil\n/Users/victim/.zshrc', '../x.md', '/etc/x.md',
  ])('refuses %j', (path) => expect(isDeletablePath(path)).toBe(false));
});
