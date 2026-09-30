import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/palette.js';
import { blocksToOoxml, escapeXml } from '../../src/render/ooxml.js';

const labels = { imageUnavailable: 'Image unavailable' };
const xml = (blocks, extra = {}) => blocksToOoxml(blocks, { image: () => null, labels, contentWidthPx: 600, ...extra });
const para = (text, style = {}) => ({ type: 'para', runs: [{ text, ...style }] });
const cell = (blocks, extra = {}) => ({ header: false, colspan: 1, rowspan: 1, blocks, ...extra });
const all = (re, text) => [...text.matchAll(re)].map((m) => m[1]);
const cells = (text) => all(/<w:tc>([\s\S]*?)<\/w:tc>/g, text);

describe('escapeXml', () => {
  it('escapes markup characters and quotes', () => {
    expect(escapeXml('<a & "b">')).toEqual('&lt;a &amp; &quot;b&quot;&gt;');
  });

  it('drops control characters that XML 1.0 forbids and keeps tab, newline and carriage return', () => {
    expect(escapeXml('a\u0000b\u0007c\u000Bd\te\nf\rg￾h')).toEqual('abcd\te\nf\rgh');
  });

  it('renders null as an empty string', () => {
    expect(escapeXml(null)).toEqual('');
  });
});

describe('blocksToOoxml paragraphs', () => {
  it('writes a bold run inside a paragraph', () => {
    const out = xml([para('Bold', { bold: true })]);
    expect(out).toEqual('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bold</w:t></w:r></w:p>');
  });

  it('writes a link as a HYPERLINK field without a relationship', () => {
    const out = xml([{ type: 'para', runs: [{ text: 'Jira', link: 'https://x.test/a?b=1&c=2' }] }]);
    expect([
      all(/w:fldCharType="(\w+)"/g, out),
      all(/<w:instrText xml:space="preserve">([^<]*)<\/w:instrText>/g, out),
      out.includes('r:id='),
    ]).toEqual([['begin', 'separate', 'end'], [' HYPERLINK "https://x.test/a?b=1&amp;c=2" '], false]);
  });

  it('colours and underlines link text', () => {
    const out = xml([{ type: 'para', runs: [{ text: 'Jira', link: 'https://x.test' }] }]);
    expect(out.includes(`<w:rPr><w:color w:val="${PALETTE.link}"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">Jira</w:t>`)).toBe(true);
  });

  it('keeps a quote inside a link target from ending the field argument', () => {
    const out = xml([{ type: 'para', runs: [{ text: 'q', link: 'https://x.test/"a"' }] }]);
    expect(all(/<w:instrText xml:space="preserve">([^<]*)</g, out)).toEqual([' HYPERLINK "https://x.test/%22a%22" ']);
  });

  it('writes italic, strike, underline, colour and superscript in schema order', () => {
    const out = xml([para('x', { italic: true, strike: true, underline: true, color: '#FF0000', sup: true })]);
    expect(all(/<w:rPr>(.*?)<\/w:rPr>/g, out)).toEqual(['<w:i/><w:strike/><w:color w:val="FF0000"/><w:u w:val="single"/><w:vertAlign w:val="superscript"/>']);
  });

  it('ignores a colour that is not a hex value', () => {
    expect(xml([para('x', { color: 'red"/><evil' })])).toEqual('<w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p>');
  });

  it('turns a newline inside a run into a line break', () => {
    expect(xml([para('a\nb')])).toEqual('<w:p><w:r><w:t xml:space="preserve">a</w:t><w:br/><w:t xml:space="preserve">b</w:t></w:r></w:p>');
  });

  it('escapes text', () => {
    expect(xml([para('a < b & c')])).toEqual('<w:p><w:r><w:t xml:space="preserve">a &lt; b &amp; c</w:t></w:r></w:p>');
  });

  it('writes inline code in Consolas on the code fill', () => {
    const out = xml([para('x', { code: true })]);
    expect(all(/<w:rPr>(.*?)<\/w:rPr>/g, out)).toEqual([`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="${PALETTE.codeFill}"/>`]);
  });

  it('returns an empty paragraph for no blocks', () => {
    expect(xml([])).toEqual('<w:p/>');
  });
});

