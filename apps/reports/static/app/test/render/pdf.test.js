// @vitest-environment node
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { loadFonts } from '../../src/infra/fonts.js';
import { PALETTE } from '../../src/render/palette.js';
import { FAMILY, buildPdfDefinition, renderPdf } from '../../src/render/pdf.js';
import { createNodePdfEngine } from '../fixtures/nodePdfEngine.js';
import { pngBytes } from '../fixtures/images.js';

const labels = { imageUnavailable: 'Image unavailable' };
const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 2 };
const para = (text, style = {}) => ({ type: 'para', runs: [{ text, ...style }] });
const cell = (blocks, extra = {}) => ({ header: false, colspan: 1, rowspan: 1, blocks, ...extra });
const spec = (blocks, extra = {}) => ({ paper: 'A4', title: 'My report', metaLines: ['JQL: project = RPT', 'Exported: today · Ann', 'Issues: 2'], blocks, ...extra });
const build = (blocks, { images = new Map(), ...extra } = {}) => buildPdfDefinition({ spec: spec(blocks, extra), images, labels, meta });
const content = (blocks, options) => build(blocks, options).definition.content;
const A4_CONTENT = 595.28 - 114;
const COLUMN = (count) => (A4_CONTENT - (count + 1) - 8 * count) / count;

const textOf = (node) => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && node.text !== undefined) return textOf(node.text);
  if (node && node.stack) return node.stack.map(textOf).join('\n');
  return '';
};

async function pdfText(bytes) {
  const doc = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    pages.push((await page.getTextContent()).items.map((item) => item.str).join(''));
  }
  return pages.join('\n');
}

describe('buildPdfDefinition page setup', () => {
  it('uses the A4 page size', () => {
    expect(build([para('a')]).definition.pageSize).toEqual('A4');
  });

  it('uses the Letter page size', () => {
    expect(build([para('a')], { paper: 'LETTER' }).definition.pageSize).toEqual('LETTER');
  });

  it('uses 2 cm margins on every side', () => {
    expect(build([para('a')]).definition.pageMargins).toEqual([57, 57, 57, 57]);
  });

  it('writes in the Latin family by default', () => {
    expect(build([para('a')]).definition.defaultStyle.font).toEqual('Sans');
  });

  it('names one font family per script', () => {
    expect(FAMILY).toEqual({ latin: 'Sans', cjk: 'CJK', korean: 'KR' });
  });

  it('puts the meta lines in the first-page header', () => {
    expect(build([para('a')]).definition.header(1).stack.map(textOf)).toEqual(spec([]).metaLines);
  });

  it('puts the title in the header of later pages', () => {
    expect(textOf(build([para('a')]).definition.header(2))).toEqual('My report');
  });

  it('numbers pages in the footer as page / total', () => {
    expect(build([para('a')]).definition.footer(3, 7).text).toEqual('3 / 7');
  });

  it('defines bold heading styles h1 to h6 with falling sizes', () => {
    const { styles } = build([para('a')]).definition;
    expect(Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, [style.fontSize, style.bold]]))).toEqual({
      h1: [18, true], h2: [15, true], h3: [13, true], h4: [12, true], h5: [11, true], h6: [10, true],
    });
  });
});

