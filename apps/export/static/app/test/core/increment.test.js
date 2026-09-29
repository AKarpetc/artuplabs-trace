import { describe, expect, it } from 'vitest';
import { planUpdate } from '../../src/core/increment.js';

const prev = (pages) => ({ pages: pages.map((p) => ({ links: [], attachments: [], weight: 10, ...p })) });
const plan = (rows) => new Map(rows.map(([id, path, weight = 10]) => [id, { path, weight }]));
const holds = (stats, versions) => stats.added + stats.changed + stats.moved + stats.relinked + stats.unchanged === versions.size;

describe('planUpdate', () => {
  it('fetches only new and changed pages', () => {
    const versions = new Map([['1', 1], ['2', 2], ['3', 1]]);
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'a.md' }, { id: '2', version: 1, path: 'b.md' }]),
      versions,
      plan: plan([['1', 'a.md'], ['2', 'b.md'], ['3', 'c.md']]),
      attachments: null, attachmentPlan: new Map(),
    });
    expect([...result.fetchIds].sort()).toEqual(['2', '3']);
    expect(result.deletePaths).toEqual([]);
    expect(result.stats).toEqual({ added: 1, changed: 1, moved: 0, relinked: 0, missing: 0, unchanged: 1 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('refetches a reordered page (weight change)', () => {
    const versions = new Map([['1', 1]]);
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'a.md', weight: 10 }]),
      versions, plan: plan([['1', 'a.md', 20]]), attachments: null, attachmentPlan: new Map(),
    });
    expect([...result.fetchIds]).toEqual(['1']);
    expect(result.stats).toEqual({ added: 0, changed: 1, moved: 0, relinked: 0, missing: 0, unchanged: 0 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('moves: deletes the old path, relinks pages pointing to it', () => {
    const versions = new Map([['1', 2], ['2', 1]]);
    const result = planUpdate({
      previous: prev([
        { id: '1', version: 1, path: 'old.md', attachments: [{ id: 'a1', version: 1, path: 'old.assets/x.png' }] },
        { id: '2', version: 1, path: 'b.md', links: ['1'] },
      ]),
      versions,
      plan: plan([['1', 'new.md'], ['2', 'b.md']]),
      attachments: new Map([['1', [{ id: 'a1', version: 1 }]], ['2', []]]),
      attachmentPlan: new Map([['1', new Map([['a1', 'new.assets/x.png']])], ['2', new Map()]]),
    });
    expect([...result.fetchIds].sort()).toEqual(['1', '2']);
    expect([...result.downloadIds]).toEqual(['a1']);
    expect(result.deletePaths).toEqual(['old.assets/x.png', 'old.md']);
    expect(result.stats).toEqual({ added: 0, changed: 0, moved: 1, relinked: 1, missing: 0, unchanged: 0 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('never deletes a path written in the same export (title swap)', () => {
    const versions = new Map([['1', 2], ['2', 2]]);
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'x.md' }, { id: '2', version: 1, path: 'y.md' }]),
      versions,
      plan: plan([['1', 'y.md'], ['2', 'x.md']]), attachments: null, attachmentPlan: new Map(),
    });
    expect(result.deletePaths).toEqual([]);
    expect([...result.fetchIds].sort()).toEqual(['1', '2']);
    expect(result.stats).toEqual({ added: 0, changed: 0, moved: 2, relinked: 0, missing: 0, unchanged: 0 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('reports missing pages (deleted or restricted) and relinks their referrers', () => {
    const versions = new Map([['2', 1]]);
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'gone.md', attachments: [{ id: 'a9', version: 1, path: 'gone.assets/f.pdf' }] }, { id: '2', version: 1, path: 'b.md', links: ['1'] }]),
      versions, plan: plan([['2', 'b.md']]), attachments: null, attachmentPlan: new Map(),
    });
    expect(result.deletePaths).toEqual(['gone.assets/f.pdf', 'gone.md']);
    expect([...result.fetchIds]).toEqual(['2']);
    expect(result.stats).toEqual({ added: 0, changed: 0, moved: 0, relinked: 1, missing: 1, unchanged: 0 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('downloads new or changed attachments of unchanged pages and deletes removed ones', () => {
    const versions = new Map([['1', 1]]);
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'a.md', attachments: [{ id: 'a1', version: 1, path: 'a.assets/one.png' }, { id: 'a2', version: 1, path: 'a.assets/two.png' }, { id: 'a3', version: 1, path: 'a.assets/three.png' }] }]),
      versions, plan: plan([['1', 'a.md']]),
      attachments: new Map([['1', [{ id: 'a1', version: 1 }, { id: 'a2', version: 2 }, { id: 'a4', version: 1 }]]]),
      attachmentPlan: new Map([['1', new Map([['a1', 'a.assets/one.png'], ['a2', 'a.assets/two.png'], ['a4', 'a.assets/four.png']])]]),
    });
    expect([...result.fetchIds]).toEqual([]);
    expect([...result.downloadIds].sort()).toEqual(['a2', 'a4']);
    expect(result.deletePaths).toEqual(['a.assets/three.png']);
    expect(result.stats).toEqual({ added: 0, changed: 0, moved: 0, relinked: 0, missing: 0, unchanged: 1 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('refetches an unchanged page whose labels hash differs, and one from a manifest without hashes', () => {
    const versions = new Map([['1', 1], ['2', 1], ['3', 1], ['4', 1]]);
    const result = planUpdate({
      previous: prev([
        { id: '1', version: 1, path: 'a.md', labelsHash: 'aaaa' }, { id: '2', version: 1, path: 'b.md', labelsHash: 'bbbb' },
        { id: '3', version: 1, path: 'c.md' }, { id: '4', version: 1, path: 'd.md', labelsHash: 'dddd' },
      ]),
      versions, plan: plan([['1', 'a.md'], ['2', 'b.md'], ['3', 'c.md'], ['4', 'd.md']]), attachments: null, attachmentPlan: new Map(),
      labels: new Map([['1', 'aaaa'], ['2', 'cccc'], ['3', 'eeee']]),
    });
    expect([...result.fetchIds].sort()).toEqual(['2', '3']);
    expect(result.stats).toEqual({ added: 0, changed: 2, moved: 0, relinked: 0, missing: 0, unchanged: 2 });
    expect(holds(result.stats, versions)).toBe(true);
  });

  it('ignores folder entries when deciding what to fetch or delete', () => {
    const versions = new Map([['2', 1]]);
    const result = planUpdate({
      previous: prev([{ id: '40', type: 'folder', path: 'home/folder' }, { id: '2', version: 1, path: 'home/folder/b.md' }]),
      versions, plan: plan([['2', 'home/folder/b.md']]), attachments: null, attachmentPlan: new Map(),
    });
    expect(result.deletePaths).toEqual([]);
    expect(result.stats).toEqual({ added: 0, changed: 0, moved: 0, relinked: 0, missing: 0, unchanged: 1 });
  });
});