describe('blocksToOoxml headings', () => {
  it('sizes heading runs by level', () => {
    const sizes = [1, 2, 3, 4, 5, 6].map((level) => all(/<w:sz w:val="(\d+)"\/>/g, xml([{ type: 'heading', level, runs: [{ text: 'H' }] }]))[0]);
    expect(sizes).toEqual(['32', '28', '26', '24', '22', '22']);
  });

  it('writes a level-one heading as a bold 16-point run kept with the next paragraph', () => {
    expect(xml([{ type: 'heading', level: 1, runs: [{ text: 'Title' }] }]))
      .toEqual('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">Title</w:t></w:r></w:p>');
  });
});

describe('blocksToOoxml lists', () => {
  const nested = {
    type: 'list', ordered: false, start: 1, items: [
      { blocks: [para('one'), { type: 'list', ordered: true, start: 1, items: [{ blocks: [para('inner a')] }, { blocks: [para('inner b')] }] }] },
      { blocks: [para('two')] },
    ],
  };

  it('prefixes items with a bullet or a number and indents by depth', () => {
    const out = xml([nested]);
    const paragraphs = all(/<w:p>(.*?)<\/w:p>/g, out).map((p) => [all(/<w:ind w:left="(\d+)"\/>/g, p)[0], all(/<w:t xml:space="preserve">([^<]*)</g, p).join('')]);
    expect(paragraphs).toEqual([['360', '• one'], ['720', '1. inner a'], ['720', '2. inner b'], ['360', '• two']]);
  });

  it('numbers an ordered list from its start', () => {
    const out = xml([{ type: 'list', ordered: true, start: 4, items: [{ blocks: [para('a')] }, { blocks: [para('b')] }] }]);
    expect(all(/<w:t xml:space="preserve">([^<]*)</g, out)).toEqual(['4. ', 'a', '5. ', 'b']);
  });

  it('indents the later blocks of an item under its text', () => {
    const out = xml([{ type: 'list', ordered: false, start: 1, items: [{ blocks: [para('lead'), para('more')] }] }]);
    expect(all(/<w:ind w:left="(\d+)"\/>/g, out)).toEqual(['360', '360']);
  });
});

