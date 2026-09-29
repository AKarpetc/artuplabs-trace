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

function isHardBreakNode(node) {
  return node.type === 'tag' && node.name === 'br';
}

function isBlankNode(node) {
  if (node.type === 'text') return !node.data.trim();
  if (node.type !== 'tag') return false;
  if (node.name === 'br') return false;
  return (node.children ?? []).every(isBlankNode);
}

/**
 * Removes a <br> sitting at the start (dir 1) or end (dir -1) of an inline node list, descending
 * through whitespace-only or empty elements to find it. Returns the original list, unchanged,
 * when there is nothing to remove.
 */
export function extractEdgeBreak(nodes, dir) {
  const list = nodes ?? [];
  const index = dir === 1 ? 0 : list.length - 1;
  if (index < 0 || index >= list.length) return { nodes: list, removed: false };
  const node = list[index];
  const withoutEdge = () => (dir === 1 ? list.slice(1) : list.slice(0, -1));
  if (isHardBreakNode(node)) return { nodes: withoutEdge(), removed: true };
  if (isBlankNode(node)) {
    const inner = extractEdgeBreak(withoutEdge(), dir);
    return inner.removed ? inner : { nodes: list, removed: false };
  }
  if (node.type === 'tag') {
    const inner = extractEdgeBreak(node.children, dir);
    if (!inner.removed) return { nodes: list, removed: false };
    const updated = { ...node, children: inner.nodes };
    const rest = dir === 1 ? [updated, ...list.slice(1)] : [...list.slice(0, -1), updated];
    return { nodes: rest, removed: true };
  }
  return { nodes: list, removed: false };
}
