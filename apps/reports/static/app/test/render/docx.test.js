// @vitest-environment node
import * as docx from 'docx';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { buildLayout } from '../../src/core/layouts.js';
import { prepareIssue } from '../../src/core/prepare.js';
import { PALETTE } from '../../src/render/palette.js';
import { MARGIN, PAPER, buildDocxDocument, packDocx, renderDocx } from '../../src/render/docx.js';
import { pngBytes } from '../fixtures/images.js';
import { SITE, catalog, formats, makeIssue } from '../fixtures/issues.js';

const labels = { imageUnavailable: 'Image unavailable' };
const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 2 };
const para = (text, style = {}) => ({ type: 'para', runs: [{ text, ...style }] });
const cell = (blocks, extra = {}) => ({ header: false, colspan: 1, rowspan: 1, blocks, ...extra });
const spec = (blocks, extra = {}) => ({ paper: 'A4', title: 'My report', metaLines: ['JQL: project = RPT', 'Exported: today · Ann', 'Issues: 2'], blocks, ...extra });

async function render(blocks, { images = new Map(), ...extra } = {}) {
  const bytes = await renderDocx({ spec: spec(blocks, extra), images, labels, meta, docx });
  const zip = new PizZip(bytes);
  const part = (name) => zip.file(name)?.asText() ?? '';
  const names = Object.keys(zip.files);
  const rels = part('word/_rels/document.xml.rels');
  const target = (id) => new RegExp(`Id="${id}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${id}"`).exec(rels)?.slice(1).find(Boolean);
  const reference = (kind, type) => {
    const match = new RegExp(`<w:${kind}Reference w:type="${type}" r:id="([^"]+)"`).exec(part('word/document.xml'));
    return part(`word/${target(match[1])}`);
  };
  return { doc: part('word/document.xml'), part, names, rels, target, reference };
}

const body = (xml) => xml.slice(xml.indexOf('<w:body>'), xml.indexOf('<w:sectPr'));
const all = (re, xml) => [...xml.matchAll(re)].map((m) => m[1]);
const numIds = (xml) => all(/<w:numId w:val="(\d+)"\/>/g, body(xml));

describe('renderDocx page setup', () => {
  it('uses the A4 page size', async () => {
    const { doc } = await render([para('a')]);
    expect(/<w:pgSz [^>]*\/>/.exec(doc)[0].match(/w:w="\d+" w:h="\d+"/)[0]).toEqual('w:w="11906" w:h="16838"');
  });

  it('uses the Letter page size', async () => {
    const { doc } = await render([para('a')], { paper: 'LETTER' });
    expect(/<w:pgSz [^>]*\/>/.exec(doc)[0].match(/w:w="\d+" w:h="\d+"/)[0]).toEqual('w:w="12240" w:h="15840"');
  });

  it('gives the first page its own header and footer', async () => {
    const { doc } = await render([para('a')]);
    expect(doc.includes('<w:titlePg/>')).toBe(true);
  });

  it('puts every meta line in the first-page header', async () => {
    const { reference } = await render([para('a')]);
    const header = reference('header', 'first');
    expect(spec([]).metaLines.filter((line) => !header.includes(line))).toEqual([]);
  });

  it('puts the title in the default header', async () => {
    const { reference } = await render([para('a')]);
    expect(reference('header', 'default').includes('My report')).toBe(true);
  });

  it('puts page and total-pages fields in the footers', async () => {
    const { reference } = await render([para('a')]);
    const fields = (xml) => ['PAGE', 'NUMPAGES'].filter((f) => new RegExp(`<w:instrText[^>]*>\\s*${f}\\s*<`).test(xml));
    expect([fields(reference('footer', 'default')), fields(reference('footer', 'first'))]).toEqual([['PAGE', 'NUMPAGES'], ['PAGE', 'NUMPAGES']]);
  });

  it('writes a paragraph into the first-page header when there are no meta lines', async () => {
    const { reference } = await render([para('a')], { metaLines: [] });
    expect(/<w:p[ />]/.test(reference('header', 'first'))).toBe(true);
  });

  it('writes the creator and a description with the JQL into the core properties', async () => {
    const { part } = await render([para('a')]);
    const core = part('docProps/core.xml');
    expect([/<dc:creator>([^<]*)</.exec(core)[1], /<dc:description>([^<]*)</.exec(core)[1]]).toEqual(['Ann', 'JQL: project = RPT']);
  });

  it('packs to zip bytes in Node', async () => {
    const document = buildDocxDocument({ spec: spec([para('a')]), images: new Map(), labels, meta, docx });
    const bytes = await packDocx(document, docx);
    expect([bytes instanceof Uint8Array, bytes[0], bytes[1]]).toEqual([true, 0x50, 0x4b]);
  });
});

