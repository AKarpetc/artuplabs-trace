import { attr, elements, extractEdgeBreak, textOf } from './parse.js';
import { escapeLineStart, fence, quote } from './escape.js';
import { renderInline } from './inline.js';
import { isInlineMacro, isMacroTag, renderMacro } from './macros.js';
import { renderTable } from './tables.js';

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'hr', 'table', 'div', 'section', 'fieldset',
  'ac:layout', 'ac:layout-section', 'ac:layout-cell', 'ac:task-list', 'ac:adf-extension', 'ac:rich-text-body', 'tbody',
]);

const blockCache = new WeakMap();

/** True when a direct child is itself block-level; each node's isBlock() result is computed once. */
function containsBlock(node) {
  return elements(node).some(isBlock);
}

function isBlock(node) {
  if (node.type !== 'tag') return false;
  if (blockCache.has(node)) return blockCache.get(node);
  const result = isMacroTag(node.name) ? !isInlineMacro(node) : BLOCK_TAGS.has(node.name) || containsBlock(node);
  blockCache.set(node, result);
  return result;
}

/** Drops a leading (dir 1) or trailing (dir -1) hard break, descending through empty or whitespace-only elements. */
function trimSide(nodes, dir) {
  let current = nodes;
  for (;;) {
    const result = extractEdgeBreak(current, dir);
    if (!result.removed) return current;
    current = result.nodes;
  }
}

/** Drops leading/trailing hard breaks (and the empty or blank elements around them), which have no line to break to or from. */
function trimBoundaryBreaks(nodes) {
  return trimSide(trimSide(nodes ?? [], 1), -1);
}

function paragraph(nodes, ctx) {
  const text = renderInline(trimBoundaryBreaks(nodes), ctx).trim();
  return text ? text.split('\n').map((line) => escapeLineStart(line, ctx.flavor)).join('\n') : '';
}

/** Indents a list item's continuation lines under its marker; mkdocs (Python-Markdown) needs at least 4 spaces to nest. */
function indentItem(marker, body, flavor) {
  const pad = ' '.repeat(flavor === 'mkdocs' ? Math.max(4, marker.length + 1) : marker.length + 1);
  const [first, ...rest] = body.split('\n');
  return [`${marker} ${first}`.trimEnd(), ...rest.map((line) => (line ? pad + line : line))].join('\n');
}

function renderList(node, ctx) {
  const ordered = node.name === 'ol';
  const rawStart = attr(node, 'start');
  const parsedStart = Number(rawStart);
  const start = rawStart !== '' && Number.isInteger(parsedStart) ? parsedStart : 1;
  const items = elements(node).filter((li) => li.name === 'li').map((li, index) => {
    const blocks = renderBlockArray(li.children, ctx);
    const loose = elements(li).some((c) => c.name === 'p') && blocks.length > 1;
    return { loose, text: indentItem(ordered ? `${start + index}.` : '-', blocks.join(loose ? '\n\n' : '\n'), ctx.flavor) };
  });
  const separator = ctx.flavor === 'mkdocs' && items.some((item) => item.loose) ? '\n\n' : '\n';
  return items.map((item) => item.text).join(separator);
}

function renderTaskList(node, ctx) {
  return elements(node).filter((c) => c.name === 'ac:task').map((task) => {
    const status = elements(task).find((c) => c.name === 'ac:task-status');
    const body = elements(task).find((c) => c.name === 'ac:task-body');
    const checkbox = `[${textOf(status).trim() === 'complete' ? 'x' : ' '}]`;
    const [first, ...rest] = renderBlockArray(body?.children, ctx).join('\n\n').split('\n');
    return indentItem('-', [`${checkbox} ${first}`.trimEnd(), ...rest].join('\n'), ctx.flavor);
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

const LIST_TAGS = new Set(['ul', 'ol', 'ac:task-list']);
const LIST_SEPARATOR = '<!-- -->';

/** Renders block and loose inline content to an array of Markdown blocks; mkdocs gets an empty comment between adjacent lists, which Python-Markdown would merge. */
export function renderBlockArray(nodes, ctx) {
  const out = [];
  let run = [];
  let lastList = false;
  const flush = () => {
    const text = paragraph(run, ctx);
    if (text) {
      out.push(text);
      lastList = false;
    }
    run = [];
  };
  for (const node of nodes ?? []) {
    if (!isBlock(node)) {
      run.push(node);
      continue;
    }
    flush();
    const block = renderBlock(node, ctx);
    if (!block.trim()) continue;
    const list = LIST_TAGS.has(node.name);
    if (list && lastList && ctx.flavor === 'mkdocs') out.push(LIST_SEPARATOR);
    out.push(block);
    lastList = list;
  }
  flush();
  return out;
}

/** Renders nodes to Markdown blocks separated by blank lines. */
export function renderBlocks(nodes, ctx) {
  return renderBlockArray(nodes, ctx).join('\n\n');
}
