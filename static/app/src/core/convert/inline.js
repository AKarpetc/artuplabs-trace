import { encodeLinkTarget } from '../links.js';
import { attr, childTag, textOf } from './parse.js';
import { codeSpan, escapeText } from './escape.js';
import { isMacroTag, renderInlineMacro } from './macros.js';

const EMOTICONS = {
  smile: '🙂', sad: '🙁', cheeky: '😛', laugh: '😀', wink: '😉', 'thumbs-up': '👍', 'thumbs-down': '👎',
  information: 'ℹ️', tick: '✅', cross: '❌', warning: '⚠️', plus: '➕', minus: '➖', question: '❓',
  'light-on': '💡', 'light-off': '💡', 'yellow-star': '⭐', 'red-star': '⭐', 'green-star': '⭐', 'blue-star': '⭐', heart: '❤️',
};

const MARK_KIND = { strong: 'strong', b: 'strong', em: 'em', i: 'em', s: 'del', del: 'del', strike: 'del' };
const MARK_TOKEN = { strong: '**', em: '*', del: '~~' };

function isPunct(ch) {
  return ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
}

function isSpace(ch) {
  return ch === undefined || /\s/.test(ch);
}

function canOpen(before, after) {
  if (isSpace(after)) return false;
  if (!isPunct(after)) return true;
  return isSpace(before) || isPunct(before);
}

function canClose(before, after) {
  if (isSpace(before)) return false;
  if (!isPunct(before)) return true;
  return isSpace(after) || isPunct(after);
}

/** Merges directly adjacent same-kind emphasis siblings into one node, so they wrap as a single run. */
function mergeMarks(nodes) {
  const out = [];
  for (const node of nodes) {
    const kind = node.type === 'tag' ? MARK_KIND[node.name] : undefined;
    const prev = out[out.length - 1];
    if (kind && prev?.__kind === kind) {
      prev.children.push(...(node.children ?? []));
      continue;
    }
    out.push(kind ? { type: 'tag', name: node.name, __kind: kind, children: [...(node.children ?? [])] } : node);
  }
  return out;
}

function siblingChar(nodes, index, step) {
  for (let i = index + step; i >= 0 && i < nodes.length; i += step) {
    const text = textOf(nodes[i]).replace(/\s+/g, ' ');
    if (text) return step === 1 ? text[0] : text[text.length - 1];
  }
  return undefined;
}

/** Wraps emphasis content in Markdown marks, falling back to an HTML tag when GFM flanking rules would break the marks. */
function renderMark(node, kind, before, after, ctx) {
  const rendered = renderInline(node.children, ctx);
  const match = rendered.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = match[2];
  if (!core) return rendered;
  const safe = canOpen(before, core[0]) && canClose(core[core.length - 1], after);
  return safe
    ? `${match[1]}${MARK_TOKEN[kind]}${core}${MARK_TOKEN[kind]}${match[3]}`
    : `${match[1]}<${kind}>${core}</${kind}>${match[3]}`;
}

/** Markdown link with an encoded target. */
export function link(text, href) {
  return `[${text}](${encodeLinkTarget(href)})`;
}

function withAnchor(href, anchor) {
  return anchor ? `${href}#${anchor}` : href;
}

