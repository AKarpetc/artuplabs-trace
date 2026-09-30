import { fitImage } from '../core/imageSize.js';
import { tableGrid } from '../core/tableGrid.js';
import { PALETTE } from './palette.js';

/** Page sizes in twips. */
export const PAPER = { A4: { width: 11906, height: 16838 }, LETTER: { width: 12240, height: 15840 } };

/** Page margin on every side, in twips (2 cm). */
export const MARGIN = 1134;

const MAX_LEVEL = 8;
const LIST_INDENT = 720;
const QUOTE_INDENT = 567;
const HEX = /^[0-9a-fA-F]{6}$/;

function colorOf(value) {
  const hex = typeof value === 'string' ? value.replace(/^#/, '') : '';
  return HEX.test(hex) ? hex : undefined;
}

function textRuns(run, docx, extra = {}) {
  const format = {
    bold: run.bold || undefined,
    italics: run.italic || undefined,
    strike: run.strike || undefined,
    underline: run.underline ? {} : undefined,
    font: run.code ? 'Consolas' : undefined,
    color: colorOf(run.color),
    subScript: run.sub || undefined,
    superScript: run.sup || undefined,
    ...extra,
  };
  return String(run.text ?? '').split('\n').map((text, i) => new docx.TextRun({ ...format, text, ...(i > 0 ? { break: 1 } : {}) }));
}

function runsOf(runs, ctx) {
  const { docx } = ctx;
  return (runs ?? []).flatMap((run) => (run.link
    ? [new docx.ExternalHyperlink({ link: run.link, children: textRuns(run, docx, { style: 'Hyperlink' }) })]
    : textRuns(run, docx)));
}

function frame(ctx, withIndent = true) {
  const { docx } = ctx;
  return {
    ...(withIndent && ctx.indent ? { indent: { left: ctx.indent } } : {}),
    ...(ctx.quoted ? { border: { left: { style: docx.BorderStyle.SINGLE, size: 12, color: PALETTE.rule, space: 8 } } } : {}),
  };
}

function orderedReference(start, level, ctx) {
  const reference = `artup-ordered-${ctx.ordered.length + 1}`;
  ctx.ordered.push({ reference, level, start: Number.isInteger(start) && start > 0 ? start : 1 });
  return reference;
}

const imagePx = (ctx) => Math.max(ctx.contentPx / 4, ctx.boxPx - ctx.indent / 15);

function listBlock(list, ctx) {
  const { docx } = ctx;
  const level = Math.min(ctx.level, MAX_LEVEL);
  const numbering = list.ordered ? { reference: orderedReference(list.start, level, ctx), level } : null;
  const inner = { ...ctx, level: level + 1, indent: ctx.baseIndent + LIST_INDENT * (level + 1) };
  return (list.items ?? []).flatMap((item) => {
    const [first, ...rest] = item.blocks ?? [];
    const lead = first && (first.type === 'para' || first.type === 'heading') ? first : null;
    const marker = new docx.Paragraph({
      ...frame(ctx, false),
      ...(numbering ? { numbering } : { bullet: { level } }),
      children: runsOf(lead?.runs, ctx),
    });
    return [marker, ...blocksOf(lead ? rest : item.blocks ?? [], inner)];
  });
}

function cellChildren(blocks, ctx) {
  const children = blocksOf(blocks ?? [], ctx);
  const last = children[children.length - 1];
  return last instanceof ctx.docx.Paragraph ? children : [...children, new ctx.docx.Paragraph({})];
}

function tableBlock(table, ctx) {
  const { docx } = ctx;
  if (!table.rows?.length) return [];
  const grid = tableGrid(table);
  const inner = (colspan) => ({
    ...ctx, indent: 0, baseIndent: 0, quoted: false,
    boxPx: Math.max(ctx.contentPx / 4, (ctx.boxPx * colspan) / grid[0].length),
  });
  const rows = grid.map((slots, r) => new docx.TableRow({
    ...(r === 0 && table.header ? { tableHeader: true } : {}),
    children: slots.filter((slot) => slot.origin).map((slot) => new docx.TableCell({
      ...(slot.colspan > 1 ? { columnSpan: slot.colspan } : {}),
      ...(slot.rowspan > 1 ? { rowSpan: slot.rowspan } : {}),
      ...(slot.cell.header ? { shading: { type: docx.ShadingType.CLEAR, fill: PALETTE.headerFill } } : {}),
      children: cellChildren(slot.cell.blocks, inner(slot.colspan)),
    })),
  }));
  return [new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows })];
}

function panelBlock(panel, ctx) {
  const { docx } = ctx;
  const fill = PALETTE.panel[panel.kind] ?? PALETTE.panel.info;
  const cell = new docx.TableCell({
    shading: { type: docx.ShadingType.CLEAR, fill },
    children: cellChildren(panel.blocks, { ...ctx, indent: 0, baseIndent: 0, quoted: false }),
  });
  return [new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: [new docx.TableRow({ children: [cell] })] })];
}

