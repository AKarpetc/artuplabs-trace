import { describe, expect, it } from 'vitest';
import { buildManifest, isSafePath, parseManifest, previousNames, sameOptions, sameSource } from '../../src/core/manifest.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

const page = (id, path, over = {}) => ({ id, title: `T${id}`, parentId: null, version: 1, path, name: path.replace(/\.md$/, ''), weight: 10, links: [], attachments: [], ...over });
const input = {
  siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: null, options: DEFAULT_OPTIONS,
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
    expect(sameSource(result.manifest, { siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: null })).toBe(true);
    expect(sameSource(result.manifest, { siteUrl: 'https://x.atlassian.net', spaceKey: 'HR', rootPageId: null })).toBe(false);
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
});