describe('buildPdfDefinition text runs', () => {
  it('splits a mixed paragraph into Sans, CJK and KR runs and drops the emoji', () => {
    expect(content([para('Report 報告 한국 👍')])).toEqual([{
      text: [{ text: 'Report ', font: 'Sans' }, { text: '報告 ', font: 'CJK' }, { text: '한국 ', font: 'KR' }],
      margin: [0, 2, 0, 2],
    }]);
  });

  it('counts dropped emoji runs', () => {
    expect(build([para('Report 報告 한국 👍')]).emojiDropped).toEqual(1);
  });

  it('reports every script that needs a font', () => {
    expect([...build([para('Report 報告 한국 👍')]).scripts].sort()).toEqual(['cjk', 'korean', 'latin']);
  });

  it('needs only the Latin font for Latin and Cyrillic text', () => {
    expect([...build([para('Report отчёт')]).scripts]).toEqual(['latin']);
  });

  it('maps bold, italic, strike and underline to pdfmake properties', () => {
    const runs = [
      { text: 'b', bold: true }, { text: 'i', italic: true }, { text: 's', strike: true }, { text: 'u', underline: true },
    ];
    expect(content([{ type: 'para', runs }])[0].text).toEqual([
      { text: 'b', font: 'Sans', bold: true },
      { text: 'i', font: 'Sans', italics: true },
      { text: 's', font: 'Sans', decoration: 'lineThrough' },
      { text: 'u', font: 'Sans', decoration: 'underline' },
    ]);
  });

  it('maps a link run to a coloured underlined link', () => {
    expect(content([para('site', { link: 'https://example.com' })])[0].text).toEqual([
      { text: 'site', font: 'Sans', link: 'https://example.com', color: `#${PALETTE.link}`, decoration: 'underline' },
    ]);
  });

  it('keeps a valid run colour and ignores an invalid one', () => {
    expect(content([{ type: 'para', runs: [{ text: 'a', color: '#FF0000' }, { text: 'b', color: 'red' }] }])[0].text).toEqual([
      { text: 'a', font: 'Sans', color: '#FF0000' },
      { text: 'b', font: 'Sans' },
    ]);
  });

  it('keeps line breaks inside the text', () => {
    expect(content([para('one\ntwo')])[0].text).toEqual([{ text: 'one\ntwo', font: 'Sans' }]);
  });
});

