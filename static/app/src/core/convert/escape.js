/** Escapes Markdown-significant characters in inline text. */
export function escapeText(text) {
  return text.replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`);
}

/** Escapes a line start that Markdown would read as a heading, quote, list item or ordered list. */
export function escapeLineStart(line) {
  if (/^\s*(#{1,6}|>|[-+*])(\s|$)/.test(line)) return line.replace(/^(\s*)/, '$1\\');
  return line.replace(/^(\s*\d+)([.)])(\s|$)/, '$1\\$2$3');
}

/** Escapes text for HTML element content and attributes. */
export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline code span whose fence is longer than any backtick run inside. */
export function codeSpan(text, inTable) {
  const runs = [...text.matchAll(/`+/g)].map((m) => m[0].length);
  const fence = '`'.repeat(runs.length ? Math.max(...runs) + 1 : 1);
  const body = inTable ? text.replace(/\|/g, '\\|') : text;
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

/** Fenced code block with a fence longer than any backtick run in the code. */
export function fence(code, language) {
  const runs = [...code.matchAll(/`{3,}/g)].map((m) => m[0].length);
  const marks = '`'.repeat(runs.length ? Math.max(...runs) + 1 : 3);
  const lang = String(language ?? '').replace(/[^\w+#.-]/g, '');
  return `${marks}${lang}\n${code.replace(/\n+$/, '')}\n${marks}`;
}

/** Prefixes every line with "> " ("> " lines stay ">" when empty). */
export function quote(text) {
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}
