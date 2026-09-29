// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src', import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
const code = files(SRC).filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('/locales/'));

describe('source guards', () => {
  it('uses no hard-coded colours', () => {
    const offenders = code.filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('renders no literal text in JSX', () => {
    const literal = /<[A-Za-z][^<>]*>\s*[\p{L}][^<>{}]*<\//u;
    const offenders = code.filter((f) => f.endsWith('.jsx') && literal.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('imports @atlaskit/icon/core only in components/icons.js, where glyph() unwraps it', () => {
    const offenders = code.filter((f) => !f.endsWith('/components/icons.js') && /@atlaskit\/icon\/core\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('has no comments inside function bodies', () => {
    const offenders = code.filter((f) => /^\s+\/\/(?!\s*eslint)/m.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
