import { fitImage, isImageIntact, readImageInfo } from '../core/imageSize.js';
import { buildTemplateData } from '../core/templateData.js';
import { blocksToOoxml } from './ooxml.js';
import { DELIMITERS, parseTag } from './templateTags.js';

export { DELIMITERS, normalizeTag, parseTag } from './templateTags.js';

const CONTENT_WIDTH_PX = 600;
const EMU_PER_PX = 9525;
const EXTENSIONS = { png: 'png', jpg: 'jpeg', gif: 'gif' };
const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };
const IMAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const EMPTY_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
const WORD_PART = /^word\/(?!_rels\/)[^/]+\.xml$/;

function acceptImage(found) {
  if (!found?.bytes) return null;
  const bytes = found.bytes instanceof Uint8Array ? found.bytes : new Uint8Array(found.bytes);
  const info = readImageInfo(bytes);
  if (!info || !EXTENSIONS[info.type]) return null;
  if (info.type !== 'gif' && !isImageIntact(bytes, info.type)) return null;
  return {
    bytes,
    extension: EXTENSIONS[info.type],
    width: found.width > 0 ? found.width : info.width,
    height: found.height > 0 ? found.height : info.height,
  };
}

function addRelationships(zip, part, numbers) {
  const relsPath = part.replace(/^word\//, 'word/_rels/') + '.rels';
  let rels = (zip.file(relsPath)?.asText() ?? EMPTY_RELS).replace(/<Relationships\b([^>]*?)\s*\/>/, '<Relationships$1></Relationships>');
  for (const [n, extension] of numbers) {
    if (rels.includes(`Id="rIdArtup${n}"`)) continue;
    const entry = `<Relationship Id="rIdArtup${n}" Type="${IMAGE_RELATIONSHIP}" Target="media/artup-${n}.${extension}"/>`;
    rels = rels.replace('</Relationships>', `${entry}</Relationships>`);
  }
  zip.file(relsPath, rels);
}

function addContentTypes(zip, extensions) {
  const file = zip.file('[Content_Types].xml');
  if (!file) return;
  let types = file.asText();
  for (const extension of extensions) {
    if (new RegExp(`<Default\\s[^>]*Extension="${extension}"`, 'i').test(types)) continue;
    types = types.replace('</Types>', `<Default Extension="${extension}" ContentType="${MIME[extension]}"/></Types>`);
  }
  zip.file('[Content_Types].xml', types);
}

/** Images of one render: allocates `rIdArtup<n>` lazily per attachment actually shown, then writes media, relationships and content types. */
export function createImageRegistry(images, { first = 1 } = {}) {
  const used = new Map();
  const rejected = new Set();
  const ref = (attachmentId, maxWidthPx = CONTENT_WIDTH_PX) => {
    let entry = used.get(attachmentId);
    if (!entry) {
      if (rejected.has(attachmentId)) return null;
      const accepted = acceptImage(images?.get(attachmentId));
      if (!accepted) {
        rejected.add(attachmentId);
        return null;
      }
      entry = { ...accepted, n: first + used.size };
      used.set(attachmentId, entry);
    }
    const size = fitImage(entry, maxWidthPx);
    return { rId: `rIdArtup${entry.n}`, cx: Math.round(size.width * EMU_PER_PX), cy: Math.round(size.height * EMU_PER_PX), n: entry.n };
  };
  const apply = (zip) => {
    if (!used.size) return;
    const byNumber = new Map([...used.values()].map((e) => [e.n, e]));
    const shown = new Map();
    for (const file of zip.file(WORD_PART)) {
      const numbers = new Set([...file.asText().matchAll(/r:embed="rIdArtup(\d+)"/g)].map((m) => Number(m[1])));
      const mine = [...numbers].filter((n) => byNumber.has(n)).map((n) => [n, byNumber.get(n).extension]);
      mine.forEach(([n]) => shown.set(n, byNumber.get(n)));
      if (mine.length) addRelationships(zip, file.name, mine);
    }
    for (const e of shown.values()) zip.file(`word/media/artup-${e.n}.${e.extension}`, e.bytes);
    if (shown.size) addContentTypes(zip, new Set([...shown.values()].map((e) => e.extension)));
  };
  return { ref, apply };
}

function firstFreeNumber(zip) {
  const taken = [
    ...Object.keys(zip.files).map((name) => /^word\/media\/artup-(\d+)\./.exec(name)?.[1]),
    ...zip.file(/^word\/_rels\/.+\.rels$/).flatMap((f) => [...f.asText().matchAll(/Id="rIdArtup(\d+)"/g)].map((m) => m[1])),
  ].filter(Boolean).map(Number);
  return taken.length ? Math.max(...taken) + 1 : 1;
}

function renumberDrawings(zip) {
  let id = 0;
  const names = zip.file(WORD_PART).map((f) => f.name).sort();
  for (const name of names) {
    const text = zip.file(name).asText();
    if (!text.includes('<wp:docPr')) continue;
    zip.file(name, text.replace(/<wp:docPr\b[^>]*>/g, (tag) => {
      id += 1;
      return tag.replace(/\sid="[^"]*"/, ` id="${id}"`);
    }));
  }
}

/** Fills a customer .docx template with issues; rich tags become OOXML, built only when a tag shows them, with embedded images. */
export function renderDocxTemplate({ template, issues, meta, images, labels, PizZip, Docxtemplater }) {
  const zip = new PizZip(template);
  const registry = createImageRegistry(images, { first: firstFreeNumber(zip) });
  const toXml = (blocks) => {
    let xml = null;
    return () => {
      xml ??= blocksToOoxml(blocks, { image: registry.ref, labels, contentWidthPx: CONTENT_WIDTH_PX });
      return xml;
    };
  };
  const data = buildTemplateData({ issues, meta, toXml, labels });
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true, linebreaks: true, delimiters: DELIMITERS, parser: parseTag, nullGetter: () => '', errorLogging: false,
  });
  doc.render(data);
  const out = doc.getZip();
  registry.apply(out);
  renumberDrawings(out);
  return out.generate({ type: 'uint8array', compression: 'DEFLATE' });
}