describe('renderDocx text', () => {
  it('styles headings by level', async () => {
    const { doc } = await render([{ type: 'heading', level: 1, runs: [{ text: 'One' }] }, { type: 'heading', level: 2, runs: [{ text: 'Two' }] }]);
    expect(all(/<w:pStyle w:val="([^"]+)"\/>/g, body(doc))).toEqual(['Heading1', 'Heading2']);
  });

  it('maps bold, italic, strike, underline and code runs', async () => {
    const { doc } = await render([{ type: 'para', runs: [
      { text: 'b', bold: true }, { text: 'i', italic: true }, { text: 's', strike: true }, { text: 'u', underline: true }, { text: 'c', code: true },
    ] }]);
    expect(['<w:b/>', '<w:i/>', '<w:strike/>', '<w:u ', 'Consolas'].filter((tag) => !doc.includes(tag))).toEqual([]);
  });

  it('writes a valid run colour without the hash and drops an invalid one', async () => {
    const { doc } = await render([{ type: 'para', runs: [{ text: 'red', color: '#ff0000' }, { text: 'bad', color: 'red' }] }]);
    expect(all(/<w:color w:val="([^"]+)"\/>/g, body(doc))).toEqual(['ff0000']);
  });

  it('turns a newline inside a run into a line break', async () => {
    const { doc } = await render([para('one\ntwo')]);
    expect([all(/<w:t[^>]*>([^<]*)</g, body(doc)), (body(doc).match(/<w:br\/>/g) ?? []).length]).toEqual([['one', 'two'], 1]);
  });

  it('writes a link run as an external hyperlink to the URL', async () => {
    const { doc, target } = await render([{ type: 'para', runs: [{ text: 'RPT-1', link: `${SITE}/browse/RPT-1`, bold: true }] }]);
    const id = /<w:hyperlink [^>]*r:id="([^"]+)"/.exec(doc)[1];
    expect(target(id)).toEqual(`${SITE}/browse/RPT-1`);
  });
});