describe('buildPdfDefinition blocks', () => {
  it('maps a heading to its level style', () => {
    expect(content([{ type: 'heading', level: 2, runs: [{ text: 'Title' }] }])).toEqual([
      { text: [{ text: 'Title', font: 'Sans' }], style: 'h2' },
    ]);
  });

  it('maps bullet lists to ul with nested lists inside stacks', () => {
    const inner = { type: 'list', ordered: false, start: 1, items: [{ blocks: [para('inner')] }] };
    expect(content([{ type: 'list', ordered: false, start: 1, items: [{ blocks: [para('outer'), inner] }] }])).toEqual([{
      ul: [{ stack: [
        { text: [{ text: 'outer', font: 'Sans' }], margin: [0, 2, 0, 2] },
        { ul: [{ stack: [{ text: [{ text: 'inner', font: 'Sans' }], margin: [0, 2, 0, 2] }] }] },
      ] }],
    }]);
  });

  it('maps ordered lists to ol and keeps the start number', () => {
    expect(content([{ type: 'list', ordered: true, start: 3, items: [{ blocks: [para('third')] }] }])).toEqual([{
      ol: [{ stack: [{ text: [{ text: 'third', font: 'Sans' }], margin: [0, 2, 0, 2] }] }],
      start: 3,
    }]);
  });

  it('places merged table cells with colSpan and rowSpan and leaves covered slots empty', () => {
    const table = {
      type: 'table', header: true,
      rows: [
        { cells: [cell([para('H1')], { header: true }), cell([para('H2')], { header: true })] },
        { cells: [cell([para('wide')], { colspan: 2 })] },
        { cells: [cell([para('tall')], { rowspan: 2 }), cell([para('x')])] },
        { cells: [cell([para('y')])] },
      ],
    };
    const [node] = content([table]);
    const shape = node.table.body.map((row) => row.map((slot) => (slot.stack ? [textOf(slot), slot.colSpan ?? 1, slot.rowSpan ?? 1] : slot)));
    expect(shape).toEqual([
      [['H1', 1, 1], ['H2', 1, 1]],
      [['wide', 2, 1], {}],
      [['tall', 1, 2], ['x', 1, 1]],
      [{}, ['y', 1, 1]],
    ]);
  });

  it('repeats one header row and shades header cells', () => {
    const table = { type: 'table', header: true, rows: [{ cells: [cell([para('H')], { header: true })] }, { cells: [cell([para('v')])] }] };
    const [node] = content([table]);
    expect([node.table.headerRows, node.table.body[0][0].fillColor, node.table.body[1][0].fillColor]).toEqual([1, `#${PALETTE.headerFill}`, undefined]);
  });

  it('gives a table without a header no header rows', () => {
    const [node] = content([{ type: 'table', header: false, rows: [{ cells: [cell([para('v')])] }] }]);
    expect(node.table.headerRows).toEqual(0);
  });

  it('pads ragged tables so every body row has the same length and widths match', () => {
    const table = { type: 'table', header: false, rows: [{ cells: [cell([para('a')]), cell([para('b')]), cell([para('c')])] }, { cells: [cell([para('d')])] }] };
    const [node] = content([table]);
    expect([node.table.body.map((row) => row.length), node.table.widths]).toEqual([[3, 3], [COLUMN(3), COLUMN(3), COLUMN(3)]]);
  });

  it('gives every table column a fixed width so the table fits the page', () => {
    const table = { type: 'table', header: false, rows: [{ cells: [cell([para('a')]), cell([para('b')])] }] };
    const [node] = content([table]);
    const total = node.table.widths.reduce((sum, w) => sum + w, 0) + 8 * node.table.widths.length + node.table.widths.length + 1;
    expect(Math.abs(total - A4_CONTENT) < 0.001).toBe(true);
  });

  it('skips a table without rows', () => {
    expect(content([{ type: 'table', header: true, rows: [] }, para('after')])).toEqual([
      { text: [{ text: 'after', font: 'Sans' }], margin: [0, 2, 0, 2] },
    ]);
  });

  it('gives a code block one fixed column as wide as the content less its padding', () => {
    const [node] = content([{ type: 'code', text: 'let a = 1;' }]);
    expect(node.table.widths).toEqual([A4_CONTENT - 8]);
  });

  it('renders a code block as a shaded one-cell table in small type', () => {
    const [node] = content([{ type: 'code', text: 'let a = 1;' }]);
    const only = node.table.body[0][0];
    expect([node.table.body.length, node.table.body[0].length, only.fillColor, only.fontSize, textOf(only)]).toEqual([1, 1, `#${PALETTE.codeFill}`, 8, 'let a = 1;']);
  });

  it('indents a quote', () => {
    expect(content([{ type: 'quote', blocks: [para('q')] }])).toEqual([
      { stack: [{ text: [{ text: 'q', font: 'Sans' }], margin: [0, 2, 0, 2] }], margin: [16, 2, 0, 2] },
    ]);
  });

  it('fills a panel with the colour of its kind', () => {
    const [node] = content([{ type: 'panel', kind: 'warning', blocks: [para('careful')] }]);
    expect([node.table.body[0][0].fillColor, textOf(node.table.body[0][0])]).toEqual([`#${PALETTE.panel.warning}`, 'careful']);
  });

  it('draws a rule across the content width', () => {
    expect(content([{ type: 'rule' }])).toEqual([{
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: A4_CONTENT, y2: 0, lineWidth: 0.5, lineColor: `#${PALETTE.rule}` }],
    }]);
  });

  it('starts the node after a page break on a new page', () => {
    const nodes = content([para('a'), { type: 'pageBreak' }, para('b')]);
    expect(nodes.map((node) => [textOf(node), node.pageBreak])).toEqual([['a', undefined], ['b', 'before']]);
  });
});

