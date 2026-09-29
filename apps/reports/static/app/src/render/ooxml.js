import { tableGrid } from '../core/tableGrid.js';
import { PALETTE } from './palette.js';

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const HEX = /^[0-9a-fA-F]{6}$/;
const HEADING_SIZES = [32, 28, 26, 24, 22, 22];
const LIST_STEP = 360;
const QUOTE_INDENT = 567;
const TWIPS_PER_PX = 15;
const CONSOLAS = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';

/** Removes characters XML 1.0 cannot hold (control characters other than tab, newline and carriage return). */
export function stripInvalidXml(text) {
  return String(text ?? '').replace(INVALID_XML, '');
}

/** Escapes text for XML content and attribute values, dropping characters XML 1.0 forbids. */
export function escapeXml(text) {
  return stripInvalidXml(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const shading = (fill) => `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;

function colorOf(value) {
  const hex = typeof value === 'string' ? value.replace(/^#/, '') : '';
  return HEX.test(hex) ? hex.toUpperCase() : null;
}

function runProps(run, extra = {}) {
  const color = extra.color ?? colorOf(run.color);
  const parts = [
    run.code || extra.mono ? CONSOLAS : '',
    run.bold || extra.bold ? '<w:b/>' : '',
    run.italic || extra.italic ? '<w:i/>' : '',
    run.strike ? '<w:strike/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    extra.size ? `<w:sz w:val="${extra.size}"/>` : '',
    run.underline || extra.underline ? '<w:u w:val="single"/>' : '',
    run.code && !extra.mono ? shading(PALETTE.codeFill) : '',
    run.sub ? '<w:vertAlign w:val="subscript"/>' : '',
    run.sup && !run.sub ? '<w:vertAlign w:val="superscript"/>' : '',
  ].join('');
  return parts ? `<w:rPr>${parts}</w:rPr>` : '';
}

function textRun(run, extra) {
  const lines = String(run.text ?? '').split('\n').map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`);
  return `<w:r>${runProps(run, extra)}${lines.join('<w:br/>')}</w:r>`;
}