describe('renderDocx lists', () => {
  const bullets = {
    type: 'list', ordered: false, start: 1,
    items: [{ blocks: [para('outer'), { type: 'list', ordered: false, start: 1, items: [{ blocks: [para('inner')] }] }] }],
  };
  const ordered = (text) => ({ type: 'list', ordered: true, start: 1, items: [{ blocks: [para(text)] }] });

  it('numbers bullet items with a bullet numbering and nests at the next level', async () => {
    const { doc, part } = await render([bullets]);
    const numbering = part('word/numbering.xml');
    const [numId] = numIds(doc);
    const abstractId = new RegExp(`<w:num w:numId="${numId}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"`).exec(numbering)[1];
    const abstract = new RegExp(`<w:abstractNum [^>]*w:abstractNumId="${abstractId}"[^>]*>[\\s\\S]*?</w:abstractNum>`).exec(numbering)[0];
    expect([abstract.includes('<w:numFmt w:val="bullet"/>'), all(/<w:ilvl w:val="(\d)"\/>/g, body(doc))]).toEqual([true, ['0', '1']]);
  });

  it('restarts numbering for each ordered list', async () => {
    const { doc } = await render([ordered('a'), para('between'), ordered('b')]);
    const [first, second] = numIds(doc);
    expect([numIds(doc).length, first !== second]).toEqual([2, true]);
  });

  it('starts an ordered list at its start number', async () => {
    const { doc, part } = await render([{ type: 'list', ordered: true, start: 3, items: [{ blocks: [para('third')] }] }]);
    const [numId] = numIds(doc);
    const num = new RegExp(`<w:num w:numId="${numId}"[^>]*>[\\s\\S]*?</w:num>`).exec(part('word/numbering.xml'))[0];
    expect(/<w:startOverride w:val="(\d+)"\/>/.exec(num)[1]).toEqual('3');
  });

  it('restarts nested ordered sub-lists and keeps each start at its own level', async () => {
    const sub = (start, ...texts) => ({ type: 'list', ordered: true, start, items: texts.map((t) => ({ blocks: [para(t)] })) });
    const { doc, part } = await render([{ type: 'list', ordered: false, start: 1, items: [
      { blocks: [para('one'), sub(1, 'a', 'b')] },
      { blocks: [para('two'), sub(5, 'c')] },
    ] }]);
    const numbering = part('word/numbering.xml');
    const nested = all(/<w:p>([\s\S]*?)<\/w:p>/g, body(doc))
      .filter((p) => p.includes('<w:ilvl w:val="1"/>'))
      .map((p) => /<w:numId w:val="(\d+)"\/>/.exec(p)[1]);
    const abstractOf = (numId) => new RegExp(`<w:num w:numId="${numId}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"`).exec(numbering)[1];
    const startAt = (numId, ilvl) => {
      const num = new RegExp(`<w:num w:numId="${numId}"[^>]*>[\\s\\S]*?</w:num>`).exec(numbering)[0];
      const override = new RegExp(`<w:lvlOverride w:ilvl="${ilvl}">\\s*<w:startOverride w:val="(\\d+)"`).exec(num);
      if (override) return override[1];
      const abstract = new RegExp(`<w:abstractNum [^>]*w:abstractNumId="${abstractOf(numId)}"[^>]*>[\\s\\S]*?</w:abstractNum>`).exec(numbering)[0];
      return new RegExp(`<w:lvl w:ilvl="${ilvl}"[^>]*>\\s*<w:start w:val="(\\d+)"`).exec(abstract)[1];
    };
    const [first, , third] = nested;
    expect({
      sameListShares: nested[0] === nested[1],
      distinctAbstracts: abstractOf(first) !== abstractOf(third),
      starts: [startAt(first, 1), startAt(third, 1)],
    }).toEqual({ sameListShares: true, distinctAbstracts: true, starts: ['1', '5'] });
  });

  it('indents an item continuation inside a quote by the quote and the list indent', async () => {
    const { doc } = await render([{ type: 'quote', blocks: [{ type: 'list', ordered: false, start: 1, items: [{ blocks: [para('lead'), para('more')] }] }] }]);
    const more = all(/<w:p>([\s\S]*?)<\/w:p>/g, body(doc)).find((p) => p.includes('more'));
    expect(/<w:ind w:left="(\d+)"\/>/.exec(more)[1]).toEqual(String(567 + 720));
  });

  it('renders the other blocks of an item after its numbered paragraph', async () => {
    const { doc } = await render([{ type: 'list', ordered: false, start: 1, items: [{ blocks: [para('first'), para('second')] }] }]);
    expect([all(/<w:t[^>]*>([^<]*)</g, body(doc)), numIds(doc).length]).toEqual([['first', 'second'], 1]);
  });
});

