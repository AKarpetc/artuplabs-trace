import { describe, expect, it } from 'vitest';
import { loadFonts } from '../../src/infra/fonts.js';

const dataUrl = (text) => `data:font/ttf;base64,${btoa(text)}`;

function fakeSources(loaded) {
  const face = (name) => [name, async () => {
    loaded.push(name);
    return { default: dataUrl(name) };
  }];
  return {
    latin: { family: 'Sans', normal: face('L-R.ttf'), bold: face('L-B.ttf') },
    cjk: { family: 'CJK', normal: face('C-R.otf'), bold: face('C-B.otf') },
    korean: { family: 'KR', normal: face('K-R.otf'), bold: face('K-B.otf') },
  };
}

describe('loadFonts', () => {
  it('loads only the Latin faces for Latin text', async () => {
    const loaded = [];
    await loadFonts(new Set(['latin']), fakeSources(loaded));
    expect(loaded.sort()).toEqual(['L-B.ttf', 'L-R.ttf']);
  });

  it('loads the Latin faces even when no script is given', async () => {
    const loaded = [];
    await loadFonts(new Set(), fakeSources(loaded));
    expect(loaded.sort()).toEqual(['L-B.ttf', 'L-R.ttf']);
  });

  it('loads the Korean faces only when Korean text is present', async () => {
    const loaded = [];
    await loadFonts(new Set(['latin', 'korean']), fakeSources(loaded));
    expect(loaded.sort()).toEqual(['K-B.otf', 'K-R.otf', 'L-B.ttf', 'L-R.ttf']);
  });

  it('maps each family to its regular and bold files, reusing them for italics', async () => {
    const fonts = await loadFonts(new Set(['latin', 'cjk', 'korean']), fakeSources([]));
    expect(fonts.families).toEqual({
      Sans: { normal: 'L-R.ttf', bold: 'L-B.ttf', italics: 'L-R.ttf', bolditalics: 'L-B.ttf' },
      CJK: { normal: 'C-R.otf', bold: 'C-B.otf', italics: 'C-R.otf', bolditalics: 'C-B.otf' },
      KR: { normal: 'K-R.otf', bold: 'K-B.otf', italics: 'K-R.otf', bolditalics: 'K-B.otf' },
    });
  });

  it('decodes each file to its bytes', async () => {
    const fonts = await loadFonts(new Set(['cjk']), fakeSources([]));
    expect(Object.fromEntries(Object.entries(fonts.files).map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]))).toEqual({
      'L-R.ttf': 'L-R.ttf', 'L-B.ttf': 'L-B.ttf', 'C-R.otf': 'C-R.otf', 'C-B.otf': 'C-B.otf',
    });
  });
});
