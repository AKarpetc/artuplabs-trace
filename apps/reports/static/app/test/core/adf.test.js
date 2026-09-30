import { describe, expect, it } from 'vitest';
import { adfToModel, blocksToText, truncateCell } from '../../src/core/adf.js';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content });
const cell = (text, attrs, type = 'tableCell') => ({ type, ...(attrs ? { attrs } : {}), content: [p(t(text))] });

describe('adfToModel', () => {
  it('keeps text marks as run flags', () => {
    const { blocks } = adfToModel(doc(p(t('a', [{ type: 'strong' }, { type: 'em' }]), t('b', [{ type: 'link', attrs: { href: 'https://e.x' } }]), t('c', [{ type: 'code' }, { type: 'strike' }, { type: 'underline' }, { type: 'textColor', attrs: { color: '#ff0000' } }, { type: 'subsup', attrs: { type: 'sup' } }]))));
    expect(blocks).toEqual([{ type: 'para', runs: [
      { text: 'a', bold: true, italic: true },
      { text: 'b', link: 'https://e.x' },
      { text: 'c', code: true, strike: true, underline: true, color: '#ff0000', sup: true },
    ] }]);
  });
  it('turns a hard break into a newline run', () => {
    expect(adfToModel(doc(p(t('a'), { type: 'hardBreak' }, t('b')))).blocks[0].runs).toEqual([{ text: 'a' }, { text: '\n' }, { text: 'b' }]);
  });
  it('writes mention, emoji, date, status and inline card as text', () => {
    const { blocks } = adfToModel(doc(p(
      { type: 'mention', attrs: { id: 'x', text: '@Ann' } },
      { type: 'emoji', attrs: { shortName: ':smile:', text: '😄' } },
      { type: 'date', attrs: { timestamp: '1790640000000' } },
      { type: 'status', attrs: { text: 'In progress', color: 'blue' } },
      { type: 'inlineCard', attrs: { url: 'https://e.x/a' } },
    )), { formatDate: () => '29.09.2026' });
    expect(blocks[0].runs).toEqual([
      { text: '@Ann' }, { text: '😄' }, { text: '29.09.2026' },
      { text: '[IN PROGRESS]', bold: true }, { text: 'https://e.x/a', link: 'https://e.x/a' },
    ]);
  });
  it('writes a date with a non-numeric timestamp as its raw text', () => {
    expect(adfToModel(doc(p({ type: 'date', attrs: { timestamp: 'soon' } }))).blocks[0].runs).toEqual([{ text: 'soon' }]);
  });
  it('names an unresolved image without alt by its media id', () => {
    const { warnings } = adfToModel(doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'uuid-1', type: 'file', collection: '' } }] }));
    expect(warnings).toEqual([{ kind: 'image-unresolved', detail: 'uuid-1' }]);
  });
  it('keeps heading levels and clamps them to 1..6', () => {
    const { blocks } = adfToModel(doc({ type: 'heading', attrs: { level: 2 }, content: [t('H')] }, { type: 'heading', attrs: { level: 9 }, content: [t('X')] }));
    expect(blocks).toEqual([{ type: 'heading', level: 2, runs: [{ text: 'H' }] }, { type: 'heading', level: 6, runs: [{ text: 'X' }] }]);
  });
  it('nests lists and keeps the ordered start', () => {
    const { blocks } = adfToModel(doc({ type: 'orderedList', attrs: { order: 3 }, content: [
      { type: 'listItem', content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('inner'))] }] }] },
    ] }));
    expect(blocks).toEqual([{ type: 'list', ordered: true, start: 3, items: [{ blocks: [
      { type: 'para', runs: [{ text: 'one' }] },
      { type: 'list', ordered: false, start: 1, items: [{ blocks: [{ type: 'para', runs: [{ text: 'inner' }] }] }] },
    ] }] }]);
  });
  it('renders task items with a checkbox prefix', () => {
    const { blocks } = adfToModel(doc({ type: 'taskList', attrs: { localId: 'l' }, content: [
      { type: 'taskItem', attrs: { localId: 'a', state: 'DONE' }, content: [t('done')] },
      { type: 'taskItem', attrs: { localId: 'b', state: 'TODO' }, content: [t('todo')] },
    ] }));
    expect(blocks[0].items.map((i) => i.blocks[0].runs)).toEqual([[{ text: '[x] ' }, { text: 'done' }], [{ text: '[ ] ' }, { text: 'todo' }]]);
  });
  it('keeps table spans and marks a header row', () => {
    const { blocks } = adfToModel(doc({ type: 'table', content: [
      { type: 'tableRow', content: [cell('A', null, 'tableHeader'), cell('B', null, 'tableHeader')] },
      { type: 'tableRow', content: [cell('wide', { colspan: 2 })] },
    ] }));
    expect(blocks[0]).toEqual({ type: 'table', header: true, rows: [
      { cells: [
        { header: true, colspan: 1, rowspan: 1, blocks: [{ type: 'para', runs: [{ text: 'A' }] }] },
        { header: true, colspan: 1, rowspan: 1, blocks: [{ type: 'para', runs: [{ text: 'B' }] }] },
      ] },
      { cells: [{ header: false, colspan: 2, rowspan: 1, blocks: [{ type: 'para', runs: [{ text: 'wide' }] }] }] },
    ] });
  });
  it('maps code, quote, panel, rule and expand', () => {
    const { blocks } = adfToModel(doc(
      { type: 'codeBlock', attrs: { language: 'json' }, content: [t('{"a":1}')] },
      { type: 'blockquote', content: [p(t('q'))] },
      { type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('w'))] },
      { type: 'rule' },
      { type: 'expand', attrs: { title: 'More' }, content: [p(t('m'))] },
    ));
    expect(blocks).toEqual([
      { type: 'code', language: 'json', text: '{"a":1}' },
      { type: 'quote', blocks: [{ type: 'para', runs: [{ text: 'q' }] }] },
      { type: 'panel', kind: 'warning', blocks: [{ type: 'para', runs: [{ text: 'w' }] }] },
      { type: 'rule' },
      { type: 'para', runs: [{ text: 'More', bold: true }] },
      { type: 'para', runs: [{ text: 'm' }] },
    ]);
  });
  it('resolves media through the resolver and warns when it cannot', () => {
    const media = (alt) => ({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'uuid', type: 'file', collection: 'c', alt, width: 320, height: 200 } }] });
    const { blocks, warnings } = adfToModel(doc(media('a.png'), media('b.png')), { resolveMedia: (attrs) => (attrs.alt === 'a.png' ? '10001' : null) });
    expect(blocks).toEqual([
      { type: 'image', attachmentId: '10001', alt: 'a.png', width: 320, height: 200 },
      { type: 'image', attachmentId: null, alt: 'b.png', width: 320, height: 200 },
    ]);
    expect(warnings).toEqual([{ kind: 'image-unresolved', detail: 'b.png' }]);
  });
  it('does not download external images', () => {
    const { blocks, warnings } = adfToModel(doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { type: 'external', url: 'https://e.x/i.png' } }] }));
    expect(blocks).toEqual([{ type: 'image', attachmentId: null, alt: 'https://e.x/i.png', width: null, height: null }]);
    expect(warnings).toEqual([{ kind: 'image-external', detail: 'https://e.x/i.png' }]);
  });
  it('flattens layouts and falls back to text for unknown nodes with a warning', () => {
    const { blocks, warnings } = adfToModel(doc(
      { type: 'layoutSection', content: [{ type: 'layoutColumn', content: [p(t('left'))] }, { type: 'layoutColumn', content: [p(t('right'))] }] },
      { type: 'futureNode', content: [t('kept')] },
    ));
    expect(blocks).toEqual([
      { type: 'para', runs: [{ text: 'left' }] },
      { type: 'para', runs: [{ text: 'right' }] },
      { type: 'para', runs: [{ text: 'kept' }] },
    ]);
    expect(warnings).toEqual([{ kind: 'adf-fallback', detail: 'futureNode' }]);
  });
  it('returns no blocks for a missing document', () => {
    expect(adfToModel(null)).toEqual({ blocks: [], warnings: [] });
  });
});