function codeBlock(code, ctx) {
  const { docx } = ctx;
  return String(code.text ?? '').split('\n').map((line) => new docx.Paragraph({
    ...frame(ctx),
    shading: { type: docx.ShadingType.CLEAR, fill: PALETTE.codeFill },
    children: [new docx.TextRun({ text: line, font: 'Consolas', size: 18 })],
  }));
}

function imageBlock(image, ctx) {
  const { docx } = ctx;
  const found = image.attachmentId ? ctx.images.get(image.attachmentId) : null;
  if (!found?.bytes) {
    const text = `[${ctx.labels.imageUnavailable}: ${image.alt ?? ''}]`;
    return [new docx.Paragraph({ ...frame(ctx), children: [new docx.TextRun({ text, italics: true })] })];
  }
  const size = fitImage({ width: found.width, height: found.height }, imagePx(ctx));
  return [new docx.Paragraph({
    ...frame(ctx),
    children: [new docx.ImageRun({ type: found.type, data: found.bytes, transformation: size })],
  })];
}

function block(b, ctx) {
  const { docx } = ctx;
  switch (b.type) {
    case 'para': return [new docx.Paragraph({ ...frame(ctx), children: runsOf(b.runs, ctx) })];
    case 'heading': {
      const level = Math.min(6, Math.max(1, b.level ?? 1));
      return [new docx.Paragraph({ ...frame(ctx), heading: docx.HeadingLevel[`HEADING_${level}`], children: runsOf(b.runs, ctx) })];
    }
    case 'list': return listBlock(b, ctx);
    case 'table': return tableBlock(b, ctx);
    case 'code': return codeBlock(b, ctx);
    case 'quote': return blocksOf(b.blocks ?? [], { ...ctx, indent: ctx.indent + QUOTE_INDENT, baseIndent: ctx.indent + QUOTE_INDENT, quoted: true });
    case 'panel': return panelBlock(b, ctx);
    case 'rule': return [new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: PALETTE.rule, space: 1 } } })];
    case 'image': return imageBlock(b, ctx);
    case 'pageBreak': return [new docx.Paragraph({ children: [new docx.PageBreak()] })];
    default: return [];
  }
}

function blocksOf(blocks, ctx) {
  return blocks.flatMap((b) => block(b, ctx));
}

function orderedConfig(list, docx) {
  return {
    reference: list.reference,
    levels: Array.from({ length: MAX_LEVEL + 1 }, (_, level) => ({
      level,
      format: docx.LevelFormat.DECIMAL,
      text: `%${level + 1}.`,
      start: level === list.level ? list.start : 1,
      alignment: docx.AlignmentType.START,
      style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: 360 } } },
    })),
  };
}

function pageFooter(docx) {
  return new docx.Footer({
    children: [new docx.Paragraph({
      alignment: docx.AlignmentType.RIGHT,
      children: [new docx.TextRun({ size: 16, color: PALETTE.muted, children: [docx.PageNumber.CURRENT, ' / ', docx.PageNumber.TOTAL_PAGES] })],
    })],
  });
}

const smallLine = (text, docx) => new docx.Paragraph({ children: [new docx.TextRun({ text, size: 16, color: PALETTE.muted })] });

/** Builds a docx Document for a built-in layout spec; images maps attachment ids to bytes, type and pixel size. */
export function buildDocxDocument({ spec, images, labels, meta, docx }) {
  const paper = PAPER[spec.paper] ?? PAPER.A4;
  const contentPx = (paper.width - 2 * MARGIN) / 15;
  const ctx = {
    docx, images: images ?? new Map(), labels, level: 0, indent: 0, baseIndent: 0, quoted: false,
    contentPx, boxPx: contentPx, ordered: [],
  };
  const children = blocksOf(spec.blocks ?? [], ctx);
  const footer = pageFooter(docx);
  return new docx.Document({
    creator: meta.exportedBy,
    title: spec.title,
    description: `JQL: ${meta.jql}`,
    numbering: { config: ctx.ordered.map((list) => orderedConfig(list, docx)) },
    sections: [{
      properties: {
        titlePage: true,
        page: { size: paper, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
      },
      headers: {
        first: new docx.Header({ children: spec.metaLines?.length ? spec.metaLines.map((line) => smallLine(line, docx)) : [new docx.Paragraph({})] }),
        default: new docx.Header({ children: [smallLine(spec.title ?? '', docx)] }),
      },
      footers: { default: footer, first: pageFooter(docx) },
      children,
    }],
  });
}

/** Serialises a docx Document to .docx bytes. */
export async function packDocx(document, docx) {
  if (typeof docx.Packer.toArrayBuffer === 'function') return new Uint8Array(await docx.Packer.toArrayBuffer(document));
  return new Uint8Array(await (await docx.Packer.toBlob(document)).arrayBuffer());
}

/** Renders a built-in layout spec to .docx bytes. */
export async function renderDocx(args) {
  return packDocx(buildDocxDocument(args), args.docx);
}