describe('blocksToOoxml tables', () => {
  const merged = {
    type: 'table', header: true, rows: [
      { cells: [cell([para('Wide')], { header: true, colspan: 2 }), cell([para('Tall')], { header: true, rowspan: 2 })] },
      { cells: [cell([para('a')]), cell([])] },
    ],
  };

  it('writes a full-width table with single borders in the rule colour and a grid', () => {
    const out = xml([merged]);
    expect([
      out.startsWith('<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'),
      all(/<w:(top|left|bottom|right|insideH|insideV) w:val="single" w:sz="4" w:space="0" w:color="([0-9A-F]{6})"\/>/g, out),
      all(/<w:gridCol w:w="(\d+)"\/>/g, out),
    ]).toEqual([true, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'], ['3000', '3000', '3000']]);
  });

  it('uses the rule colour for every border', () => {
    expect(all(/w:val="single" w:sz="4" w:space="0" w:color="(\w+)"/g, xml([merged]))).toEqual(Array(6).fill(PALETTE.rule));
  });

  it('merges cells across columns and rows', () => {
    const out = xml([merged]);
    expect([
      all(/<w:gridSpan w:val="(\d)"\/>/g, out),
      all(/<w:vMerge( w:val="restart")?\/>/g, out).map((v) => v ?? ''),
    ]).toEqual([['2'], [' w:val="restart"', '']]);
  });

  it('puts a paragraph into every cell', () => {
    expect(cells(xml([merged])).map((c) => c.includes('<w:p'))).toEqual([true, true, true, true, true]);
  });

  it('marks the header row to repeat and shades header cells', () => {
    const out = xml([merged]);
    expect([
      all(/<w:tr>(<w:trPr><w:tblHeader\/><\/w:trPr>)?/g, out).map(Boolean),
      all(/<w:shd w:val="clear" w:color="auto" w:fill="(\w+)"\/>/g, out),
    ]).toEqual([[true, false], [PALETTE.headerFill, PALETTE.headerFill]]);
  });

  it('skips a table without rows', () => {
    expect(xml([{ type: 'table', header: false, rows: [] }, para('after')])).toEqual('<w:p><w:r><w:t xml:space="preserve">after</w:t></w:r></w:p>');
  });

  it('ends a cell whose content ends in a table with a paragraph', () => {
    const inner = { type: 'table', header: false, rows: [{ cells: [cell([para('x')])] }] };
    const out = xml([{ type: 'table', header: false, rows: [{ cells: [cell([inner])] }] }]);
    expect(out.endsWith('</w:tbl><w:p/></w:tc></w:tr></w:tbl><w:p/>')).toBe(true);
  });

  it('follows a trailing table with a paragraph', () => {
    const out = xml([{ type: 'table', header: false, rows: [{ cells: [cell([para('x')])] }] }]);
    expect(out.endsWith('</w:tbl><w:p/>')).toBe(true);
  });
});

describe('blocksToOoxml code, quotes, panels and rules', () => {
  it('writes each code line as a shaded paragraph of Consolas runs', () => {
    const out = xml([{ type: 'code', language: 'js', text: 'a\nb' }]);
    expect(out).toEqual([
      `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="${PALETTE.codeFill}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">a</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="${PALETTE.codeFill}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">b</w:t></w:r></w:p>`,
    ].join(''));
  });

  it('indents a quote and draws a left border', () => {
    expect(xml([{ type: 'quote', blocks: [para('q')] }]))
      .toEqual(`<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="${PALETTE.rule}"/></w:pBdr><w:ind w:left="567"/></w:pPr><w:r><w:t xml:space="preserve">q</w:t></w:r></w:p>`);
  });

  it('fills a panel with the colour of its kind', () => {
    const out = xml([{ type: 'panel', kind: 'warning', blocks: [para('careful')] }]);
    expect(all(/w:fill="(\w+)"/g, out)).toEqual([PALETTE.panel.warning]);
  });

  it('draws a rule as a bottom border', () => {
    expect(xml([{ type: 'rule' }, para('x')]).startsWith(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${PALETTE.rule}"/></w:pBdr></w:pPr></w:p>`)).toBe(true);
  });

  it('writes a page break', () => {
    expect(xml([{ type: 'pageBreak' }])).toEqual('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
});

describe('blocksToOoxml images', () => {
  const ref = { rId: 'rIdArtup1', cx: 1905000, cy: 952500, n: 1 };
  const image = { type: 'image', attachmentId: 'att-1', alt: 'diagram "a"', width: null, height: null };

  it('embeds a referenced image as an inline drawing with its size in EMU', () => {
    const out = xml([image], { image: () => ref });
    expect([
      all(/r:embed="([^"]+)"/g, out),
      all(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g, out).length,
      /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(out).slice(1),
      out.includes('descr="diagram &quot;a&quot;"'),
    ]).toEqual([['rIdArtup1'], 1, ['1905000', '952500'], true]);
  });

  it('writes an italic placeholder for an image without a reference', () => {
    expect(xml([image]))
      .toEqual('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">[Image unavailable: diagram &quot;a&quot;]</w:t></w:r></w:p>');
  });

  it('offers an image the full content width at the top level', () => {
    const asked = [];
    xml([image], { image: (id, room) => { asked.push([id, room]); return ref; } });
    expect(asked).toEqual([['att-1', 600]]);
  });

  it('offers an image in one of two columns half the content width', () => {
    const asked = [];
    xml([{ type: 'table', header: false, rows: [{ cells: [cell([image]), cell([para('x')])] }] }], { image: (id, room) => { asked.push(room); return ref; } });
    expect(asked).toEqual([300]);
  });

  it('offers an image in a list item the width left beside the indent', () => {
    const asked = [];
    xml([{ type: 'list', ordered: false, start: 1, items: [{ blocks: [para('lead'), image] }] }], { image: (id, room) => { asked.push(room); return ref; } });
    expect(asked).toEqual([576]);
  });

  it('gives every drawing of one call its own id', () => {
    const out = xml([image, image], { image: () => ref });
    const ids = all(/<wp:docPr id="(\d+)"/g, out);
    expect(new Set(ids).size).toEqual(2);
  });
});
