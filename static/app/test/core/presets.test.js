import { describe, expect, it } from 'vitest';
import { planPaths } from '../../src/core/paths.js';
import { DEFAULT_OPTIONS, presetFiles, presetOf } from '../../src/core/presets.js';
import { treeOf } from '../fixtures/tree.js';

const tree = treeOf([['1', 'Guide'], ['2', 'Intro', '1'], ['3', 'Deep Dive', '1'], ['4', 'Part', '3'], ['5', 'FAQ']]);

describe('presetFiles', () => {
  it('writes nothing for generic and hugo', () => {
    for (const preset of ['generic', 'hugo']) {
      const options = { ...DEFAULT_OPTIONS, preset };
      expect(presetFiles(tree, planPaths(tree, options, new Map()), options)).toEqual([]);
    }
  });
  it('writes _category_.json per directory for docusaurus', () => {
    const options = { ...DEFAULT_OPTIONS, preset: 'docusaurus' };
    expect(presetFiles(tree, planPaths(tree, options, new Map()), options)).toEqual([
      { path: 'guide/_category_.json', content: '{\n  "label": "Guide",\n  "position": 10\n}\n' },
      { path: 'guide/deep-dive/_category_.json', content: '{\n  "label": "Deep Dive",\n  "position": 20\n}\n' },
    ]);
  });
  it('writes ordered .pages files for mkdocs', () => {
    const options = { ...DEFAULT_OPTIONS, preset: 'mkdocs' };
    const files = presetFiles(tree, planPaths(tree, options, new Map()), options);
    expect(files).toEqual([
      { path: '.pages', content: 'nav:\n  - "guide"\n  - "faq.md"\n' },
      { path: 'guide/.pages', content: 'title: "Guide"\nnav:\n  - "index.md"\n  - "intro.md"\n  - "deep-dive"\n' },
      { path: 'guide/deep-dive/.pages', content: 'title: "Deep Dive"\nnav:\n  - "index.md"\n  - "part.md"\n' },
    ]);
  });
  it('knows every preset', () => {
    expect(presetOf('hugo')).toEqual({ indexFile: '_index.md', orderKey: 'weight', extras: null });
    expect(presetOf('unknown')).toEqual(presetOf('generic'));
  });
});