describe('renderDocx tables', () => {
  const grid = (rows, header = false) => ({ type: 'table', header, rows: rows.map((cells) => ({ cells })) });

  it('repeats the header row', async () => {
    const { doc } = await render([grid([[cell([para('H')], { header: true })], [cell([para('v')])]], true)]);
    const rows = all(/<w:tr>([\s\S]*?)<\/w:tr>/g, doc);
    expect(rows.map((r) => r.includes('<w:tblHeader/>'))).toEqual([true, false]);
  });

  it('shades header cells with the header fill', async () => {
    const { doc } = await render([grid([[cell([para('H')], { header: true })], [cell([para('v')])]], true)]);
    expect(all(/<w:shd [^>]*w:fill="([^"]+)"/g, doc)).toEqual([PALETTE.headerFill]);
  });

  it('spans a colspan-2 cell over two grid columns', async () => {
    const { doc } = await render([grid([[cell([para('wide')], { colspan: 2 })], [cell([para('a')]), cell([para('b')])]])]);
    expect(all(/<w:gridSpan w:val="(\d+)"\/>/g, doc)).toEqual(['2']);
  });

  it('merges a rowspan-2 cell with exactly one continuation in the next row', async () => {
    const { doc } = await render([grid([[cell([para('tall')], { rowspan: 2 }), cell([para('a')])], [cell([para('b')])]])]);
    const rows = all(/<w:tr>([\s\S]*?)<\/w:tr>/g, doc);
    const merges = (row) => [...row.matchAll(/<w:vMerge(?: w:val="(\w+)")?\/>/g)].map((m) => m[1] ?? 'continue');
    expect(rows.map(merges)).toEqual([['restart'], ['continue']]);
  });

  it('continues a rowspan-3 cell in its own column on both following rows', async () => {
    const { doc } = await render([grid([
      [cell([para('a')]), cell([para('tall')], { rowspan: 3 })],
      [cell([para('b')])],
      [cell([para('c')])],
    ])]);
    const rows = all(/<w:tr>([\s\S]*?)<\/w:tr>/g, doc);
    const second = (row) => /<w:vMerge(?: w:val="(\w+)")?\/>/.exec(all(/<w:tc>([\s\S]*?)<\/w:tc>/g, row)[1])?.[1] ?? 'continue';
    expect(rows.map(second)).toEqual(['restart', 'continue', 'continue']);
  });

  it('skips a table without rows', async () => {
    const { doc } = await render([para('before'), grid([]), para('after')]);
    expect(doc.includes('<w:tbl>')).toBe(false);
  });

  it('ends a cell holding only a table with a paragraph', async () => {
    const inner = grid([[cell([para('inner')])]]);
    const { doc } = await render([grid([[cell([inner])]])]);
    expect([doc.includes('</w:tbl></w:tc>'), (doc.match(/<w:tbl>/g) ?? []).length]).toEqual([false, 2]);
  });

  it('renders a list inside a table cell', async () => {
    const list = { type: 'list', ordered: false, start: 1, items: [{ blocks: [para('in cell')] }] };
    const { doc } = await render([grid([[cell([list])]])]);
    const tc = /<w:tc>([\s\S]*?)<\/w:tc>/.exec(doc)[1];
    expect([tc.includes('<w:numPr>'), tc.includes('in cell')]).toEqual([true, true]);
  });
});

describe('renderDocx blocks', () => {
  it('renders a warning panel as a one-cell table with the warning fill', async () => {
    const { doc } = await render([{ type: 'panel', kind: 'warning', blocks: [para('careful')] }]);
    expect([(doc.match(/<w:tc>/g) ?? []).length, all(/<w:shd [^>]*w:fill="([^"]+)"/g, doc)]).toEqual([1, [PALETTE.panel.warning]]);
  });

  it('falls back to the info fill for an unknown panel kind', async () => {
    const { doc } = await render([{ type: 'panel', kind: 'custom', blocks: [para('x')] }]);
    expect(all(/<w:shd [^>]*w:fill="([^"]+)"/g, doc)).toEqual([PALETTE.panel.info]);
  });

  it('renders a table inside a panel', async () => {
    const inner = { type: 'table', header: false, rows: [{ cells: [cell([para('nested')])] }] };
    const { doc } = await render([{ type: 'panel', kind: 'info', blocks: [inner] }]);
    expect([(doc.match(/<w:tbl>/g) ?? []).length, doc.includes('nested')]).toEqual([2, true]);
  });

  it('renders a code block as shaded Consolas paragraphs, one per line', async () => {
    const { doc } = await render([{ type: 'code', language: 'js', text: 'a();\nb();' }]);
    const paragraphs = all(/<w:p>([\s\S]*?)<\/w:p>/g, body(doc));
    expect(paragraphs.map((p) => [p.includes(`w:fill="${PALETTE.codeFill}"`), p.includes('Consolas')])).toEqual([[true, true], [true, true]]);
  });

  it('renders a quote as indented paragraphs with a left border', async () => {
    const { doc } = await render([{ type: 'quote', blocks: [para('quoted')] }]);
    const p = /<w:p>([\s\S]*?)<\/w:p>/.exec(body(doc))[1];
    expect([/<w:ind w:left="567"\/>/.test(p), /<w:left [^>]*w:val="single"/.test(p)]).toEqual([true, true]);
  });

  it('renders a rule as a paragraph bottom border', async () => {
    const { doc } = await render([{ type: 'rule' }]);
    expect(/<w:pBdr><w:bottom [^>]*w:color="([^"]+)"/.exec(doc)[1]).toEqual(PALETTE.rule);
  });

  it('renders a page break', async () => {
    const { doc } = await render([para('a'), { type: 'pageBreak' }, para('b')]);
    expect(doc.includes('<w:br w:type="page"/>')).toBe(true);
  });
});

