// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createZipWriter, readManifestFromFile } from '../../src/infra/zip.js';

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Reads each entry's DOS mod-date (year/month/day) from a zip's central directory. */
function readDosDates(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  const count = view.getUint16(eocd + 10, true);
  const dates = {};
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i += 1) {
    const modDate = view.getUint16(offset + 14, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    dates[name] = { year: ((modDate >> 9) & 0x7f) + 1980, month: (modDate >> 5) & 0xf, day: modDate & 0x1f };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return dates;
}

describe('createZipWriter', () => {
  it('writes text files, a Cyrillic-named text file and a binary file that read back byte-identical', async () => {
    const writer = createZipWriter();
    const mtime = new Date('2026-01-01T00:00:00Z');
    writer.addText('README.md', '# Hello\n', mtime);
    writer.addText('заметки/привет.md', '# Привет\n', mtime);
    const binary = new Uint8Array([0, 1, 2, 253, 254, 255]);
    writer.addBinary('assets/logo.png', binary, mtime);
    const blob = await writer.finish();
    const entries = unzipSync(await blobBytes(blob));
    expect(Object.keys(entries).sort()).toEqual(['README.md', 'assets/logo.png', 'заметки/привет.md'].sort());
    expect(new TextDecoder().decode(entries['README.md'])).toBe('# Hello\n');
    expect(new TextDecoder().decode(entries['заметки/привет.md'])).toBe('# Привет\n');
    expect([...entries['assets/logo.png']]).toEqual([...binary]);
  });

  it('reports the accumulated byte size after finish', async () => {
    const writer = createZipWriter();
    expect(writer.size()).toBe(0);
    writer.addText('a.md', 'hello', new Date());
    await writer.finish();
    expect(writer.size()).toBeGreaterThan(0);
  });

  it('clamps an out-of-range mtime (new Date(0)) to 1980-01-01 for both text and binary entries', async () => {
    const writer = createZipWriter();
    writer.addText('a.md', 'hi', new Date(0));
    writer.addBinary('b.bin', new Uint8Array([1]), new Date(0));
    const blob = await writer.finish();
    const dates = readDosDates(await blobBytes(blob));
    expect(dates['a.md']).toEqual({ year: 1980, month: 1, day: 1 });
    expect(dates['b.bin']).toEqual({ year: 1980, month: 1, day: 1 });
  });
});

describe('readManifestFromFile', () => {
  it('reads the manifest from a zip that has it at the root', async () => {
    const zipped = zipSync({ 'export-manifest.json': strToU8('{"format":"artup-export"}') });
    const file = new Blob([zipped]);
    expect(await readManifestFromFile(file)).toBe('{"format":"artup-export"}');
  });

  it('reads the manifest from a zip where it sits inside one top folder', async () => {
    const zipped = zipSync({ 'my-space/export-manifest.json': strToU8('{"format":"artup-export"}') });
    const file = new Blob([zipped]);
    expect(await readManifestFromFile(file)).toBe('{"format":"artup-export"}');
  });

  it('reads the manifest text from a plain .json Blob', async () => {
    const file = new Blob([strToU8('{"format":"artup-export"}')], { type: 'application/json' });
    expect(await readManifestFromFile(file)).toBe('{"format":"artup-export"}');
  });

  it('returns null for a zip without a manifest', async () => {
    const zipped = zipSync({ 'README.md': strToU8('# Hi\n') });
    const file = new Blob([zipped]);
    expect(await readManifestFromFile(file)).toBeNull();
  });
});
