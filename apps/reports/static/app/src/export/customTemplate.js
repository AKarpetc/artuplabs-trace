import { inspectTemplate } from '../infra/templateInspect.js';
import { joinParts, loadInspectLibs } from '../templates/upload.js';

/** Reads a stored Word template part by part (0…parts−1, one after another) and joins the bytes; null when it has no parts. */
export async function readTemplateBytes(template, getPart) {
  const count = template.parts ?? 0;
  if (count < 1) return null;
  const parts = [];
  for (let index = 0; index < count; index += 1) parts.push((await getPart(template.id, index)).data);
  return joinParts(parts);
}

/** A stored Word template ready to run: its bytes and the tag tree read from those bytes, whatever its stored placeholders hold. */
export async function withTemplateTags(template, bytes, { loadLibs = loadInspectLibs } = {}) {
  if (!bytes) return { ...template, bytes };
  const { tags } = inspectTemplate(bytes, await loadLibs());
  return { ...template, bytes, placeholders: tags };
}