describe('buildPdfDefinition images', () => {
  const image = { type: 'image', attachmentId: 'att-1', alt: 'diagram', width: null, height: null };

  it('embeds image bytes as a PNG data URL', () => {
    const images = new Map([['att-1', { bytes: pngBytes(320, 200), type: 'png', width: 320, height: 200 }]]);
    const [node] = content([image], { images });
    expect([node.image.slice(0, 22), node.width]).toEqual(['data:image/png;base64,', 240]);
  });

  it('keeps the base64 payload identical to the bytes', () => {
    const bytes = pngBytes(64, 40, 3);
    const [node] = content([image], { images: new Map([['att-1', { bytes, type: 'png', width: 64, height: 40 }]]) });
    expect(node.image).toEqual(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  });

  it('shrinks a wide image to the content width', () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const [node] = content([image], { images });
    expect(node.width <= A4_CONTENT && node.width > A4_CONTENT - 1).toBe(true);
  });

  it('shrinks an image inside a table cell to the cell width', () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const table = { type: 'table', header: false, rows: [{ cells: [cell([image]), cell([para('b')])] }] };
    const [node] = content([table], { images });
    expect(node.table.body[0][0].stack[0].width).toEqual(COLUMN(2));
  });

  it('writes the placeholder for a GIF, which a PDF cannot embed', () => {
    const images = new Map([['att-1', { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]), type: 'gif', width: 10, height: 10 }]]);
    expect(textOf(content([image], { images })[0])).toEqual('[Image unavailable: diagram]');
  });

  it('shrinks an image inside a panel by the panel padding', () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const [node] = content([{ type: 'panel', kind: 'info', blocks: [image] }], { images });
    expect(node.table.body[0][0].stack[0].width).toEqual(A4_CONTENT - 8);
  });

  it('replaces a truncated PNG with the placeholder and counts it', () => {
    const bytes = pngBytes(64, 40);
    const images = new Map([['att-1', { bytes: bytes.slice(0, bytes.length - 20), type: 'png', width: 64, height: 40 }]]);
    const built = build([image], { images });
    expect([textOf(built.definition.content[0]), built.imagesDropped]).toEqual(['[Image unavailable: diagram]', 1]);
  });

  it('builds every image as a placeholder when images are turned off', () => {
    const images = new Map([['att-1', { bytes: pngBytes(64, 40), type: 'png', width: 64, height: 40 }]]);
    const built = buildPdfDefinition({ spec: spec([image, image]), images, labels, meta, withImages: false });
    expect([built.definition.content.map(textOf), built.imagesDropped]).toEqual([['[Image unavailable: diagram]', '[Image unavailable: diagram]'], 2]);
  });

  it('does not count an image that never had bytes as dropped', () => {
    expect(build([image]).imagesDropped).toEqual(0);
  });

  it('writes an italic placeholder when the image has no bytes', () => {
    expect(content([image])).toEqual([{ text: [{ text: '[Image unavailable: diagram]', font: 'Sans' }], italics: true, margin: [0, 2, 0, 2] }]);
  });
});

