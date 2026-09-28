import { attr, elements, textOf } from './parse.js';
import { escapeLineStart, fence, quote } from './escape.js';
import { renderInline } from './inline.js';
import { isInlineMacro, isMacroTag, renderMacro } from './macros.js';
import { renderTable } from './tables.js';

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'hr', 'table', 'div', 'section', 'fieldset',
  'ac:layout', 'ac:layout-section', 'ac:layout-cell', 'ac:task-list', 'ac:adf-extension', 'ac:rich-text-body', 'tbody',
]);

function containsBlock(node) {
  return elements(node).some((c) => isBlock(c) || containsBlock(c));
}

function isBlock(node) {
  if (node.type !== 'tag') return false;
  if (isMacroTag(node.name)) return !isInlineMacro(node);
  if (BLOCK_TAGS.has(node.name)) return true;
  return containsBlock(node);
}

function isHardBreak(node) {
  return node.type === 'tag' && node.name === 'br';
}

function isBlankText(node) {
  return node.type === 'text' && !node.data.trim();
}

/** Drops leading/trailing hard breaks and surrounding blank text, which have no line to break to or from. */
function trimBoundaryBreaks(nodes) {
  let start = 0;
  let end = nodes.length;
  while (start < end && (isHardBreak(nodes[start]) || isBlankText(nodes[start]))) start += 1;
  while (end > start && (isHardBreak(nodes[end - 1]) || isBlankText(nodes[end - 1]))) end -= 1;
  return nodes.slice(start, end);
}

function paragraph(nodes, ctx) {
  const text = renderInline(trimBoundaryBreaks(nodes ?? []), ctx).trim();
  return text ? text.split('\n').map(escapeLineStart).join('\n') : '';
}

function indentItem(marker, body) {
  const pad = ' '.repeat(marker.length + 1);
  const [first, ...rest] = body.split('\n');
  return [`${marker} ${first}`.trimEnd(), ...rest.map((line) => (line ? pad + line : line))].join('\n');
}

function renderList(node, ctx) {
  const ordered = node.name === 'ol';
  const rawStart = attr(node, 'start');
  const parsedStart = Number(rawStart);
  const start = rawStart !== '' && Number.isInteger(parsedStart) ? parsedStart : 1;
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
    const checkbox = `[${textOf(status).trim() === 'complete' ? 'x' : ' '}]`;
    const [first, ...rest] = renderBlockArray(body?.children, ctx).join('\n\n').split('\n');
    return indentItem('-', [`${checkbox} ${first}`.trimEnd(), ...rest].join('\n'));
  }).join('\n');
}

function renderAdf(node, ctx) {
  const type = attr(elements(node).find((c) => c.name === 'ac:adf-node'), 'type');
  ctx.warn('adf-extension', type);
  const fallback = elements(node).find((c) => c.name === 'ac:adf-fallback');
  return fallback ? renderBlocks(fallback.children, ctx) : '';
}

function renderDl(node, ctx) {
  return elements(node).map((c) => {
    if (c.name === 'dt') return `**${renderInline(c.children, ctx).trim()}**`;
    if (c.name === 'dd') return renderBlocks(c.children, ctx);
    return renderBlock(c, ctx);
  }).filter((block) => block.trim()).join('\n\n');
}

function renderBlock(node, ctx) {
  const heading = /^h([1-6])$/.exec(node.name);
  if (heading) return `${'#'.repeat(Number(heading[1]))} ${renderInline(node.children, { ...ctx, inHeading: true }).trim()}`;
  if (isMacroTag(node.name)) return renderMacro(node, ctx);
  switch (node.name) {
    case 'p': return containsBlock(node) ? renderBlocks(node.children, ctx) : paragraph(node.children, ctx);
    case 'ul': case 'ol': return renderList(node, ctx);
    case 'dl': return renderDl(node, ctx);
    case 'blockquote': return quote(renderBlocks(node.children, ctx));
    case 'pre': return fence(textOf(node), '');
    case 'hr': return '---';
    case 'table': return renderTable(node, ctx);
    case 'ac:task-list': return renderTaskList(node, ctx);
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
