const TAG = /<(\/?)(a|img)\b[^>]*>/gi;
const ATTACHMENT_URL = /\/(?:rest\/api\/[23]\/attachment\/(?:content|thumbnail)|secure\/(?:attachment|thumbnail))\/(\d+)/;
const MEDIA_SERVICES_ID = /\bdata-media-services-id\s*=\s*["']([^"']+)["']/i;

/** Rendered media in document order: an attachment `<a>` (file card or thumbnail link) or a bare attachment `<img>`; an `<img>` of the same attachment inside that `<a>` only adds its media-services id. */
function renderedImages(html) {
  const found = [];
  let anchor = null;
  for (const [tag, closing, name] of String(html ?? '').matchAll(TAG)) {
    const isAnchor = name.toLowerCase() === 'a';
    if (closing) {
      if (isAnchor) anchor = null;
      continue;
    }
    const url = tag.match(ATTACHMENT_URL);
    const uuid = tag.match(MEDIA_SERVICES_ID)?.[1] ?? null;
    if (isAnchor) {
      anchor = url ? { id: url[1], uuid } : null;
      if (anchor) found.push(anchor);
    } else if (url && anchor?.id === url[1]) {
      anchor.uuid = anchor.uuid ?? uuid;
    } else if (url) {
      found.push({ id: url[1], uuid });
    }
  }
  return found;
}

/** Maps ADF media nodes to the issue's attachment ids: by media-services id, then rendered image order, then file name. */
export function createMediaResolver(attachments = [], renderedHtml = '') {
  const known = new Set(attachments.map((a) => String(a.id)));
  const byName = new Map();
  for (const a of attachments) {
    byName.set(a.filename, [...(byName.get(a.filename) ?? []), String(a.id)]);
  }
  const rendered = renderedImages(renderedHtml);
  const byUuid = new Map();
  for (const image of rendered) {
    if (image.uuid && known.has(image.id) && !byUuid.has(image.uuid)) byUuid.set(image.uuid, image.id);
  }
  const used = new Set();
  const accept = (id) => (id && known.has(id) ? id : null);
  return (attrs, index) => {
    const named = byName.get(attrs?.alt ?? '') ?? [];
    const candidate = accept(byUuid.get(attrs?.id))
      ?? accept(rendered[index]?.id)
      ?? accept(named.find((id) => !used.has(id)))
      ?? accept(named[0]);
    if (candidate) used.add(candidate);
    return candidate;
  };
}
