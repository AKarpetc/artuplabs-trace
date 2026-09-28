import { attachmentFileName } from './slug.js';

/** Relative POSIX path from one exported file to another. */
export function relativePath(fromFile, toFile) {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
}

const NBSP = String.fromCharCode(160);
const BREAKING_CHARS = new RegExp(`[ ()<>|${NBSP}]`, 'g');
const linkEncoder = new TextEncoder();

function percentEncode(char) {
  return Array.from(linkEncoder.encode(char)).map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
}

/** Percent-encodes the characters that break a Markdown link target or a GFM table row (as their UTF-8 bytes), keeping letters of every script. */
export function encodeLinkTarget(href) {
  return String(href).replace(BREAKING_CHARS, percentEncode);
}

/** Folder holding a page's attachments: page.md → page.assets. */
export function assetsDir(pagePath) {
  return pagePath.replace(/\.md$/, '.assets');
}

/** Stable path per attachment id: slugged names next to the page, duplicates numbered in id order. */
export function planAttachments(pagePath, attachments, options) {
  const dir = assetsDir(pagePath);
  const taken = new Set();
  const result = new Map();
  const sorted = [...attachments].sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
  for (const attachment of sorted) {
    const file = attachmentFileName(attachment.title, options);
    const dot = file.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
    let candidate = file;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${base}-${n}${ext}`;
    taken.add(candidate.toLowerCase());
    result.set(attachment.id, `${dir}/${candidate}`);
  }
  return result;
}
