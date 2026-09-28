import { attr, elements } from './parse.js';
import { renderBlockArray, renderBlocks } from './blocks.js';
import { isMacroTag } from './macros.js';
import { lineBreakTag } from './escape.js';

const BLOCKY = new Set(['ul', 'ol', 'dl', 'table', 'pre', 'blockquote', 'ac:task-list', 'ac:structured-macro', 'ac:macro', 'ac:adf-extension', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function rowsOf(table) {
  return elements(table).flatMap((c) => (c.name === 'tr' ? [c] : ['thead', 'tbody', 'tfoot'].includes(c.name) ? elements(c).filter((r) => r.name === 'tr') : []));
}

function cellsOf(row) {
  return elements(row).filter((c) => c.name === 'td' || c.name === 'th');
}

function span(cell, name) {
  return Number(attr(cell, name)) > 1 ? Number(attr(cell, name)) : 1;
}

function isSimple(cell) {
  const blocky = (node) => elements(node).some((c) => (BLOCKY.has(c.name) && !(isMacroTag(c.name) && ['status', 'jira', 'anchor'].includes(attr(c, 'ac:name')))) || blocky(c));
  return span(cell, 'colspan') === 1 && span(cell, 'rowspan') === 1 && !blocky(cell);
}

const JSX_SPAN = { colspan: 'colSpan', rowspan: 'rowSpan' };

/** HTML table for merged cells or block content; the mdx flavor writes JSX attribute names and an explicit tbody. */
function htmlTable(rows, ctx) {
  const mdx = ctx.flavor === 'mdx';
  const cell = (c) => {
    const spans = ['colspan', 'rowspan'].filter((a) => span(c, a) > 1).map((a) => ` ${mdx ? JSX_SPAN[a] : a}="${span(c, a)}"`).join('');
    return `<${c.name}${spans}>\n\n${renderBlocks(c.children, { ...ctx, inTable: false })}\n\n</${c.name}>`;
  };
  const body = rows.map((row) => `<tr>\n${cellsOf(row).map(cell).join('\n')}\n</tr>`);
  return ['<table>', ...(mdx ? ['<tbody>', ...body, '</tbody>'] : body), '</table>'].join('\n');
}

/** GFM table for simple tables, HTML (with a complex-table warning) for merged cells or block content. */
export function renderTable(node, ctx) {
  const rows = rowsOf(node);
  if (!rows.length) return '';
  if (!rows.every((row) => cellsOf(row).every(isSimple))) {
    ctx.warn('complex-table', '');
    return htmlTable(rows, ctx);
  }
  const grid = rows.map((row) => cellsOf(row).map((c) => renderBlockArray(c.children, { ...ctx, inTable: true }).join(lineBreakTag(ctx.flavor)).replace(/\n{2,}/g, lineBreakTag(ctx.flavor)).replace(/\n/g, ' ')));
  const width = Math.max(...grid.map((r) => r.length));
  const line = (cells) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
  return [line(grid[0]), line(Array(width).fill('---')), ...grid.slice(1).map(line)].join('\n');
}
