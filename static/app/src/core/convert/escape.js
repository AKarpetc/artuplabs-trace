const MARKDOWN_SPECIAL = /[\\`*_[\]<>|~]/g;
const MDX_SPECIAL = /[\\`*_[\]<>|~{}]/g;
const BRACE_REFERENCES = { '{': '&#x7B;', '}': '&#x7D;' };

/** Escapes Markdown-significant characters in inline text, including "&" that starts an HTML/XML entity; the mdx flavor also escapes braces. */
export function escapeText(text, flavor) {
  const marked = text.replace(flavor === 'mdx' ? MDX_SPECIAL : MARKDOWN_SPECIAL, (c) => `\\${c}`);
  return marked.replace(/&(?=#?[0-9a-zA-Z]+;)/g, '\\&');
}

/** Escapes a line start that Markdown would read as a heading, quote, list item, ordered list, setext underline or thematic break; the mdx flavor also escapes a directive fence and an ESM import/export. */
export function escapeLineStart(line, flavor) {
  if (/^\s*(#{1,6}|>|[-+*])(\s|$)/.test(line)) return line.replace(/^(\s*)/, '$1\\');
  if (/^\s*(=+|-{2,}|\*{3,}|_{3,})\s*$/.test(line)) return line.replace(/^(\s*)/, '$1\\');
  if (flavor === 'mdx' && /^\s*::/.test(line)) return line.replace(/^(\s*)/, '$1\\');
  if (flavor === 'mdx' && /^\s*(import|export)(\s|$)/.test(line)) return line.replace(/^(\s*)([ie])/, (m, space, c) => `${space}&#${c.charCodeAt(0)};`);
  return line.replace(/^(\s*\d+)([.)])(\s|$)/, '$1\\$2$3');
}

/** Escapes text for HTML element content and attributes; the mdx flavor also turns braces into character references. */
export function escapeHtml(text, flavor) {
  const escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return flavor === 'mdx' ? escaped.replace(/[{}]/g, (c) => BRACE_REFERENCES[c]) : escaped;
}

/** Placeholder for content the converter cannot render: an HTML comment, or an MDX expression comment for the mdx flavor. */
export function placeholder(name, flavor) {
  return flavor === 'mdx' ? `{/* confluence:${name} */}` : `<!-- confluence:${name} -->`;
}

/** HTML line break, self-closed for the mdx flavor. */
export function lineBreakTag(flavor) {
  return flavor === 'mdx' ? '<br />' : '<br>';
}

/** Inline code span whose fence is longer than any backtick run inside; newlines flatten to spaces, empty text yields ''. */
export function codeSpan(text, inTable) {
  const flat = text.replace(/\r\n?|\n/g, ' ');
  if (!flat) return '';
  const runs = [...flat.matchAll(/`+/g)].map((m) => m[0].length);
  const fence = '`'.repeat(runs.length ? Math.max(...runs) + 1 : 1);
  const body = inTable ? flat.replace(/\|/g, '\\|') : flat;
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

/** Fenced code block with a fence longer than any backtick run in the code; line endings normalise to "\n". */
export function fence(code, language) {
  const normalised = code.replace(/\r\n?/g, '\n');
  const runs = [...normalised.matchAll(/`{3,}/g)].map((m) => m[0].length);
  const marks = '`'.repeat(runs.length ? Math.max(...runs) + 1 : 3);
  const lang = String(language ?? '').replace(/[^\w+#.-]/g, '');
  return `${marks}${lang}\n${normalised.replace(/\n+$/, '')}\n${marks}`;
}

/** Prefixes every line with "> " ("> " lines stay ">" when empty). */
export function quote(text) {
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}
