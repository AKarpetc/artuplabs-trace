import { parseStorage } from './parse.js';
import { renderBlocks } from './blocks.js';

/** Fixed set of warning kinds the converter reports, shared with the UI. */
export const WARNING_KINDS = ['unknown-macro', 'dynamic-macro', 'complex-table', 'missing-attachment', 'adf-extension', 'unresolved-user'];

/** Unique account ids mentioned in a storage document, in order of appearance. */
export function collectMentions(xhtml) {
  return [...new Set([...String(xhtml ?? '').matchAll(/ri:account-id="([^"]+)"/g)].map((m) => m[1]))];
}

/** Converts Confluence storage format to Markdown (flavor gfm, mdx or mkdocs; gfm by default) and reports links, attachments and warnings. */
export function storageToMarkdown(xhtml, context) {
  const links = new Set();
  const attachments = new Set();
  const warnings = [];
  const ctx = {
    siteUrl: context.siteUrl,
    flavor: context.flavor ?? 'gfm',
    inTable: false,
    resolveUser: context.resolveUser,
    childLinks: context.childLinks,
    warn: (kind, detail) => warnings.push({ kind, detail: String(detail ?? '') }),
    page: (ref) => {
      const target = context.resolvePage(ref);
      if (target.id) links.add(target.id);
      return target;
    },
    attachment: (name, ownerNode) => {
      const owner = ownerNode ? { title: ownerNode.attribs?.['ri:content-title'] ?? '', spaceKey: ownerNode.attribs?.['ri:space-key'] ?? '' } : undefined;
      const href = context.resolveAttachment(name, owner);
      if (href && !owner) attachments.add(name);
      return href;
    },
  };
  const markdown = renderBlocks(parseStorage(xhtml).children, ctx).replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: `${markdown}\n`, links: [...links], attachments: [...attachments], mentions: collectMentions(xhtml), warnings };
}
