import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src', import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
const code = files(SRC).filter((f) => f.endsWith('.js'));
const text = (f) => readFileSync(f, 'utf8');

describe('server source guards', () => {
  it('has no comments inside function bodies', () => {
    expect(code.filter((f) => /^\s+\/\/(?!\s*eslint)/m.test(text(f)))).toEqual([]);
  });
  it('keeps the core free of the clock', () => {
    expect(code.filter((f) => f.includes('/src/core/') && /\bDate\.now\(|\bnew Date\(\s*\)/.test(text(f)))).toEqual([]);
  });
  it('never mentions tasks, the plan, the specification or rulings', () => {
    expect(code.filter((f) => /\bTask \d|\bplan\b|\bspecification\b|\brulings?\b|\bQ-R\d/i.test(text(f)))).toEqual([]);
  });
});
