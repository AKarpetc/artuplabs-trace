const IMG_TAG = /<img\b[^>]*>/gi;
const ATTACHMENT_URL = /\/(?:rest\/api\/[23]\/attachment\/(?:content|thumbnail)|secure\/(?:attachment|thumbnail))\/(\d+)/;
const MEDIA_SERVICES_ID = /\bdata-media-services-id\s*=\s*["']([^"']+)["']/i;

/** Rendered images in document order: each `<img>` that points to an attachment, with its own media-services id if it carries one. */
function renderedImages(html) {
  return [...String(html ?? '').matchAll(IMG_TAG)].flatMap(([tag]) => {
    const url = tag.match(ATTACHMENT_URL);
    if (!url) return [];
    const uuid = tag.match(MEDIA_SERVICES_ID);
    return [{ id: url[1], uuid: uuid ? uuid[1] : null }];
  });
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