describe('renderDocx images', () => {
  const contentEmu = ((11906 - 2 * 1134) / 15) * 9525;

  it('embeds an image as PNG media no wider than the content width', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const { doc, names } = await render([{ type: 'image', attachmentId: 'att-1', alt: 'diagram', width: null, height: null }], { images });
    const cx = Number(/<wp:extent cx="(\d+)"/.exec(doc)[1]);
    expect([names.some((n) => /^word\/media\/.+\.png$/.test(n)), /<a:blip r:embed=/.test(doc), cx <= contentEmu]).toEqual([true, true, true]);
  });

  it('keeps a small image at its own size', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(320, 200), type: 'png', width: 320, height: 200 }]]);
    const { doc } = await render([{ type: 'image', attachmentId: 'att-1', alt: '', width: null, height: null }], { images });
    expect(/<wp:extent cx="(\d+)" cy="(\d+)"/.exec(doc).slice(1)).toEqual([String(320 * 9525), String(200 * 9525)]);
  });

  it('fits an image in a two-column table to half the content width', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const image = { type: 'image', attachmentId: 'att-1', alt: '', width: null, height: null };
    const { doc } = await render([{ type: 'table', header: false, rows: [{ cells: [cell([image]), cell([para('x')])] }] }], { images });
    expect(Number(/<wp:extent cx="(\d+)"/.exec(doc)[1]) <= contentEmu / 2).toBe(true);
  });

  it('narrows an image in a list item by the list indent', async () => {
    const images = new Map([['att-1', { bytes: pngBytes(1400, 700), type: 'png', width: 1400, height: 700 }]]);
    const image = { type: 'image', attachmentId: 'att-1', alt: '', width: null, height: null };
    const { doc } = await render([{ type: 'list', ordered: false, start: 1, items: [{ blocks: [para('lead'), image] }] }], { images });
    expect(Number(/<wp:extent cx="(\d+)"/.exec(doc)[1]) <= contentEmu - (720 / 15) * 9525).toBe(true);
  });

  it('writes an italic placeholder for an image without bytes', async () => {
    const { doc } = await render([{ type: 'image', attachmentId: 'missing', alt: 'diagram', width: null, height: null }]);
    const run = /<w:r>([\s\S]*?)<\/w:r>/.exec(body(doc))[1];
    expect([run.includes('<w:i/>'), /<w:t[^>]*>([^<]*)</.exec(run)[1]]).toEqual([true, '[Image unavailable: diagram]']);
  });

  it('checks the page constants', () => {
    expect([PAPER, MARGIN]).toEqual([{ A4: { width: 11906, height: 16838 }, LETTER: { width: 12240, height: 15840 } }, 1134]);
  });
});

describe('renderDocx volume', () => {
  it('packs a 500-issue single layout with one image per issue in under 10 s', async () => {
    const base = prepareIssue(makeIssue(), { catalog, siteUrl: SITE, formats });
    const issues = Array.from({ length: 500 }, (_, i) => ({ ...base, key: `RPT-${i + 1}`, gallery: [`img-${i}`] }));
    const images = new Map(issues.map((_, i) => [`img-${i}`, { bytes: pngBytes(320, 200, i), type: 'png', width: 320, height: 200 }]));
    const layoutLabels = new Proxy({ partialBanner: () => '' }, { get: (t, k) => t[k] ?? String(k) });
    const layout = buildLayout({ layout: 'single', issues, meta: { ...meta, count: 500 }, labels: layoutLabels, paper: 'A4' });
    const started = performance.now();
    await renderDocx({ spec: layout, images, labels, meta, docx });
    const elapsed = performance.now() - started;
    expect(elapsed < 10000).toBe(true);
  }, 30000);
});
