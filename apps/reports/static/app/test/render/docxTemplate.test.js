// @vitest-environment node
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { prepareIssue } from '../../src/core/prepare.js';
import { createImageRegistry, parseTag, renderDocxTemplate } from '../../src/render/docxTemplate.js';
import { pngBytes } from '../fixtures/images.js';
import { SITE, catalog, formats, makeIssue } from '../fixtures/issues.js';
import { makeDocx, para } from '../fixtures/makeDocx.js';

const labels = { imageUnavailable: 'Image unavailable', partialBanner: (done, total) => `Incomplete export: ${done} of ${total} issues` };
const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 2, siteUrl: SITE };
const prepare = (overrides) => prepareIssue(makeIssue(overrides), { catalog, siteUrl: SITE, formats, fieldNames: ['Story Points'] });
const png = (w = 320, h = 200) => ({ bytes: pngBytes(w, h), type: 'png', width: w, height: h });
const DIAGRAM = '10500';

function render({ body, header, issues = [prepare()], images = new Map(), template = makeDocx({ body, header }), extraMeta = {} }) {
  const bytes = renderDocxTemplate({ template, issues, meta: { ...meta, ...extraMeta }, images, labels, PizZip, Docxtemplater });
  const zip = new PizZip(bytes);
  const part = (name) => zip.file(name)?.asText() ?? '';
  return { zip, part, doc: part('word/document.xml'), names: Object.keys(zip.files) };
}

