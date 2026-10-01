/**
 * Minimal Markdown → Confluence storage converter for the ArtUp Import I-G5 measurement
 * (atlassian/24_app4_markdown_import.md §3). Prototype only, not product code.
 *
 * Built on markdown-it 14 (MIT): CommonMark + GFM tables and strikethrough in one package, a flat
 * token stream that core rules can rewrite (task lists, alerts → panels, links → ac:link) and a
 * renderer whose rules map tokens to storage XHTML directly. It understands the conventions ArtUp
 * Export writes (alerts, <details>, <!-- confluence:x -->, .assets folders) so a round trip closes.
 *
 * markdownToStorage(markdown, ctx) — pure, no I/O. ctx:
 *   resolveLink(href)  → { kind: 'page', title, anchor } | { kind: 'attachment', filename, ownerTitle } | null
 *   resolveImage(src)  → { filename, ownerTitle } | null   (ownerTitle null = the page itself)
 */

import MarkdownIt from './node_modules/markdown-it/index.mjs';

const ALERT_TO_PANEL = { NOTE: 'info', TIP: 'tip', IMPORTANT: 'note', WARNING: 'note', CAUTION: 'warning' };
const ALERT_LINE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/;
const TASK_PREFIX = /^\[([ xX])\]\s+/;

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cdata(text) {
  return `<![CDATA[${String(text).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function xhtmlFix(html) {
  return html
    .replace(/<(br|hr)\s*>/gi, '<$1 />')
    .replace(/<a id="([^"]*)"><\/a>/g, (_, id) => `<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">${id}</ac:parameter></ac:structured-macro>`)
    .replace(/<details(?: markdown="1")?>\s*<summary>([\s\S]*?)<\/summary>/g, (_, title) => `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">${title}</ac:parameter><ac:rich-text-body>`)
    .replace(/<\/details>/g, '</ac:rich-text-body></ac:structured-macro>')
    .replace(/<!--\s*confluence:([\w.-]+)\s*-->/g, (_, name) => `<ac:structured-macro ac:name="${name}" />`)
    .replace(/<!--[\s\S]*?-->/g, '');
}

function findClose(tokens, from, type) {
  const level = tokens[from].level;
  for (let i = from + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === type && tokens[i].level === level) return i;
  }
  return -1;
}

function markTaskLists(state) {
  const { tokens } = state;
  tokens.forEach((open, i) => {
    if (open.type !== 'bullet_list_open') return;
    const close = findClose(tokens, i, 'bullet_list_close');
    const items = [];
    for (let j = i + 1; j < close; j += 1) {
      if (tokens[j].type === 'list_item_open' && tokens[j].level === open.level + 1) items.push(j);
    }
    const firstInline = (j) => (tokens[j + 1]?.type === 'paragraph_open' && tokens[j + 2]?.type === 'inline' ? tokens[j + 2] : null);
    const all = items.length > 0 && items.every((j) => TASK_PREFIX.test(firstInline(j)?.children?.[0]?.content ?? ''));
    if (!all) return;
    open.meta = { ...open.meta, task: true };
    tokens[close].meta = { ...tokens[close].meta, task: true };
    for (const j of items) {
      const inline = firstInline(j);
      const text = inline.children[0];
      const [, mark] = TASK_PREFIX.exec(text.content);
      text.content = text.content.replace(TASK_PREFIX, '');
      tokens[j].meta = { ...tokens[j].meta, task: mark.toLowerCase() === 'x' ? 'complete' : 'incomplete' };
      tokens[findClose(tokens, j, 'list_item_close')].meta = { task: true };
    }
  });
}

function markAlerts(state) {
  const { tokens } = state;
  tokens.forEach((open, i) => {
    if (open.type !== 'blockquote_open') return;
    const inline = tokens[i + 2];
    if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') return;
    const kids = inline.children ?? [];
    const head = ALERT_LINE.exec(kids[0]?.content ?? '');
    if (!head || kids[0].type !== 'text' || (kids[1] && kids[1].type !== 'softbreak')) return;
    let rest = kids.slice(2);
    let title = '';
    if (rest[0]?.type === 'strong_open' && rest[1]?.type === 'text' && rest[2]?.type === 'strong_close' && (!rest[3] || rest[3].type === 'softbreak')) {
      title = rest[1].content;
      rest = rest.slice(4);
    }
    inline.children = rest;
    if (rest.length === 0) {
      tokens[i + 1].hidden = true;
      tokens[i + 3].hidden = true;
    }
    const close = findClose(tokens, i, 'blockquote_close');
    open.meta = { panel: ALERT_TO_PANEL[head[1]], title };
    tokens[close].meta = { panel: ALERT_TO_PANEL[head[1]] };
  });
}

