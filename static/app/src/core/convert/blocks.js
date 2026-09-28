import { attr, elements, textOf } from './parse.js';
import { escapeLineStart, fence, quote } from './escape.js';
import { renderInline } from './inline.js';
import { isInlineMacro, renderMacro } from './macros.js';
import { renderTable } from './tables.js';

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'table', 'div', 'section', 'fieldset',
  'ac:layout', 'ac:layout-section', 'ac:layout-cell', 'ac:task-list', 'ac:adf-extension', 'ac:rich-text-body', 'tbody',
]);

function isBlock(node) {
  if (node.type !== 'tag') return false;
  if (node.name === 'ac:structured-macro') return !isInlineMacro(node);
  return BLOCK_TAGS.has(node.name);
}

function paragraph(nodes, ctx) {
  return renderInline(nodes, ctx).trim().split('\n').map(escapeLineStart).join('\n');
}

function indentItem(marker, body) {
  const pad = ' '.repeat(marker.length + 1);
  const [first, ...rest] = body.split('\n');
  return [`${marker} ${first}`.trimEnd(), ...rest.map((line) => (line ? pad + line : line))].join('\n');
}

function renderList(node, ctx) {
  const ordered = node.name === 'ol';
  const start = Number(attr(node, 'start')) || 1;
  return elements(node).filter((li) => li.name === 'li').map((li, index) => {
    const blocks = renderBlockArray(li.children, ctx);
    const loose = elements(li).some((c) => c.name === 'p') && blocks.length > 1;
    return indentItem(ordered ? `${start + index}.` : '-', blocks.join(loose ? '\n\n' : '\n'));
  }).join('\n');
}

function renderTaskList(node, ctx) {
  return elements(node).filter((c) => c.name === 'ac:task').map((task) => {
    const status = elements(task).find((c) => c.name === 'ac:task-status');
    const body = elements(task).find((c) => c.name === 'ac:task-body');
    return `- [${textOf(status).trim() === 'complete' ? 'x' : ' '}] ${renderInline(body?.children, ctx).trim()}`;
  }).join('\n');
}

function renderAdf(node, ctx) {
  const type = attr(elements(node).find((c) => c.name === 'ac:adf-node'), 'type');
  ctx.warn('adf-extension', type);
  const fallback = elements(node).find((c) => c.name === 'ac:adf-fallback');
  return fallback ? renderBlocks(fallback.children, ctx) : '';
}

function renderBlock(node, ctx) {
  const heading = /^h([1-6])$/.exec(node.name);
  if (heading) return `${'#'.repeat(Number(heading[1]))} ${renderInline(node.children, ctx).trim()}`;
  switch (node.name) {
    case 'p': return paragraph(node.children, ctx);
    case 'ul': case 'ol': return renderList(node, ctx);
    case 'blockquote': return quote(renderBlocks(node.children, ctx));
    case 'pre': return fence(textOf(node), '');
    case 'hr': return '---';
    case 'table': return renderTable(node, ctx);
    case 'ac:task-list': return renderTaskList(node, ctx);
    case 'ac:structured-macro': return renderMacro(node, ctx);
    case 'ac:adf-extension': return renderAdf(node, ctx);
    default: return renderBlocks(node.children, ctx);
  }
}

/** Renders block and loose inline content to an array of Markdown blocks. */
export function renderBlockArray(nodes, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    const text = paragraph(run, ctx);
    if (text) out.push(text);
    run = [];
  };
  for (const node of nodes ?? []) {
    if (!isBlock(node)) {
      run.push(node);
      continue;
    }
    flush();
    const block = renderBlock(node, ctx);
    if (block.trim()) out.push(block);
  }
  flush();
  return out;
}

/** Renders nodes to Markdown blocks separated by blank lines. */
export function renderBlocks(nodes, ctx) {
  return renderBlockArray(nodes, ctx).join('\n\n');
}