describe('blocksToText', () => {
  it('writes lists with markers and indentation, tables with bars', () => {
    const { blocks } = adfToModel(doc(
      p(t('Intro')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('b'))] }] }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [cell('x'), cell('y')] }] },
    ));
    expect(blocksToText(blocks)).toBe('Intro\n• a\n  1. b\nx | y');
  });
});

describe('truncateCell', () => {
  it('keeps short text', () => {
    expect(truncateCell('abc', 10)).toBe('abc');
  });
  it('cuts long text and states how much was cut, within the limit', () => {
    const out = truncateCell('x'.repeat(100), 40);
    expect(out).toBe(`${'x'.repeat(24)} …[+76]`);
    expect(out.length).toBeLessThanOrEqual(40);
  });
  it('stays within a limit smaller than the cut note', () => {
    expect(truncateCell('x'.repeat(100), 5)).toBe('xxxxx');
  });
  it('never splits a surrogate pair', () => {
    const out = truncateCell('😀'.repeat(50), 40);
    expect(/[\uD800-\uDBFF] …/.test(out)).toBe(false);
  });
});

describe('real RPT descriptions', () => {
  it.each(['rpt-merged', 'rpt-cjk', 'rpt-lists'])('%s converts without fallback warnings', async (name) => {
    const { default: adf } = await import(`../fixtures/adf/${name}.json`);
    const { blocks, warnings } = adfToModel(adf);
    expect(blocks.length).toBeGreaterThan(0);
    expect(warnings).toEqual([]);
  });
});
