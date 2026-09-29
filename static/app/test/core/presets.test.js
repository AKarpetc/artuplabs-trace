import { describe, expect, it } from 'vitest';
import { planPaths } from '../../src/core/paths.js';
import { DEFAULT_OPTIONS, PRESETS, presetFiles, presetOf } from '../../src/core/presets.js';
import { treeOf } from '../fixtures/tree.js';

const tree = treeOf([['1', 'Guide'], ['2', 'Intro', '1'], ['3', 'Deep Dive', '1'], ['4', 'Part', '3'], ['5', 'FAQ']]);

describe('preset flavours', () => {
  it('declares the Markdown flavour each site generator reads', () => {
    expect(Object.fromEntries(Object.entries(PRESETS).map(([key, preset]) => [key, preset.flavor]))).toEqual({ generic: 'gfm', hugo: 'gfm', docusaurus: 'mdx', mkdocs: 'mkdocs' });
    expect(presetOf('unknown').flavor).toBe('gfm');
  });
});

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
    expect(presetOf('hugo')).toEqual({ indexFile: '_index.md', orderKey: 'weight', extras: null, flavor: 'gfm' });
    expect(presetOf('unknown')).toEqual(presetOf('generic'));
  });

  const withFolder = treeOf([['1', 'Home'], ['2', 'Intro', '1'], ['3', 'Folder test', '1', 'folder'], ['4', 'Page in folder', '3']]);

  it('writes a _category_.json for a folder in docusaurus', () => {
    const options = { ...DEFAULT_OPTIONS, preset: 'docusaurus' };
    expect(presetFiles(withFolder, planPaths(withFolder, options, new Map()), options)).toEqual([
      { path: 'home/_category_.json', content: '{\n  "label": "Home",\n  "position": 10\n}\n' },
      { path: 'home/folder-test/_category_.json', content: '{\n  "label": "Folder test",\n  "position": 20\n}\n' },
    ]);
  });

  it('writes a .pages file with the folder title and no index entry in mkdocs', () => {
    const options = { ...DEFAULT_OPTIONS, preset: 'mkdocs' };
    expect(presetFiles(withFolder, planPaths(withFolder, options, new Map()), options)).toEqual([
      { path: '.pages', content: 'nav:\n  - "home"\n' },
      { path: 'home/.pages', content: 'title: "Home"\nnav:\n  - "index.md"\n  - "intro.md"\n  - "folder-test"\n' },
      { path: 'home/folder-test/.pages', content: 'title: "Folder test"\nnav:\n  - "page-in-folder.md"\n' },
    ]);
  });
});
