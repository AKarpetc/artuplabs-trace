import { fitImage, isImageIntact } from '../core/imageSize.js';
import { tableGrid } from '../core/tableGrid.js';
import { splitRuns } from '../core/textRuns.js';
import { PALETTE } from './palette.js';

/** pdfmake font family per text script. */
export const FAMILY = { latin: 'Sans', cjk: 'CJK', korean: 'KR' };

/** Page sizes in points. */
export const PAPER = { A4: { name: 'A4', width: 595.28 }, LETTER: { name: 'LETTER', width: 612 } };

/** Page margin on every side, in points (2 cm). */
export const MARGIN = 57;

const PX_TO_PT = 0.75;
const LIST_INDENT = 15;
const QUOTE_INDENT = 16;
const CELL_PADDING = 8;
const CHUNK = 0x8000;
const HEX = /^[0-9a-fA-F]{6}$/;
const HEADING_SIZES = [18, 15, 13, 12, 11, 10];
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const PARA_MARGIN = () => [0, 2, 0, 2];
const BOX_MARGIN = () => [0, 4, 0, 4];

const hash = (hex) => `#${hex}`;

function colorOf(value) {
  const hex = typeof value === 'string' ? value.replace(/^#/, '') : '';
  return HEX.test(hex) ? hash(hex) : undefined;
}

function base64Of(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function decorationOf(run) {
  if (run.strike) return 'lineThrough';
  if (run.underline || run.link) return 'underline';
  return undefined;
}

function styleOf(run) {
  const style = {
    bold: run.bold || undefined,
    italics: run.italic || undefined,
    decoration: decorationOf(run),
    link: run.link || undefined,
    color: run.link ? hash(PALETTE.link) : colorOf(run.color),
    background: run.code ? hash(PALETTE.codeFill) : undefined,
    sup: run.sup || undefined,
    sub: run.sub || undefined,
  };
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined));
}

function runsOf(runs, ctx) {
  return (runs ?? []).flatMap((run) => {
    const style = styleOf(run);
    return splitRuns(run.text ?? '').flatMap((piece) => {
      if (piece.script === 'emoji') {
        ctx.stats.emojiDropped += 1;
        return [];
      }
      ctx.stats.scripts.add(piece.script);
      return [{ text: piece.text, font: FAMILY[piece.script], ...style }];
    });
  });
}

const plainRuns = (text, ctx) => runsOf([{ text }], ctx);

function paragraph(runs, ctx) {
  const text = runsOf(runs, ctx);
  return { text: text.length ? text : '', margin: PARA_MARGIN() };
}

const boxed = (cellNode, margin = BOX_MARGIN()) => ({ table: { widths: ['*'], body: [[cellNode]] }, layout: 'noBorders', margin });

function stackOrBlank(nodes) {
  return nodes.length ? { stack: nodes } : { text: '' };
}

function listBlock(list, ctx) {
  const items = (list.items ?? []).map((item) => stackOrBlank(blocksOf(item.blocks ?? [], { ...ctx, indent: ctx.indent + LIST_INDENT })));
  if (!items.length) return [];
  if (!list.ordered) return [{ ul: items }];
  return [{ ol: items, start: Number.isInteger(list.start) && list.start > 0 ? list.start : 1 }];
}

function tableBlock(table, ctx) {
  if (!table.rows?.length) return [];
  const grid = tableGrid(table);
  const width = grid[0].length;
  const inner = (colspan) => ({ ...ctx, indent: 0, box: Math.max(ctx.content / 4, (ctx.box - ctx.indent) * colspan / width - CELL_PADDING) });
  const body = grid.map((slots) => slots.map((slot) => {
    if (!slot.origin) return {};
    return {
      ...stackOrBlank(blocksOf(slot.cell.blocks ?? [], inner(slot.colspan))),
      ...(slot.colspan > 1 ? { colSpan: slot.colspan } : {}),
      ...(slot.rowspan > 1 ? { rowSpan: slot.rowspan } : {}),
      ...(slot.cell.header ? { fillColor: hash(PALETTE.headerFill) } : {}),
    };
  }));
  return [{ table: { headerRows: table.header ? 1 : 0, widths: Array(width).fill('*'), body }, margin: BOX_MARGIN() }];
}

function codeBlock(code, ctx) {
  return [boxed({ text: plainRuns(String(code.text ?? ''), ctx), fontSize: 8, preserveLeadingSpaces: true, fillColor: hash(PALETTE.codeFill) })];
}

function panelBlock(panel, ctx) {
  const fill = PALETTE.panel[panel.kind] ?? PALETTE.panel.info;
  const nodes = blocksOf(panel.blocks ?? [], { ...ctx, indent: 0, box: ctx.box - ctx.indent - CELL_PADDING });
  return [boxed({ ...stackOrBlank(nodes), fillColor: hash(fill) })];
}

