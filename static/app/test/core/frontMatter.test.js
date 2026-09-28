import { describe, expect, it } from 'vitest';
import { renderFrontMatter } from '../../src/core/frontMatter.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

const meta = {
  id: '123', title: 'Say "hi"\\ now', spaceKey: 'ENG', parentId: '100', version: 7, author: 'Анна Ким',
  updated: '2026-09-01T10:00:00.000Z', labels: ['b', 'a'], url: 'https://x.atlassian.net/wiki/spaces/ENG/pages/123', weight: 20,
};

describe('renderFrontMatter', () => {
  it('writes stable YAML with sorted labels and the preset order key', () => {
    expect(renderFrontMatter(meta, DEFAULT_OPTIONS)).toBe([
      '---',
      'title: "Say \\"hi\\"\\\\ now"',
      'confluence_id: "123"',
      'space: "ENG"',
      'parent_id: "100"',
      'version: 7',
      'author: "Анна Ким"',
      'updated: "2026-09-01T10:00:00.000Z"',
      'weight: 20',
      'labels:',
      '  - "a"',
      '  - "b"',
      'source: "https://x.atlassian.net/wiki/spaces/ENG/pages/123"',
      '---',
      '',
    ].join('\n'));
  });
  it('uses sidebar_position for docusaurus, nothing for mkdocs, [] for no labels, skips null fields', () => {
    const docu = renderFrontMatter({ ...meta, labels: [], parentId: null, author: null }, { ...DEFAULT_OPTIONS, preset: 'docusaurus' });
    expect(docu).toContain('sidebar_position: 20');
    expect(docu).toContain('labels: []');
    expect(docu).not.toContain('parent_id');
    expect(docu).not.toContain('author');
    expect(renderFrontMatter(meta, { ...DEFAULT_OPTIONS, preset: 'mkdocs' })).not.toMatch(/weight|sidebar_position/);
  });
  it('escapes control characters', () => {
    expect(renderFrontMatter({ ...meta, title: 'a\u0007b\nc' }, DEFAULT_OPTIONS)).toContain('title: "a\\x07b\\nc"');
  });
});
