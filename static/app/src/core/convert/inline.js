import { encodeLinkTarget } from '../links.js';
import { attr, childTag, textOf } from './parse.js';
import { codeSpan, escapeHtml, escapeText } from './escape.js';
import { renderInlineMacro } from './macros.js';

const EMOTICONS = {
  smile: '🙂', sad: '🙁', cheeky: '😛', laugh: '😀', wink: '😉', 'thumbs-up': '👍', 'thumbs-down': '👎',
  information: 'ℹ️', tick: '✅', cross: '❌', warning: '⚠️', plus: '➕', minus: '➖', question: '❓',
  'light-on': '💡', 'light-off': '💡', 'yellow-star': '⭐', 'red-star': '⭐', 'green-star': '⭐', 'blue-star': '⭐', heart: '❤️',
};

function wrap(mark, inner) {
  const match = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return match[2] ? `${match[1]}${mark}${match[2]}${mark}${match[3]}` : inner;
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
  const attachment = childTag(node, 'ri:attachment');
  const user = childTag(node, 'ri:user');
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
    return href ? link(body || escapeText(name), href) : body || escapeText(name);
  }
  if (page) {
    const title = attr(page, 'ri:content-title');
    const target = ctx.page({ title, spaceKey: attr(page, 'ri:space-key') });
    return link(body || escapeText(title), withAnchor(target.href, anchor));
  }
  if (anchor) return link(body || escapeText(anchor), `#${anchor}`);
  return body;
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
  const inner = () => renderInline(node.children, ctx);
  switch (node.name) {
    case 'strong': case 'b': return wrap('**', inner());
    case 'em': case 'i': return wrap('*', inner());
    case 's': case 'del': case 'strike': return wrap('~~', inner());
    case 'code': return codeSpan(textOf(node), ctx.inTable);
    case 'br': return ctx.inTable ? '<br>' : '\\\n';
    case 'sub': case 'sup': return `<${node.name}>${inner()}</${node.name}>`;
    case 'a': return attr(node, 'href') ? link(inner() || escapeText(attr(node, 'href')), attr(node, 'href')) : inner();
    case 'ac:link': return acLink(node, ctx);
    case 'ac:image': return acImage(node, ctx);
    case 'ac:emoticon': return emoticon(node);
    case 'ac:structured-macro': return renderInlineMacro(node, ctx);
    case 'time': return escapeText(attr(node, 'datetime'));
    case 'ac:placeholder': return '';
    case 'script': case 'style': return '';
    default: return inner();
  }
}

/** Renders inline nodes to Markdown text. */
export function renderInline(nodes, ctx) {
  return (nodes ?? []).map((node) => inlineNode(node, ctx)).join('');
}

export { escapeHtml };
