import { describe, expect, it } from 'vitest';
import { assetsDir, encodeLinkTarget, planAttachments, relativePath } from '../../src/core/links.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

describe('relativePath', () => {
  it.each([
    ['a/b/c.md', 'a/b/d.md', 'd.md'],
    ['a/b/c.md', 'a/x/y.md', '../x/y.md'],
    ['c.md', 'a/b/d.md', 'a/b/d.md'],
    ['a/b/c.md', 'd.md', '../../d.md'],
    ['a/index.md', 'a/index.assets/x.png', 'index.assets/x.png'],
    ['a/b.md', 'a/b.md', 'b.md'],
  ])('%s → %s = %s', (from, to, expected) => expect(relativePath(from, to)).toBe(expected));
});

describe('encodeLinkTarget', () => {
  it('encodes only characters that break Markdown links', () => {
    expect(encodeLinkTarget('a b/(c)<d>.md#x')).toBe('a%20b/%28c%29%3Cd%3E.md#x');
    expect(encodeLinkTarget('привет/файл.md')).toBe('привет/файл.md');
  });
  it('encodes a non-breaking space as its two UTF-8 bytes', () => {
    const nbsp = String.fromCharCode(160);
    expect(encodeLinkTarget(`a${nbsp}b.md`)).toBe('a%C2%A0b.md');
  });
});

describe('planAttachments', () => {
  it('puts files next to the page, deduplicated in id order', () => {
    const map = planAttachments('eng/api.md', [{ id: 'att3', title: 'Diagram.PNG' }, { id: 'att2', title: 'diagram.png' }, { id: 'att9', title: 'Схема.pdf' }], DEFAULT_OPTIONS);
    expect(Object.fromEntries(map)).toEqual({
      att2: 'eng/api.assets/diagram.png', att3: 'eng/api.assets/diagram-2.png', att9: 'eng/api.assets/skhema.pdf',
    });
    expect(assetsDir('eng/_index.md')).toBe('eng/_index.assets');
  });
});
