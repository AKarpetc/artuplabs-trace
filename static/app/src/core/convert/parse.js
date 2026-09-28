import { parseDocument } from 'htmlparser2';

/** Parses Confluence storage format (XHTML with ac:/ri: tags, CDATA) into a DOM tree. */
export function parseStorage(xhtml) {
  return parseDocument(String(xhtml ?? ''), {
    recognizeCDATA: true, recognizeSelfClosing: true, decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true,
  });
}

/** Attribute value or ''. */
export function attr(node, name) {
  return node?.attribs?.[name] ?? '';
}

/** Element children of a node. */
export function elements(node) {
  return (node?.children ?? []).filter((c) => c.type === 'tag');
}

/** First child element with the given tag name, or null. */
export function childTag(node, name) {
  return elements(node).find((c) => c.name === name) ?? null;
}

/** Concatenated text of a node, CDATA included. */
export function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  return (node.children ?? []).map(textOf).join('');
}

/** Value of a structured-macro parameter, trimmed; '' when absent. */
export function param(macro, name) {
  const found = elements(macro).find((c) => c.name === 'ac:parameter' && attr(c, 'ac:name') === name);
  return found ? textOf(found).trim() : '';
}
