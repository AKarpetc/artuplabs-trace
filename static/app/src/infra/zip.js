import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { MANIFEST_FILE } from '../core/manifest.js';

/** Streaming zip writer; text is deflated, binaries are stored as-is. Returns the zip as a Blob. */
export function createZipWriter() {
  const parts = [];
  let bytes = 0;
  let done;
  let failed;
  const finished = new Promise((resolve, reject) => {
    done = resolve;
    failed = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed(error);
      return;
    }
    parts.push(chunk);
    bytes += chunk.length;
    if (final) done(new Blob(parts, { type: 'application/zip' }));
  });
  const add = (file, data) => {
    zip.add(file);
    file.push(data, true);
  };
  return {
    addText(path, text, mtime) {
      add(new ZipDeflate(path, { level: 6, mtime }), strToU8(text));
    },
    addBinary(path, data, mtime) {
      const file = new ZipPassThrough(path);
      file.mtime = mtime;
      add(file, data);
    },
    finish() {
      zip.end();
      return finished;
    },
    size: () => bytes,
  };
}

/** Manifest text from a dropped previous export (zip or .json), or null when it has none. */
export async function readManifestFromFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  if (!isZip) return new TextDecoder().decode(data);
  const entries = unzipSync(data, { filter: (f) => f.name === MANIFEST_FILE || f.name.endsWith(`/${MANIFEST_FILE}`) });
  const name = Object.keys(entries).sort((a, b) => a.length - b.length)[0];
  return name ? new TextDecoder().decode(entries[name]) : null;
}
