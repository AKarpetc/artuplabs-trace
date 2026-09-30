import { TEMPLATE_MAX_BYTES } from '../core/limits.js';
import { checkTemplateTags } from '../core/placeholders.js';
import { DELIMITERS, normalizeTag, parseTag } from '../render/templateTags.js';

const KINDS = { loop: 'loop', rawxml: 'raw' };

function toTags(parts) {
  return (parts ?? []).map((part) => ({
    name: normalizeTag(part.value),
    kind: KINDS[part.module] ?? 'value',
    children: part.module === 'loop' ? toTags(part.subparsed) : [],
  }));
}

function syntaxErrors(error) {
  const list = Array.isArray(error?.properties?.errors) ? error.properties.errors : [error];
  const known = list.filter((e) => e?.properties?.explanation !== undefined || e?.properties?.id !== undefined);
  if (!known.length) return null;
  return known.map(({ properties: p }) => {
    const tag = p.xtag ?? p.openingtag ?? p.id;
    return {
      kind: 'syntax',
      ...(tag === undefined ? {} : { tag: normalizeTag(tag) }),
      detail: String(p.explanation ?? p.id ?? ''),
    };
  });
}

function openZip(bytes, PizZip) {
  try {
    const zip = new PizZip(bytes);
    return zip.file('word/document.xml') ? zip : null;
  } catch {
    return null;
  }
}

const notDocx = () => ({ tags: [], errors: [{ kind: 'not-docx' }] });

/** Reads the tags of an uploaded .docx template and lists what is wrong with it; never throws. */
export function inspectTemplate(bytes, { fieldNames = [], PizZip, Docxtemplater, InspectModule }) {
  if ((bytes?.byteLength ?? bytes?.length ?? 0) > TEMPLATE_MAX_BYTES) return { tags: [], errors: [{ kind: 'too-large' }] };
  const zip = openZip(bytes, PizZip);
  if (!zip) return notDocx();
  try {
    const inspect = InspectModule();
    new Docxtemplater(zip, { modules: [inspect], paragraphLoop: true, delimiters: DELIMITERS, parser: parseTag, errorLogging: false });
    const tags = toTags(inspect.getAllStructuredTags());
    return { tags, errors: checkTemplateTags(tags, { fieldNames }) };
  } catch (error) {
    const errors = syntaxErrors(error);
    return errors ? { tags: [], errors } : notDocx();
  }
}