function imageBlock(image, ctx) {
  const found = image.attachmentId ? ctx.images.get(image.attachmentId) : null;
  const mime = IMAGE_MIME[found?.type];
  const usable = Boolean(found?.bytes) && ctx.withImages && Boolean(mime) && isImageIntact(found.bytes, found.type);
  if (!usable) {
    if (found?.bytes) ctx.stats.imagesDropped += 1;
    return [{ text: plainRuns(`[${ctx.labels.imageUnavailable}: ${image.alt ?? ''}]`, ctx), italics: true, margin: PARA_MARGIN() }];
  }
  const room = Math.max(ctx.content / 4, ctx.box - ctx.indent);
  const size = fitImage({ width: found.width, height: found.height }, room / PX_TO_PT);
  ctx.stats.imagesEmbedded += 1;
  return [{ image: `data:${mime};base64,${base64Of(found.bytes)}`, width: Math.min(room, size.width * PX_TO_PT), margin: PARA_MARGIN() }];
}

function block(b, ctx) {
  switch (b.type) {
    case 'para': return [paragraph(b.runs, ctx)];
    case 'heading': return [{ text: runsOf(b.runs, ctx), style: `h${Math.min(6, Math.max(1, b.level ?? 1))}` }];
    case 'list': return listBlock(b, ctx);
    case 'table': return tableBlock(b, ctx);
    case 'code': return codeBlock(b, ctx);
    case 'quote': return [{ stack: blocksOf(b.blocks ?? [], { ...ctx, indent: ctx.indent + QUOTE_INDENT }), margin: [QUOTE_INDENT, 2, 0, 2] }];
    case 'panel': return panelBlock(b, ctx);
    case 'rule': return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: ctx.box - ctx.indent, y2: 0, lineWidth: 0.5, lineColor: hash(PALETTE.rule) }] }];
    case 'image': return imageBlock(b, ctx);
    default: return [];
  }
}

function blocksOf(blocks, ctx) {
  const out = [];
  let breakPending = false;
  for (const b of blocks) {
    if (b.type === 'pageBreak') {
      breakPending = out.length > 0;
    } else {
      const nodes = block(b, ctx);
      if (breakPending && nodes.length) {
        nodes[0] = { ...nodes[0], pageBreak: 'before' };
        breakPending = false;
      }
      out.push(...nodes);
    }
  }
  return out;
}

function headingStyles() {
  return Object.fromEntries(HEADING_SIZES.map((fontSize, i) => [`h${i + 1}`, { fontSize, bold: true, margin: [0, i < 2 ? 10 : 6, 0, 4] }]));
}

/** Builds a pdfmake definition for a built-in layout spec with the scripts it needs and the emoji and images dropped; withImages false puts placeholders everywhere. */
export function buildPdfDefinition({ spec, images, labels, meta, withImages = true }) {
  const paper = PAPER[spec.paper] ?? PAPER.A4;
  const content = paper.width - 2 * MARGIN;
  const stats = { scripts: new Set(['latin']), emojiDropped: 0, imagesDropped: 0, imagesEmbedded: 0 };
  const ctx = { images: images ?? new Map(), labels, stats, content, box: content, indent: 0, withImages };
  const body = blocksOf(spec.blocks ?? [], ctx);
  const small = { fontSize: 8, color: hash(PALETTE.muted), margin: [MARGIN, 16, MARGIN, 0] };
  const metaStack = { stack: (spec.metaLines ?? []).map((line) => ({ text: plainRuns(line, ctx) })), ...small };
  const titleLine = { text: plainRuns(spec.title ?? '', ctx), ...small };
  const definition = {
    pageSize: paper.name,
    pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN],
    info: { title: spec.title ?? '', author: meta?.exportedBy ?? '', subject: `JQL: ${meta?.jql ?? ''}` },
    defaultStyle: { font: FAMILY.latin, fontSize: 10, color: hash(PALETTE.text) },
    styles: headingStyles(),
    header: (page) => structuredClone(page === 1 ? metaStack : titleLine),
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'right', fontSize: 8, color: hash(PALETTE.muted), margin: [MARGIN, 20, MARGIN, 0] }),
    content: body,
  };
  return { definition, scripts: stats.scripts, emojiDropped: stats.emojiDropped, imagesDropped: stats.imagesDropped, imagesEmbedded: stats.imagesEmbedded };
}

/** Renders a built-in layout spec to PDF bytes; when the engine rejects the document, renders it once more with every image as a placeholder. */
export async function renderPdf({ spec, images, labels, meta, engine, loadFonts }) {
  const first = buildPdfDefinition({ spec, images, labels, meta });
  const fonts = await loadFonts(first.scripts);
  try {
    return { bytes: await engine.render(first.definition, fonts), emojiDropped: first.emojiDropped, imagesDropped: first.imagesDropped };
  } catch (error) {
    if (!first.imagesEmbedded) throw error;
    const plain = buildPdfDefinition({ spec, images, labels, meta, withImages: false });
    return { bytes: await engine.render(plain.definition, fonts), emojiDropped: plain.emojiDropped, imagesDropped: plain.imagesDropped };
  }
}