function linkRun(run, extra) {
  const target = stripInvalidXml(run.link).replace(/"/g, '%22');
  return [
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
    `<w:r><w:instrText xml:space="preserve"> HYPERLINK "${escapeXml(target)}" </w:instrText></w:r>`,
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    textRun(run, { ...extra, color: PALETTE.link, underline: true }),
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
  ].join('');
}

const runsXml = (runs, extra) => (runs ?? []).map((run) => (run.link ? linkRun(run, extra) : textRun(run, extra))).join('');

function paragraph(ctx, content, { keepNext = false, fill = null } = {}) {
  const props = [
    keepNext ? '<w:keepNext/>' : '',
    ctx.quoted ? `<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="${PALETTE.rule}"/></w:pBdr>` : '',
    fill ? shading(fill) : '',
    ctx.indent ? `<w:ind w:left="${ctx.indent}"/>` : '',
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
}

function listXml(list, ctx) {
  const indent = LIST_STEP * (ctx.depth + 1);
  const inner = { ...ctx, depth: ctx.depth + 1, indent: ctx.baseIndent + indent, room: Math.max(ctx.room / 4, ctx.room - LIST_STEP / TWIPS_PER_PX) };
  const first = Number.isInteger(list.start) && list.start > 0 ? list.start : 1;
  return (list.items ?? []).map((item, i) => {
    const [lead, ...rest] = item.blocks ?? [];
    const leads = lead && (lead.type === 'para' || lead.type === 'heading');
    const marker = { text: list.ordered ? `${first + i}. ` : '• ' };
    const head = paragraph({ ...ctx, indent: ctx.baseIndent + indent }, runsXml([marker, ...(leads ? lead.runs ?? [] : [])]));
    return head + blocksXml(leads ? rest : item.blocks ?? [], inner);
  }).join('');
}

function cellContent(blocks, ctx) {
  const xml = blocksXml(blocks ?? [], ctx);
  return xml && !xml.endsWith('</w:tbl>') ? xml : `${xml}<w:p/>`;
}

const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.rule}"/>`).join('');

function tableShell(ctx, columns, rows) {
  const width = Math.floor((ctx.room * TWIPS_PER_PX) / columns);
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${BORDERS}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

const cellCtx = (ctx, room) => ({ ...ctx, depth: 0, indent: 0, baseIndent: 0, quoted: false, room });

function tableXml(table, ctx) {
  if (!table.rows?.length) return '';
  const grid = tableGrid(table);
  const columns = grid[0].length;
  const roomFor = (colspan) => Math.max(ctx.room / 4, (ctx.room * colspan) / columns);
  const rows = grid.map((slots, r) => {
    const cells = slots.map((slot) => {
      const span = slot.colspan > 1 ? `<w:gridSpan w:val="${slot.colspan}"/>` : '';
      if (!slot.origin) {
        return slot.fromAbove && slot.leading ? `<w:tc><w:tcPr>${span}<w:vMerge/></w:tcPr><w:p/></w:tc>` : '';
      }
      const props = [
        span,
        slot.rowspan > 1 ? '<w:vMerge w:val="restart"/>' : '',
        slot.cell.header ? shading(PALETTE.headerFill) : '',
      ].join('');
      return `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}${cellContent(slot.cell.blocks, cellCtx(ctx, roomFor(slot.colspan)))}</w:tc>`;
    }).join('');
    return `<w:tr>${r === 0 && table.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
  }).join('');
  return tableShell(ctx, columns, rows);
}

function panelXml(panel, ctx) {
  const fill = PALETTE.panel[panel.kind] ?? PALETTE.panel.info;
  const cell = `<w:tc><w:tcPr>${shading(fill)}</w:tcPr>${cellContent(panel.blocks, cellCtx(ctx, ctx.room))}</w:tc>`;
  return tableShell(ctx, 1, `<w:tr>${cell}</w:tr>`);
}

function codeXml(code, ctx) {
  return String(code.text ?? '').split('\n')
    .map((line) => paragraph(ctx, textRun({ text: line }, { mono: true, size: 18 }), { fill: PALETTE.codeFill }))
    .join('');
}

function drawing({ rId, cx, cy }, alt, id) {
  const name = `artup-${id}`;
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}" descr="${escapeXml(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${escapeXml(rId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function imageXml(image, ctx) {
  const ref = image.attachmentId ? ctx.image(image.attachmentId, ctx.room) : null;
  if (!ref) {
    return paragraph(ctx, textRun({ text: `[${ctx.labels.imageUnavailable}: ${image.alt ?? ''}]`, italic: true }));
  }
  return paragraph(ctx, drawing(ref, image.alt ?? '', ctx.nextId()));
}

function blockXml(b, ctx) {
  switch (b.type) {
    case 'para': return paragraph(ctx, runsXml(b.runs));
    case 'heading': {
      const level = Math.min(6, Math.max(1, b.level ?? 1));
      return paragraph(ctx, runsXml(b.runs, { bold: true, size: HEADING_SIZES[level - 1] }), { keepNext: true });
    }
    case 'list': return listXml(b, ctx);
    case 'table': return tableXml(b, ctx);
    case 'code': return codeXml(b, ctx);
    case 'quote': {
      const indent = ctx.indent + QUOTE_INDENT;
      return blocksXml(b.blocks ?? [], { ...ctx, indent, baseIndent: indent, quoted: true, room: Math.max(ctx.room / 4, ctx.room - QUOTE_INDENT / TWIPS_PER_PX) });
    }
    case 'panel': return panelXml(b, ctx);
    case 'rule': return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${PALETTE.rule}"/></w:pBdr></w:pPr></w:p>`;
    case 'image': return imageXml(b, ctx);
    case 'pageBreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    default: return '';
  }
}

function blocksXml(blocks, ctx) {
  return blocks.map((b) => blockXml(b, ctx)).join('');
}

/** Body-level WordprocessingML for model blocks; never empty, and never ends with a table so it fits inside a table cell. */
export function blocksToOoxml(blocks, { image = () => null, labels, contentWidthPx, nextId } = {}) {
  let counter = 0;
  const ctx = {
    image, labels, depth: 0, indent: 0, baseIndent: 0, quoted: false, room: contentWidthPx,
    nextId: nextId ?? (() => { counter += 1; return counter; }),
  };
  const xml = blocksXml(blocks ?? [], ctx);
  if (!xml) return '<w:p/>';
  return xml.endsWith('</w:tbl>') ? `${xml}<w:p/>` : xml;
}
