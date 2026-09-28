import { describe, expect, it } from 'vitest';
import { planPaths } from '../../src/core/paths.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';
import { treeOf } from '../fixtures/tree.js';

const paths = (plan) => Object.fromEntries([...plan].map(([id, p]) => [id, p.path]));

describe('planPaths', () => {
  const tree = treeOf([
    ['1', 'Engineering'], ['2', 'Getting Started', '1'], ['3', 'API', '1'], ['4', 'Auth', '3'], ['5', 'Café', null],
  ]);

  it('makes directories for parents and files for leaves, in Confluence order', () => {
    const plan = planPaths(tree, DEFAULT_OPTIONS, new Map());
    expect(paths(plan)).toEqual({
      1: 'engineering/index.md', 2: 'engineering/getting-started.md', 3: 'engineering/api/index.md',
      4: 'engineering/api/auth.md', 5: 'cafe.md',
    });
    expect(plan.get('3')).toMatchObject({ weight: 20, isIndex: true, name: 'api' });
  });

  it('uses _index.md for Hugo', () => {
    expect(planPaths(tree, { ...DEFAULT_OPTIONS, preset: 'hugo' }, new Map()).get('3').path).toBe('engineering/api/_index.md');
  });

  it('adds zero-padded prefixes when ordering is prefix', () => {
    const plan = planPaths(tree, { ...DEFAULT_OPTIONS, ordering: 'prefix' }, new Map());
    expect(plan.get('4').path).toBe('010-engineering/020-api/010-auth.md');
    expect(plan.get('4').name).toBe('auth');
  });

  it('resolves case-insensitive collisions: lowest id keeps the plain name', () => {
    const plan = planPaths(treeOf([['20', 'Notes'], ['7', 'notes'], ['9', 'NOTES'], ['30', 'API'], ['31', 'api']]), DEFAULT_OPTIONS, new Map());
    expect(paths(plan)).toEqual({ 20: 'notes-20.md', 7: 'notes.md', 9: 'notes-9.md', 30: 'api.md', 31: 'api-31.md' });
  });

  it('collides titles that transliterate to the same slug', () => {
    const plan = planPaths(treeOf([['1', 'Café'], ['2', 'Cafe']]), DEFAULT_OPTIONS, new Map());
    expect(paths(plan)).toEqual({ 1: 'cafe.md', 2: 'cafe-2.md' });
  });

  it('keeps names from the previous export when still valid', () => {
    const previous = new Map([['9', 'notes-9']]);
    const plan = planPaths(treeOf([['9', 'Notes']]), DEFAULT_OPTIONS, previous);
    expect(plan.get('9').path).toBe('notes-9.md');
  });

  it('drops a previous name that no longer matches the title', () => {
    const plan = planPaths(treeOf([['9', 'Renamed']]), DEFAULT_OPTIONS, new Map([['9', 'notes']]));
    expect(plan.get('9').path).toBe('renamed.md');
  });

  it('falls back to page-<id> when the title has no usable characters', () => {
    expect(planPaths(treeOf([['42', '设计文档']]), DEFAULT_OPTIONS, new Map()).get('42').path).toBe('page-42.md');
  });

  it('widens the prefix for more than 99 siblings', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [String(i + 1), `P${i + 1}`]);
    const plan = planPaths(treeOf(rows), { ...DEFAULT_OPTIONS, ordering: 'prefix' }, new Map());
    expect(plan.get('1').path).toBe('0010-p1.md');
    expect(plan.get('120').path).toBe('1200-p120.md');
  });

  it('is deterministic', () => {
    expect(paths(planPaths(tree, DEFAULT_OPTIONS, new Map()))).toEqual(paths(planPaths(tree, DEFAULT_OPTIONS, new Map())));
  });
});
