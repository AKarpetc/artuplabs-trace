// @vitest-environment node
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_MAX_BYTES } from '../../src/core/limits.js';
import { inspectTemplate } from '../../src/infra/templateInspect.js';
import { makeDocx, para } from '../fixtures/makeDocx.js';

const libs = { PizZip, Docxtemplater, InspectModule };
const inspect = (body, extra = {}) => inspectTemplate(makeDocx({ body, ...extra }), { fieldNames: ['Story Points'], ...libs });

describe('inspectTemplate', () => {
  it('returns the tag tree of a valid template without errors', () => {
    expect(inspect(`${para('{{#issues}}{{key}}')}${para('{{@description}}')}${para('{{/issues}}')}`)).toEqual({
      tags: [{ name: 'issues', kind: 'loop', children: [{ name: 'key', kind: 'value', children: [] }, { name: 'description', kind: 'raw', children: [] }] }],
      errors: [],
    });
  });

  it('includes the tags of headers', () => {
    expect(inspect(para('{{summary}}'), { header: para('{{jql}}') }).tags.map((t) => t.name).sort()).toEqual(['jql', 'summary']);
  });

  it('reports an unclosed loop with its tag and the explanation', () => {
    expect(inspect(para('{{#issues}}{{key}}')).errors).toEqual([{ kind: 'syntax', tag: 'issues', detail: 'The loop with tag "issues" is unclosed' }]);
  });

  it('reports a rich tag that shares its paragraph with other text', () => {
    const { errors } = inspect(para('Text {{@description}}'));
    expect(errors.map(({ kind, tag }) => ({ kind, tag }))).toEqual([{ kind: 'syntax', tag: 'description' }]);
  });

  it('suggests the nearest tag for a misspelt one', () => {
    expect(inspect(para('{{summry}}')).errors).toEqual([{ kind: 'unknown-tag', tag: 'summry', suggestion: 'summary' }]);
  });

  it('accepts a known custom field', () => {
    expect(inspect(para('{{field "Story Points"}}')).errors).toEqual([]);
  });

  it('accepts a custom field written with typographic quotes', () => {
    expect(inspect(para('{{field “Story Points”}}'))).toEqual({ tags: [{ name: 'field "Story Points"', kind: 'value', children: [] }], errors: [] });
  });

  it('reports bytes that are not a zip as not a Word file', () => {
    expect(inspectTemplate(new Uint8Array([1, 2, 3, 4]), { fieldNames: [], ...libs })).toEqual({ tags: [], errors: [{ kind: 'not-docx' }] });
  });

  it('reports a zip without a Word document as not a Word file', () => {
    const zip = new PizZip();
    zip.file('hello.txt', 'hi');
    expect(inspectTemplate(zip.generate({ type: 'uint8array' }), { fieldNames: [], ...libs })).toEqual({ tags: [], errors: [{ kind: 'not-docx' }] });
  });

  it('rejects a file over the size limit without reading it', () => {
    const huge = new Uint8Array(TEMPLATE_MAX_BYTES + 1);
    const PizZipSpy = function PizZipSpy() { throw new Error('parsed'); };
    expect(inspectTemplate(huge, { fieldNames: [], PizZip: PizZipSpy, Docxtemplater, InspectModule })).toEqual({ tags: [], errors: [{ kind: 'too-large' }] });
  });

  it('never throws when the template library fails unexpectedly', () => {
    const Broken = function Broken() { throw new TypeError('boom'); };
    expect(inspectTemplate(makeDocx({ body: para('x') }), { fieldNames: [], PizZip, Docxtemplater: Broken, InspectModule }).errors.map((e) => e.kind)).toEqual(['not-docx']);
  });
});