describe('renderPdf', () => {
  const image = { type: 'image', attachmentId: 'att-1', alt: 'diagram' };
  const fonts = async () => ({ files: {}, families: {} });
  const hasImage = (definition) => JSON.stringify(definition.content).includes('data:image/');

  it('renders a valid PDF when an attachment is a truncated PNG', async () => {
    const bytes = pngBytes(64, 40);
    const images = new Map([['att-1', { bytes: bytes.slice(0, bytes.length - 20), type: 'png', width: 64, height: 40 }]]);
    const result = await renderPdf({ spec: spec([image, para('after')]), images, labels, meta, engine: createNodePdfEngine(), loadFonts });
    expect([new TextDecoder().decode(result.bytes.slice(0, 4)), result.imagesDropped]).toEqual(['%PDF', 1]);
  }, 60000);

  it('renders once more without images when the engine rejects an image', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(64, 40), type: 'png', width: 64, height: 40 }]]);
    const calls = [];
    const engine = { async render(definition) {
      calls.push(hasImage(definition));
      if (hasImage(definition)) throw new Error('Incomplete or corrupt PNG file');
      return new Uint8Array([1]);
    } };
    const result = await renderPdf({ spec: spec([image, image]), images, labels, meta, engine, loadFonts: fonts });
    expect({ calls, bytes: [...result.bytes], imagesDropped: result.imagesDropped }).toEqual({ calls: [true, false], bytes: [1], imagesDropped: 2 });
  });

  it('rethrows when the render without images fails too', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(64, 40), type: 'png', width: 64, height: 40 }]]);
    const engine = { async render() { throw new Error('engine down'); } };
    await expect(renderPdf({ spec: spec([image]), images, labels, meta, engine, loadFonts: fonts })).rejects.toThrow('engine down');
  });

  it('rethrows at once when the failed document had no images', async () => {
    let calls = 0;
    const engine = { async render() { calls += 1; throw new Error('engine down'); } };
    const outcome = await renderPdf({ spec: spec([para('a')]), images: new Map(), labels, meta, engine, loadFonts: fonts }).catch((error) => error.message);
    expect([outcome, calls]).toEqual(['engine down', 1]);
  });

  it('renders every block type across page breaks into one PDF', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const list = (ordered) => ({ type: 'list', ordered, start: 2, items: [{ blocks: [para('item'), { type: 'list', ordered: !ordered, start: 1, items: [{ blocks: [para('sub')] }] }] }, { blocks: [] }] });
    const blocks = [
      { type: 'heading', level: 1, runs: [{ text: 'Title' }] }, list(false), list(true), { type: 'pageBreak' },
      { type: 'table', header: true, rows: [
        { cells: [cell([para('H')], { header: true, colspan: 2 })] },
        { cells: [cell([{ type: 'image', attachmentId: 'att-1', alt: 'a' }], { rowspan: 2 }), cell([])] },
        { cells: [cell([list(false)])] },
      ] },
      { type: 'code', text: '  indented\nline' }, { type: 'quote', blocks: [para('quoted')] },
      { type: 'panel', kind: 'error', blocks: [para('bad')] }, { type: 'rule' }, { type: 'pageBreak' },
      { type: 'image', attachmentId: 'att-1', alt: 'a' }, para('👍'), { type: 'pageBreak' },
    ];
    const { bytes } = await renderPdf({ spec: spec(blocks), images, labels, meta, engine: createNodePdfEngine(), loadFonts });
    const doc = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    expect(doc.numPages).toEqual(3);
  }, 60000);

  it('renders real bytes whose text keeps Latin, Chinese, Korean and Cyrillic', async () => {
    const { bytes, emojiDropped } = await renderPdf({
      spec: spec([
        { type: 'heading', level: 1, runs: [{ text: 'Report 報告 한국 отчёт', bold: true }] },
        para('Report 報告 한국 отчёт 👍'),
        { type: 'table', header: true, rows: [{ cells: [cell([para('報告')], { header: true })] }, { cells: [cell([para('한국')])] }] },
      ]),
      images: new Map(),
      labels,
      meta,
      engine: createNodePdfEngine(),
      loadFonts,
    });
    const text = await pdfText(bytes);
    expect({
      head: new TextDecoder().decode(bytes.slice(0, 4)),
      emojiDropped,
      found: ['Report', '報告', '한국', 'отчёт'].filter((word) => text.includes(word)),
    }).toEqual({ head: '%PDF', emojiDropped: 1, found: ['Report', '報告', '한국', 'отчёт'] });
  }, 60000);
  it('keeps text with an unbreakable word inside the page margins in tables, code blocks and panels', async () => {
    const word = 'Unbreakable'.repeat(30);
    const { bytes } = await renderPdf({
      spec: spec([
        { type: 'table', header: true, rows: [{ cells: [cell([para('Key')], { header: true }), cell([para('Link')], { header: true })] }, { cells: [cell([para('RPT-1')]), cell([para(word)])] }] },
        { type: 'code', text: `const ${word} = 1;` },
        { type: 'panel', kind: 'info', blocks: [para(word)] },
      ]),
      images: new Map(),
      labels,
      meta,
      engine: createNodePdfEngine(),
      loadFonts,
    });
    const doc = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const edges = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const items = (await (await doc.getPage(n)).getTextContent()).items.filter((item) => item.str.trim());
      edges.push(...items.map((item) => item.transform[4] + item.width));
    }
    expect(Math.max(...edges) <= 595.28 - 57 + 0.5).toBe(true);
  }, 60000);
});