function rewriteLinks(state, md) {
  const ctx = state.env.ctx;
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const out = [];
    const kids = block.children;
    for (let i = 0; i < kids.length; i += 1) {
      const t = kids[i];
      if (t.type !== 'link_open') {
        out.push(t);
        continue;
      }
      let depth = 1;
      let j = i + 1;
      for (; j < kids.length; j += 1) {
        if (kids[j].type === 'link_open') depth += 1;
        if (kids[j].type === 'link_close' && --depth === 0) break;
      }
      const inner = kids.slice(i + 1, j);
      const target = ctx.resolveLink(t.attrGet('href'));
      if (!target) {
        out.push(...kids.slice(i, j + 1));
        i = j;
        continue;
      }
      const plainText = inner.length === 1 && inner[0].type === 'text' ? inner[0].content : null;
      const resource = target.kind === 'page'
        ? `<ri:page ri:content-title="${xml(target.title)}" />`
        : `<ri:attachment ri:filename="${xml(target.filename)}">${target.ownerTitle ? `<ri:page ri:content-title="${xml(target.ownerTitle)}" />` : ''}</ri:attachment>`;
      const defaultText = target.kind === 'page' ? target.title : target.filename;
      let body = '';
      if (plainText !== null) {
        if (plainText !== defaultText) body = `<ac:plain-text-link-body>${cdata(plainText)}</ac:plain-text-link-body>`;
      } else if (inner.length) {
        body = `<ac:link-body>${xhtmlFix(md.renderer.renderInline(inner, md.options, state.env))}</ac:link-body>`;
      }
      const anchor = target.anchor ? ` ac:anchor="${xml(target.anchor)}"` : '';
      const html = new state.Token('html_inline', '', 0);
      html.content = `<ac:link${anchor}>${resource}${body}</ac:link>`;
      out.push(html);
      i = j;
    }
    block.children = out;
  }
}

function codeMacro(content, language) {
  const lang = language ? `<ac:parameter ac:name="language">${xml(language)}</ac:parameter>` : '';
  return `<ac:structured-macro ac:name="code">${lang}<ac:plain-text-body>${cdata(content.replace(/\n+$/, ''))}</ac:plain-text-body></ac:structured-macro>\n`;
}

/** markdown-it instance configured for storage output. */
export function createConverter() {
  const md = new MarkdownIt('default', { html: true, xhtmlOut: true, linkify: false, breaks: false });
  md.core.ruler.push('artup_tasks', markTaskLists);
  md.core.ruler.push('artup_alerts', markAlerts);
  md.core.ruler.push('artup_links', (state) => rewriteLinks(state, md));
  const rules = md.renderer.rules;
  rules.fence = (tokens, i) => codeMacro(tokens[i].content, tokens[i].info.trim().split(/\s+/)[0]);
  rules.code_block = (tokens, i) => codeMacro(tokens[i].content, '');
  rules.html_block = (tokens, i) => xhtmlFix(tokens[i].content);
  rules.html_inline = (tokens, i) => xhtmlFix(tokens[i].content);
  rules.image = (tokens, i, options, env) => {
    const token = tokens[i];
    const alt = token.children?.length ? md.renderer.renderInlineAsText(token.children, options, env) : token.content;
    const altAttr = alt ? ` ac:alt="${xml(alt)}"` : '';
    const src = token.attrGet('src');
    const found = env.ctx.resolveImage(src);
    if (!found) return `<ac:image${altAttr}><ri:url ri:value="${xml(src)}" /></ac:image>`;
    const owner = found.ownerTitle ? `<ri:page ri:content-title="${xml(found.ownerTitle)}" />` : '';
    return `<ac:image${altAttr}><ri:attachment ri:filename="${xml(found.filename)}">${owner}</ri:attachment></ac:image>`;
  };
  const taskIds = (env) => {
    env.taskId = (env.taskId ?? 0) + 1;
    return env.taskId;
  };
  const wrap = (name, fallback) => (tokens, i, options, env, self) => {
    const t = tokens[i];
    if (name === 'bullet_list_open' && t.meta?.task) return '<ac:task-list>\n';
    if (name === 'bullet_list_close' && t.meta?.task) return '</ac:task-list>\n';
    if (name === 'list_item_open' && t.meta?.task) return `<ac:task><ac:task-id>${taskIds(env)}</ac:task-id><ac:task-status>${t.meta.task}</ac:task-status><ac:task-body>`;
    if (name === 'list_item_close' && t.meta?.task) return '</ac:task-body></ac:task>\n';
    if (name === 'blockquote_open' && t.meta?.panel) {
      const title = t.meta.title ? `<ac:parameter ac:name="title">${xml(t.meta.title)}</ac:parameter>` : '';
      return `<ac:structured-macro ac:name="${t.meta.panel}">${title}<ac:rich-text-body>\n`;
    }
    if (name === 'blockquote_close' && t.meta?.panel) return '</ac:rich-text-body></ac:structured-macro>\n';
    return fallback ? fallback(tokens, i, options, env, self) : self.renderToken(tokens, i, options);
  };
  for (const name of ['bullet_list_open', 'bullet_list_close', 'list_item_open', 'list_item_close', 'blockquote_open', 'blockquote_close']) {
    rules[name] = wrap(name, rules[name]);
  }
  return md;
}

const shared = createConverter();

/** Markdown body (no front matter) → storage XHTML. */
export function markdownToStorage(markdown, ctx) {
  return shared.render(markdown, { ctx });
}

/** Splits ArtUp Export front matter (YAML subset: "key: value", "key: []", "key:\n  - item"); returns { data, body }. */
export function splitFrontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  let listKey = null;
  const scalar = (raw) => {
    const v = raw.trim();
    if (v.startsWith('"')) return JSON.parse(v.replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'));
    if (v === '[]') return [];
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  for (const line of match[1].split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(scalar(item[1]));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2] === '') {
      listKey = kv[1];
      data[listKey] = [];
    } else {
      listKey = null;
      data[kv[1]] = scalar(kv[2]);
    }
  }
  return { data, body: text.slice(match[0].length) };
}