function acLink(node, ctx) {
  const page = childTag(node, 'ri:page');
  const blogPost = childTag(node, 'ri:blog-post');
  const attachment = childTag(node, 'ri:attachment');
  const user = childTag(node, 'ri:user');
  const url = childTag(node, 'ri:url');
  const space = childTag(node, 'ri:space');
  const contentEntity = childTag(node, 'ri:content-entity');
  const rich = childTag(node, 'ac:link-body');
  const plain = childTag(node, 'ac:plain-text-link-body');
  const body = rich ? renderInline(rich.children, ctx).trim() : plain ? escapeText(textOf(plain)) : '';
  const anchor = attr(node, 'ac:anchor');
  if (user) {
    const id = attr(user, 'ri:account-id');
    const name = ctx.resolveUser(id);
    if (!name) ctx.warn('unresolved-user', id);
    return `@${escapeText(name ?? 'unknown-user')}`;
  }
  if (attachment) {
    const name = attr(attachment, 'ri:filename');
    const href = ctx.attachment(name, childTag(attachment, 'ri:page'));
    if (!href) ctx.warn('missing-attachment', name);
    return href ? link(body || escapeText(name), href) : body || escapeText(name);
  }
  if (page || blogPost) {
    const ref = page || blogPost;
    const title = attr(ref, 'ri:content-title');
    const target = ctx.page({ title, spaceKey: attr(ref, 'ri:space-key') });
    return link(body || escapeText(title), withAnchor(target.href, anchor));
  }
  if (space) {
    const key = attr(space, 'ri:space-key');
    return link(body || escapeText(key), `${ctx.siteUrl}/wiki/spaces/${key}`);
  }
  if (contentEntity) {
    const id = attr(contentEntity, 'ri:content-id');
    return link(body || escapeText(id), `${ctx.siteUrl}/wiki/pages/viewpage.action?pageId=${id}`);
  }
  if (url) {
    const value = attr(url, 'ri:value');
    return link(body || escapeText(value), value);
  }
  if (anchor) return link(body || escapeText(anchor), `#${anchor}`);
  if (body) return body;
  ctx.warn('unknown-macro', 'ac:link');
  return '<!-- confluence:ac:link -->';
}

function acImage(node, ctx) {
  const attachment = childTag(node, 'ri:attachment');
  const url = childTag(node, 'ri:url');
  const alt = escapeText(attr(node, 'ac:alt') || attr(node, 'ac:title'));
  if (url) return `![${alt}](${encodeLinkTarget(attr(url, 'ri:value'))})`;
  if (!attachment) return '';
  const name = attr(attachment, 'ri:filename');
  const href = ctx.attachment(name, childTag(attachment, 'ri:page'));
  if (!href) {
    ctx.warn('missing-attachment', name);
    return alt || escapeText(name);
  }
  return `![${alt}](${encodeLinkTarget(href)})`;
}

function emoticon(node) {
  return attr(node, 'ac:emoji-fallback') || EMOTICONS[attr(node, 'ac:name')] || '';
}

function inlineNode(node, ctx) {
  if (node.type === 'text') return escapeText(node.data.replace(/\s+/g, ' '));
  if (node.type === 'cdata') return escapeText(textOf(node));
  if (node.type !== 'tag') return '';
  if (isMacroTag(node.name)) return renderInlineMacro(node, ctx);
  const inner = () => renderInline(node.children, ctx);
  switch (node.name) {
    case 'code': return codeSpan(textOf(node), ctx.inTable);
    case 'br': return ctx.inTable ? '<br>' : ctx.inHeading ? ' ' : '\\\n';
    case 'sub': case 'sup': return `<${node.name}>${inner()}</${node.name}>`;
    case 'a': return attr(node, 'href') ? link(inner() || escapeText(attr(node, 'href')), attr(node, 'href')) : inner();
    case 'ac:link': return acLink(node, ctx);
    case 'ac:image': return acImage(node, ctx);
    case 'ac:emoticon': return emoticon(node);
    case 'time': return escapeText(attr(node, 'datetime'));
    case 'ac:placeholder': return '';
    case 'script': case 'style': return '';
    default: return inner();
  }
}

function renderPart(node, index, merged, ctx) {
  const kind = node.__kind;
  if (!kind) return inlineNode(node, ctx);
  return renderMark(node, kind, siblingChar(merged, index, -1), siblingChar(merged, index, 1), ctx);
}

/** Renders inline nodes to Markdown text, merging adjacent same-kind emphasis and escaping a "!" that would otherwise start an image before a link. */
export function renderInline(nodes, ctx) {
  const merged = mergeMarks(nodes ?? []);
  let result = '';
  merged.forEach((node, index) => {
    const part = renderPart(node, index, merged, ctx);
    if (result.endsWith('!') && part.startsWith('[')) result = `${result.slice(0, -1)}\\!`;
    result += part;
  });
  return result;
}
