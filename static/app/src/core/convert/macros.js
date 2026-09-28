import { attr, childTag, param, textOf } from './parse.js';
import { codeSpan, escapeHtml, escapeText, fence, quote } from './escape.js';
import { renderBlocks } from './blocks.js';
import { link } from './inline.js';

const PANELS = { info: 'NOTE', tip: 'TIP', note: 'WARNING', warning: 'CAUTION' };
const BODY_ONLY = new Set(['excerpt', 'section', 'column', 'details', 'div']);
const DYNAMIC = new Set([
  'toc', 'toc-zone', 'pagetree', 'pagetreesearch', 'recently-updated', 'contentbylabel', 'livesearch', 'blog-posts',
  'attachments', 'include', 'excerpt-include', 'detailssummary', 'tasks-report-macro', 'content-report-table', 'profile',
]);
const INLINE = new Set(['status', 'jira', 'anchor']);

/** True for macros rendered inside a paragraph. */
export function isInlineMacro(node) {
  return INLINE.has(attr(node, 'ac:name'));
}

/** Renders an inline macro (status, single Jira issue, anchor). */
export function renderInlineMacro(node, ctx) {
  const name = attr(node, 'ac:name');
  if (name === 'status') return codeSpan((param(node, 'title') || param(node, 'colour')).toUpperCase(), ctx.inTable);
  if (name === 'jira') {
    const key = param(node, 'key');
    if (key) return link(escapeText(key), `${ctx.siteUrl}/browse/${key}`);
    ctx.warn('dynamic-macro', 'jira');
    return '<!-- confluence:jira -->';
  }
  if (name === 'anchor') return `<a id="${escapeHtml(param(node, '') || textOf(node).trim())}"></a>`;
  return renderMacro(node, ctx);
}

function admonition(kind, title, body) {
  return quote([`[!${kind}]`, ...(title ? [`**${escapeText(title)}**`] : []), body].filter(Boolean).join('\n'));
}

/** Renders a block macro; unknown macros keep their body and add a warning. */
export function renderMacro(node, ctx) {
  const name = attr(node, 'ac:name');
  const rich = childTag(node, 'ac:rich-text-body');
  const plain = childTag(node, 'ac:plain-text-body');
  const body = () => renderBlocks(rich?.children, ctx);
  if (name === 'code' || name === 'noformat') return fence(textOf(plain), name === 'code' ? param(node, 'language') : '');
  if (PANELS[name]) return admonition(PANELS[name], param(node, 'title'), body());
  if (name === 'panel') return quote([param(node, 'title') && `**${escapeText(param(node, 'title'))}**`, body()].filter(Boolean).join('\n\n'));
  if (name === 'expand') return `<details>\n<summary>${escapeHtml(param(node, 'title') || 'Details')}</summary>\n\n${body()}\n\n</details>`;
  if (BODY_ONLY.has(name)) return body();
  if (name === 'children') return ctx.childLinks().map((c) => `- ${link(escapeText(c.title), c.href)}`).join('\n');
  if (INLINE.has(name)) return renderInlineMacro(node, ctx);
  if (DYNAMIC.has(name)) {
    ctx.warn('dynamic-macro', name);
    return `<!-- confluence:${name} -->`;
  }
  ctx.warn('unknown-macro', name);
  const inner = rich ? body() : plain ? fence(textOf(plain), '') : '';
  return [`<!-- confluence:${name} -->`, inner].filter(Boolean).join('\n\n');
}
