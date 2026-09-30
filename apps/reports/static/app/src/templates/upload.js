import { TEMPLATE_MAX_BYTES, TEMPLATE_MAX_UNCOMPRESSED_BYTES, TEMPLATE_PART_BYTES } from '../core/limits.js';
import { inspectTemplate } from '../infra/templateInspect.js';

const ENCODE_CHUNK = 0x2000;

/** Base64 text of bytes, encoded chunk by chunk so large files do not overflow the call stack. */
export function toBase64(bytes) {
  let text = '';
  for (let start = 0; start < bytes.length; start += ENCODE_CHUNK) {
    text += String.fromCharCode(...bytes.subarray(start, start + ENCODE_CHUNK));
  }
  return btoa(text);
}

/** Bytes of a base64 text. */
export function fromBase64(data) {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Splits bytes into base64 parts of `size` raw bytes each; the last part may be shorter. */
export function splitParts(bytes, size = TEMPLATE_PART_BYTES) {
  const parts = [];
  for (let start = 0; start < bytes.length; start += size) parts.push(toBase64(bytes.subarray(start, start + size)));
  return parts;
}

/** Joins base64 parts back into the original bytes. */
export function joinParts(parts) {
  const chunks = parts.map(fromBase64);
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Sends a template file as parts, in order, one after another, under a fresh upload id;
 * `onProgress` gets the fraction done after each part.
 */
export async function uploadParts({ id, bytes, call, onProgress = () => {}, newId = () => globalThis.crypto.randomUUID() }) {
  const parts = splitParts(bytes);
  const uploadId = newId();
  for (let index = 0; index < parts.length; index += 1) {
    await call('uploadTemplatePart', { id, uploadId, index, total: parts.length, data: parts[index] });
    onProgress((index + 1) / parts.length);
  }
}

/** Total unpacked size of a zip's entries from its directory, without unpacking; 0 when it is not a zip. */
export function unpackedSize(bytes, PizZip) {
  try {
    return Object.values(new PizZip(bytes).files).reduce((sum, entry) => sum + (entry._data?.uncompressedSize ?? 0), 0);
  } catch {
    return 0;
  }
}

/** Loads the libraries that read a Word template, only when a file is chosen. */
export async function loadInspectLibs() {
  const [{ default: PizZip }, { default: Docxtemplater }, { default: InspectModule }] = await Promise.all([
    import('pizzip'), import('docxtemplater'), import('docxtemplater/js/inspect-module.js'),
  ]);
  return { PizZip, Docxtemplater, InspectModule };
}

/** Inspects an uploaded .docx; a file that unpacks to more than 20 MB is refused before it is opened. */
export async function inspectUpload(bytes, { fieldNames = [], loadLibs = loadInspectLibs } = {}) {
  const libs = await loadLibs();
  if (bytes.length <= TEMPLATE_MAX_BYTES && unpackedSize(bytes, libs.PizZip) > TEMPLATE_MAX_UNCOMPRESSED_BYTES) {
    return { tags: [], errors: [{ kind: 'unpacked-too-large' }] };
  }
  return inspectTemplate(bytes, { fieldNames, ...libs });
}