const bodyOf = (xml) => xml.slice(xml.indexOf('<w:body>') + 8, xml.indexOf('<w:sectPr'));
const texts = (xml) => [...bodyOf(xml).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const row = (...cells) => `<w:tr>${cells.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`;
const table = (...rows) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>${rows.join('')}</w:tbl>`;

describe('renderDocxTemplate', () => {
  it('fills a placeholder that Word split across runs', () => {
    const { doc } = render({ body: '<w:p><w:r><w:t>{{sum</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>mary}}</w:t></w:r></w:p>' });
    expect(texts(doc).join('')).toEqual('Summary one');
  });

  it('repeats a table row per issue', () => {
    const issues = [prepare(), prepare({ key: 'RPT-2', fields: { summary: 'Summary two' } })];
    const { doc } = render({ body: table(row('{{#issues}}{{key}}', '{{summary}}{{/issues}}')), issues });
    expect([...doc.matchAll(/<w:tr>/g)].length).toEqual(2);
  });

  it('writes the key and summary of each issue into its row', () => {
    const issues = [prepare(), prepare({ key: 'RPT-2', fields: { summary: 'Summary two' } })];
    const { doc } = render({ body: table(row('{{#issues}}{{key}}', '{{summary}}{{/issues}}')), issues });
    expect(texts(doc)).toEqual(['RPT-1', 'Summary one', 'RPT-2', 'Summary two']);
  });

  it('renders a rich description as a table and an embedded image', () => {
    const { doc, names, part } = render({ body: para('{{@description}}'), images: new Map([[DIAGRAM, png()]]) });
    expect([
      doc.includes('<w:tbl>'),
      /r:embed="rIdArtup1"/.test(doc),
      names.includes('word/media/artup-1.png'),
      part('word/_rels/document.xml.rels').includes('<Relationship Id="rIdArtup1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/artup-1.png"/>'),
      [...part('[Content_Types].xml').matchAll(/<Default Extension="png" ContentType="image\/png"\/>/g)].length,
    ]).toEqual([true, true, true, true, 1]);
  });

  it('writes the image bytes it was given', () => {
    const image = png();
    const { zip } = render({ body: para('{{@description}}'), images: new Map([[DIAGRAM, image]]) });
    expect(zip.file('word/media/artup-1.png').asUint8Array()).toEqual(image.bytes);
  });

  it('adds the png content type only once when two issues show the same image', () => {
    const { part } = render({ body: `${para('{{#issues}}')}${para('{{@description}}')}${para('{{/issues}}')}`, issues: [prepare(), prepare()], images: new Map([[DIAGRAM, png()]]) });
    expect([...part('[Content_Types].xml').matchAll(/Extension="png"/g)].length).toEqual(1);
  });

  it('gives every drawing in the document a distinct id when one rich value appears twice', () => {
    const { doc } = render({ body: `${para('{{@description}}')}${para('{{@description}}')}`, images: new Map([[DIAGRAM, png()]]) });
    const ids = [...doc.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
    expect([ids.length, new Set(ids).size]).toEqual([2, 2]);
  });

  it('adds no media, relationship or content type when no image is shown', () => {
    const { names, part } = render({ body: para('{{summary}}'), images: new Map([[DIAGRAM, png()]]) });
    expect([names.filter((n) => n.startsWith('word/media/')), part('word/_rels/document.xml.rels').includes('rIdArtup'), part('[Content_Types].xml').includes('image/png')])
      .toEqual([[], false, false]);
  });

  it('writes the unavailable placeholder for an image whose bytes are broken', () => {
    const broken = { ...png(), bytes: png().bytes.slice(0, 60) };
    const { doc, names } = render({ body: para('{{@description}}'), images: new Map([[DIAGRAM, broken]]) });
    expect([doc.includes('[Image unavailable: '), names.filter((n) => n.startsWith('word/media/'))]).toEqual([true, []]);
  });

  it('numbers new images after media the template already has under the same name', () => {
    const zip = new PizZip(makeDocx({ body: para('{{@description}}') }));
    zip.file('word/media/artup-1.png', pngBytes(2, 2));
    const template = zip.generate({ type: 'uint8array' });
    const out = new PizZip(renderDocxTemplate({ template, issues: [prepare()], meta, images: new Map([[DIAGRAM, png()]]), labels, PizZip, Docxtemplater }));
    expect([/r:embed="(rIdArtup\d+)"/.exec(out.file('word/document.xml').asText())[1], out.file('word/media/artup-1.png').asUint8Array()]).toEqual(['rIdArtup2', pngBytes(2, 2)]);
  });

  it('renders plain text for a description tag without @', () => {
    const { doc } = render({ body: para('{{description}}') });
    expect([bodyOf(doc).includes('<w:tbl>'), texts(doc).join('').startsWith('Intro')]).toEqual([false, true]);
  });

  it('fills document tags in the header', () => {
    const { part } = render({ body: para('x'), header: para('{{jql}}') });
    expect(/<w:t[^>]*>project = RPT<\/w:t>/.test(part('word/header1.xml'))).toBe(true);
  });

  it('shows a section for an assigned issue', () => {
    const { doc } = render({ body: para('{{#assignee}}has{{/assignee}}') });
    expect(texts(doc)).toEqual(['has']);
  });

  it('skips a section for an unassigned issue', () => {
    const { doc } = render({ body: para('{{#assignee}}has{{/assignee}}'), issues: [prepare({ fields: { assignee: null } })] });
    expect(texts(doc).join('')).toEqual('');
  });

  it('reads a custom field by name', () => {
    const { doc } = render({ body: para('{{field "Story Points"}}') });
    expect(texts(doc)).toEqual([prepare().fields['Story Points']]);
  });

  it('reads a custom field written with typographic quotes', () => {
    const { doc } = render({ body: para('{{field “Story Points”}}') });
    expect(texts(doc)).toEqual([prepare().fields['Story Points']]);
  });

  it('renders every comment of every issue', () => {
    const { doc } = render({ body: para('{{#issues}}{{#comments}}{{author}}: {{body}};{{/comments}}{{/issues}}') });
    expect(texts(doc).join('')).toEqual('Ann: Looks good[image];Rob: Thanks;');
  });

  it('leaves an unknown tag empty', () => {
    const { doc } = render({ body: para('[{{nothing}}]') });
    expect(texts(doc).join('')).toEqual('[]');
  });

  it('adds image relationships to a template whose relationships part is self-closing', () => {
    const zip = new PizZip(makeDocx({ body: para('{{@description}}') }));
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    const { part } = render({ template: zip.generate({ type: 'uint8array' }), images: new Map([[DIAGRAM, png()]]) });
    expect(part('word/_rels/document.xml.rels')).toBe('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdArtup1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/artup-1.png"/>'
      + '</Relationships>');
  });

  it('prints the partial banner only in a partial file', () => {
    const body = [para('{{#partial}}'), para('{{partialBanner}}'), para('{{/partial}}'), para('{{key}}')].join('');
    const partial = render({ body, extraMeta: { partial: { done: 1, total: 3 } } });
    const full = render({ body });
    expect([texts(partial.doc), texts(full.doc)]).toEqual([['Incomplete export: 1 of 3 issues', 'RPT-1'], ['RPT-1']]);
  });

  it('produces a zip whose document has no placeholders left', () => {
    const { doc } = render({ body: `${para('{{key}} {{summary}}')}${para('{{@description}}')}`, images: new Map([[DIAGRAM, png()]]) });
    expect(doc.includes('{{')).toBe(false);
  });
});

describe('parseTag', () => {
  const rawContext = { meta: { part: { module: 'rawxml' } } };
  const plainContext = { meta: { part: {} } };

  it('returns the scope for a dot', () => {
    const scope = { a: 1 };
    expect(parseTag('.').get(scope, plainContext)).toEqual(scope);
  });

  it('walks a dotted path', () => {
    expect(parseTag('a.b').get({ a: { b: 'x' } }, plainContext)).toEqual('x');
  });

  it('reads the XML twin of a tag rendered as raw XML', () => {
    expect(parseTag('description').get({ description: 'text', description__xml: '<w:p/>' }, rawContext)).toEqual('<w:p/>');
  });

  it('returns undefined for a missing tag so outer scopes are searched', () => {
    expect(parseTag('missing').get({ a: 1 }, plainContext)).toEqual(undefined);
  });

  it('ignores inherited properties', () => {
    expect(parseTag('constructor').get({}, plainContext)).toEqual(undefined);
  });

  it('drops control characters from plain text values', () => {
    expect(parseTag('a').get({ a: 'x\u0001y' }, plainContext)).toEqual('xy');
  });
});

describe('createImageRegistry', () => {
  it('returns null for an unknown attachment', () => {
    expect(createImageRegistry(new Map()).ref('nope', 600)).toEqual(null);
  });

  it('fits the image into the offered width in EMU', () => {
    const registry = createImageRegistry(new Map([['a', png(1200, 600)]]));
    expect(registry.ref('a', 600)).toEqual({ rId: 'rIdArtup1', cx: 600 * 9525, cy: 300 * 9525, n: 1 });
  });

  it('reuses the number of an attachment already referenced', () => {
    const registry = createImageRegistry(new Map([['a', png()], ['b', png()]]));
    expect([registry.ref('b', 600).n, registry.ref('a', 600).n, registry.ref('b', 100).n]).toEqual([1, 2, 1]);
  });

  it('refuses an image that is not a PNG, JPEG or GIF', () => {
    const registry = createImageRegistry(new Map([['a', { bytes: new Uint8Array([1, 2, 3, 4]), type: 'png', width: 1, height: 1 }]]));
    expect(registry.ref('a', 600)).toEqual(null);
  });

  it('accepts a GIF by its header', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 5, 0, 0, 0]);
    const registry = createImageRegistry(new Map([['a', { bytes: gif, type: 'gif', width: 10, height: 5 }]]));
    expect(registry.ref('a', 600)).toEqual({ rId: 'rIdArtup1', cx: 10 * 9525, cy: 5 * 9525, n: 1 });
  });

  it('starts numbering after the first number it is given', () => {
    expect(createImageRegistry(new Map([['a', png()]]), { first: 4 }).ref('a', 600).rId).toEqual('rIdArtup4');
  });
});
