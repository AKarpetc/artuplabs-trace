import { attr, childTag, elements, param, textOf } from './parse.js';
import { codeSpan, escapeHtml, escapeText, fence, placeholder, quote } from './escape.js';
import { renderBlocks } from './blocks.js';
import { link } from './inline.js';

const PANELS = { info: 'NOTE', tip: 'TIP', note: 'WARNING', warning: 'CAUTION' };
const SITE_KINDS = { NOTE: 'note', TIP: 'tip', WARNING: 'warning', CAUTION: 'danger' };
const BODY_ONLY = new Set(['excerpt', 'section', 'column', 'details', 'div']);
const DYNAMIC = new Set([
  'toc', 'toc-zone', 'pagetree', 'pagetreesearch', 'recently-updated', 'contentbylabel', 'livesearch', 'blog-posts',
  'attachments', 'include', 'excerpt-include', 'detailssummary', 'tasks-report-macro', 'content-report-table', 'profile',
]);
const FILE_EMBEDS = new Set(['view-file', 'viewpdf', 'viewdoc', 'viewxls', 'viewppt', 'multimedia']);
const INLINE = new Set(['status', 'jira', 'anchor', ...FILE_EMBEDS]);

/** True for the current and legacy structured-macro element names. */
export function isMacroTag(name) {
  return name === 'ac:structured-macro' || name === 'ac:macro';
}

/** True for macros rendered inside a paragraph. */
export function isInlineMacro(node) {
  return INLINE.has(attr(node, 'ac:name'));
}

function sanitizeMacroName(name) {
  return name.replace(/[^\w.-]/g, '');
}

function embeddedAttachment(node) {
  const parameter = elements(node).find((c) => c.name === 'ac:parameter' && attr(c, 'ac:name') === 'name');
  return childTag(parameter, 'ri:attachment');
}

/** File embed (view-file, viewpdf, multimedia …) as a link to the attachment; missing → its name as text and a warning. */
function renderFileEmbed(node, ctx) {
  const attachment = embeddedAttachment(node);
  if (!attachment) {
    ctx.warn('unknown-macro', attr(node, 'ac:name'));
    return placeholder(sanitizeMacroName(attr(node, 'ac:name')), ctx.flavor);
  }
  const name = attr(attachment, 'ri:filename');
  const href = ctx.attachment(name, childTag(attachment, 'ri:page'));
  if (!href) {
    ctx.warn('missing-attachment', name);
    return escapeText(name, ctx.flavor);
  }
  return link(escapeText(name, ctx.flavor), href);
}

/** Renders an inline macro (status, single Jira issue, anchor, file embed). */
export function renderInlineMacro(node, ctx) {
  const name = attr(node, 'ac:name');
  if (FILE_EMBEDS.has(name)) return renderFileEmbed(node, ctx);
  if (name === 'status') return codeSpan((param(node, 'title') || param(node, 'colour')).toUpperCase(), ctx.inTable);
  if (name === 'jira') {
    const key = param(node, 'key');
    if (key) return link(escapeText(key, ctx.flavor), `${ctx.siteUrl}/browse/${key}`);
    ctx.warn('dynamic-macro', 'jira');
    return placeholder('jira', ctx.flavor);
  }
  if (name === 'anchor') {
    const id = param(node, '') || textOf(node).trim();
    return id ? `<a id="${escapeHtml(id)}"></a>` : '';
  }
  return renderMacro(node, ctx);
}

function directiveFence(body) {
  const inner = [...body.matchAll(/^\s*(:{3,})/gm)].map((m) => m[1].length);
  return ':'.repeat(Math.max(3, ...inner.map((n) => n + 1)));
}

/** Panel as a GitHub alert (gfm), a Docusaurus directive (mdx) or a Python-Markdown admonition (mkdocs). */
function admonition(kind, rawTitle, body, flavor) {
  const title = escapeText(flavor === 'gfm' ? rawTitle : rawTitle.replace(/\s+/g, ' '), flavor);
  if (flavor === 'mdx') {
    const marks = directiveFence(body);
    return [`${marks}${SITE_KINDS[kind]}${title ? `[${title}]` : ''}`, body, marks].filter(Boolean).join('\n\n');
  }
  if (flavor === 'mkdocs') {
    const indented = body.split('\n').map((line) => (line ? `    ${line}` : line)).join('\n');
    return [`!!! ${SITE_KINDS[kind]}${title ? ` "${title}"` : ''}`, ...(body ? [indented] : [])].join('\n');
  }
  return quote([`[!${kind}]`, ...(title ? [`**${title}**`] : []), body].filter(Boolean).join('\n'));
}

/** Renders a block macro; unknown macros keep their body and add a warning. */
export function renderMacro(node, ctx) {
  const name = attr(node, 'ac:name');
  const rich = childTag(node, 'ac:rich-text-body');
  const plain = childTag(node, 'ac:plain-text-body');
  const body = () => renderBlocks(rich?.children, ctx);
  if (name === 'code' || name === 'noformat') return fence(textOf(plain), name === 'code' ? param(node, 'language') : '');
  if (PANELS[name]) return admonition(PANELS[name], param(node, 'title'), body(), ctx.flavor);
  if (name === 'panel') return quote([param(node, 'title') && `**${escapeText(param(node, 'title'), ctx.flavor)}**`, body()].filter(Boolean).join('\n\n'));
  if (name === 'expand') return `<details${ctx.flavor === 'mkdocs' ? ' markdown="1"' : ''}>\n<summary>${escapeHtml(param(node, 'title') || 'Details', ctx.flavor)}</summary>\n\n${body()}\n\n</details>`;
  if (BODY_ONLY.has(name)) return body();
  if (name === 'children') return ctx.childLinks().map((c) => `- ${link(escapeText(c.title, ctx.flavor), c.href)}`).join('\n');
  if (INLINE.has(name)) return renderInlineMacro(node, ctx);
  if (DYNAMIC.has(name)) {
    ctx.warn('dynamic-macro', name);
    return placeholder(sanitizeMacroName(name), ctx.flavor);
  }
  ctx.warn('unknown-macro', name);
  const inner = rich ? body() : plain ? fence(textOf(plain), '') : '';
  return [placeholder(sanitizeMacroName(name), ctx.flavor), inner].filter(Boolean).join('\n\n');
}
