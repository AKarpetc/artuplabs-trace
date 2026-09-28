export const MANIFEST_FILE = 'export-manifest.json';
export const DELETED_FILE = 'export-deleted.txt';
export const MANIFEST_FORMAT = 'artup-export';
export const MANIFEST_VERSION = 1;
const PATH_OPTIONS = ['preset', 'ordering', 'fileNames', 'attachments'];

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => a.id.length - b.id.length || byText(a.id, b.id);
const byNumeric = (a, b) => a.length - b.length || byText(a, b);

/** Serializes the export state; pages sorted by path, no timestamps, so unchanged content gives identical text. */
export function buildManifest({ siteUrl, spaceKey, rootPageId, options, pages, warnings }) {
  const manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    source: { siteUrl, spaceKey, rootPageId: rootPageId ?? null },
    options: Object.fromEntries(PATH_OPTIONS.map((key) => [key, options[key]])),
    pages: [...pages].sort((a, b) => byText(a.path, b.path)).map((p) => ({
      id: p.id, title: p.title, parentId: p.parentId ?? null, version: p.version, path: p.path, name: p.name, weight: p.weight,
      links: [...new Set(p.links)].sort(byNumeric),
      attachments: [...p.attachments].sort(byId).map((a) => ({ id: a.id, version: a.version, path: a.path })),
    })),
    warnings: [...warnings]
      .map((w) => ({ pageId: w.pageId, kind: w.kind, detail: w.detail }))
      .sort((a, b) => byNumeric(a.pageId, b.pageId) || byText(a.kind, b.kind) || byText(a.detail, b.detail)),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isValidAttachment(a) {
  return Boolean(a) && typeof a === 'object'
    && typeof a.id === 'string' && typeof a.path === 'string' && typeof a.version === 'number';
}

function isValidPage(p) {
  return Boolean(p) && typeof p === 'object'
    && typeof p.id === 'string' && typeof p.path === 'string' && typeof p.name === 'string'
    && typeof p.version === 'number' && typeof p.weight === 'number'
    && Array.isArray(p.links) && Array.isArray(p.attachments) && p.attachments.every(isValidAttachment);
}

/** Parses and validates a manifest text. */
export function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (data?.format !== MANIFEST_FORMAT || !Array.isArray(data.pages)) return { ok: false, error: 'not-manifest' };
  if (data.version > MANIFEST_VERSION) return { ok: false, error: 'newer-version' };
  if (!data.pages.every(isValidPage)) return { ok: false, error: 'not-manifest' };
  return { ok: true, manifest: data };
}

/** Page id → file name used in the previous export. */
export function previousNames(manifest) {
  return new Map(manifest.pages.map((p) => [p.id, p.name]));
}

/** True when the manifest was made from the same site, space and root page. */
export function sameSource(manifest, { siteUrl, spaceKey, rootPageId }) {
  const s = manifest.source ?? {};
  return s.siteUrl === siteUrl && s.spaceKey === spaceKey && (s.rootPageId ?? null) === (rootPageId ?? null);
}

/** True when the options that shape paths match. */
export function sameOptions(manifest, options) {
  return PATH_OPTIONS.every((key) => manifest.options?.[key] === options[key]);
}
