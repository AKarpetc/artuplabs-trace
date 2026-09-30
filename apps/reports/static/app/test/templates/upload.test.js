// @vitest-environment node
import { readFileSync } from 'node:fs';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import PizZip from 'pizzip';
import { describe, expect, it, vi } from 'vitest';
import { TEMPLATE_MAX_UNCOMPRESSED_BYTES, TEMPLATE_PART_BYTES } from '../../src/core/limits.js';
import { inspectTemplate } from '../../src/infra/templateInspect.js';
import { fromBase64 as decodeBase64, inspectUpload, joinParts, splitParts, toBase64, uploadParts, unpackedSize } from '../../src/templates/upload.js';
import { prepareIssue } from '../../src/core/prepare.js';
import { renderDocxTemplate } from '../../src/render/docxTemplate.js';
import { SITE, catalog, formats, makeIssue } from '../fixtures/issues.js';
import { makeDocx, para } from '../fixtures/makeDocx.js';

const libs = { PizZip, Docxtemplater, InspectModule };
const random = (length) => Uint8Array.from({ length }, (_, i) => (i * 7919 + (i >> 3) * 31) % 256);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('splitParts', () => {
  it('splits 400 000 bytes into parts of 153 600, 153 600 and 92 800 bytes', () => {
    const parts = splitParts(random(400000), 150 * 1024);
    expect(parts.map((part) => decodeBase64(part).length)).toEqual([153600, 153600, 92800]);
  });

  it('cuts at the template part size by default', () => {
    expect(splitParts(random(TEMPLATE_PART_BYTES + 1)).map((part) => decodeBase64(part).length)).toEqual([TEMPLATE_PART_BYTES, 1]);
  });

  it('gives no parts for no bytes', () => {
    expect(splitParts(new Uint8Array())).toEqual([]);
  });

  it('joins the parts back into the original bytes', () => {
    const bytes = random(400000);
    expect(joinParts(splitParts(bytes))).toEqual(bytes);
  });

  it('encodes 2 MB without overflowing the call stack', () => {
    const bytes = random(2 * 1024 * 1024);
    expect(toBase64(bytes)).toEqual(Buffer.from(bytes).toString('base64'));
  });
});

describe('uploadParts', () => {
  it('sends every part in order under one new upload id and reports progress', async () => {
    const sent = [];
    const call = vi.fn(async (key, payload) => {
      sent.push(payload.index);
      return { stored: payload.index };
    });
    const progress = [];
    await uploadParts({ id: 'tpl', bytes: random(400000), call, onProgress: (fraction) => progress.push(fraction), newId: () => 'up-1' });
    expect(call.mock.calls.map(([key, { id, uploadId, index, total, data }]) => [key, id, uploadId, index, total, decodeBase64(data).length])).toEqual([
      ['uploadTemplatePart', 'tpl', 'up-1', 0, 3, 153600],
      ['uploadTemplatePart', 'tpl', 'up-1', 1, 3, 153600],
      ['uploadTemplatePart', 'tpl', 'up-1', 2, 3, 92800],
    ]);
    expect(sent).toEqual([0, 1, 2]);
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('waits for a part before sending the next', async () => {
    let open = 0;
    let peak = 0;
    const call = async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((done) => { setTimeout(done, 5); });
      open -= 1;
    };
    await uploadParts({ id: 'tpl', bytes: random(400000), call });
    expect(peak).toBe(1);
  });

  it('uses a different upload id for every upload', async () => {
    const ids = [];
    const call = async (key, payload) => {
      ids.push(payload.uploadId);
    };
    await uploadParts({ id: 'tpl', bytes: random(10), call });
    await uploadParts({ id: 'tpl', bytes: random(10), call });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toMatch(UUID);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('stops at the first part that fails', async () => {
    const call = vi.fn(async (key, { index }) => {
      if (index === 1) throw new Error('internal');
    });
    await expect(uploadParts({ id: 'tpl', bytes: random(400000), call })).rejects.toThrow('internal');
    expect(call).toHaveBeenCalledTimes(2);
  });
});

function bomb(size) {
  const zip = new PizZip();
  zip.file('word/document.xml', '<w:document/>');
  zip.file('padding.bin', new Uint8Array(size));
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('inspectUpload', () => {
  const loadLibs = async () => libs;

  it('adds up the unpacked size of the entries without unpacking them', () => {
    expect(unpackedSize(bomb(1024), PizZip)).toBe(1024 + '<w:document/>'.length);
  });

  it('refuses a file that unpacks to more than 20 MB', async () => {
    const bytes = bomb(TEMPLATE_MAX_UNCOMPRESSED_BYTES + 1);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    expect(await inspectUpload(bytes, { loadLibs })).toEqual({ tags: [], errors: [{ kind: 'unpacked-too-large' }] });
  });

  it('inspects a file that unpacks to less than 20 MB', async () => {
    const result = await inspectUpload(makeDocx({ body: para('{{summry}}') }), { fieldNames: [], loadLibs });
    expect(result.errors).toEqual([{ kind: 'unknown-tag', tag: 'summry', suggestion: 'summary' }]);
  });

  it('reports bytes that are not a zip as not a Word file', async () => {
    expect(await inspectUpload(new Uint8Array([1, 2, 3]), { loadLibs })).toEqual({ tags: [], errors: [{ kind: 'not-docx' }] });
  });
});

describe('example template', () => {
  it('has no errors and uses the tags a report needs', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../public/example-template.docx', import.meta.url)));
    const { tags, errors } = inspectTemplate(bytes, { fieldNames: [], ...libs });
    expect(errors).toEqual([]);
    const names = tags.flatMap(function walk(tag) {
      return [tag.name, ...tag.children.flatMap(walk)];
    });
    expect(names).toEqual(expect.arrayContaining(['jql', 'exportedAt', 'partial', 'partialBanner', 'issues', 'description', 'comments']));
  });

  it('renders a row and a details block for every issue', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../public/example-template.docx', import.meta.url)));
    const issues = ['RPT-1', 'RPT-2'].map((key) => prepareIssue(makeIssue({ key }), { catalog, siteUrl: SITE, formats, fieldNames: [] }));
    const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: 'today', count: 2, siteUrl: SITE, title: 'Report' };
    const out = renderDocxTemplate({ template: bytes, issues, meta, images: new Map(), labels: { imageUnavailable: '' }, PizZip, Docxtemplater });
    const xml = new PizZip(out).file('word/document.xml').asText();
    expect(['RPT-1', 'RPT-2'].map((key) => xml.split(key).length - 1)).toEqual([2, 2]);
  });
});
