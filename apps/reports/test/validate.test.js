import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../src/templates/validate.js';

const columns = { scope: 'user', name: 'My columns', format: 'xlsx', kind: 'columns', columns: ['key', 'summary'] };
const docx = { scope: 'project', scopeId: 'RPT', name: 'Contract', format: 'docx', kind: 'docx', placeholders: [{ tag: 'summary' }] };

describe('validateTemplate', () => {
  it('accepts a minimal columns template and returns the cleaned metadata', () => {
    expect(validateTemplate(columns)).toEqual({ scope: 'user', scopeId: '', name: 'My columns', format: 'xlsx', kind: 'columns', columns: ['key', 'summary'] });
  });

  it('accepts a docx template', () => {
    expect(validateTemplate(docx)).toEqual({ scope: 'project', scopeId: 'RPT', name: 'Contract', format: 'docx', kind: 'docx', placeholders: [{ tag: 'summary' }] });
  });

  it('accepts a full columns template with every optional field', () => {
    const full = { ...columns, id: '0b0e6f2a-3c1d-4e5f-8a9b-0c1d2e3f4a5b', rowMode: 'worklog', groupBy: 'status', summary: true, paper: 'A4', fileNamePattern: '{date}-issues' };
    expect(validateTemplate(full)).toEqual({ ...full, scopeId: '' });
  });

  it('accepts a layout template for PDF', () => {
    const layout = { scope: 'site', name: 'Sprint', format: 'pdf', kind: 'layout', layout: 'sprint', paper: 'LETTER' };
    expect(validateTemplate(layout)).toEqual({ ...layout, scopeId: 'site' });
  });

  it('strips unknown and server-owned top-level keys instead of rejecting', () => {
    const dirty = { ...columns, evil: 1, authorId: 'x', authorName: 'y', parts: 9, size: 9, updatedAt: 'z' };
    expect(validateTemplate(dirty)).toEqual({ ...columns, scopeId: '' });
  });

  it('ignores a client-sent scopeId for the user scope', () => {
    expect(validateTemplate({ ...columns, scopeId: 'someone-else' }).scopeId).toEqual('');
  });

  it.each([
    ['an empty name', { ...columns, name: '' }],
    ['a blank name', { ...columns, name: '   ' }],
    ['a name over 80 characters', { ...columns, name: 'x'.repeat(81) }],
    ['a non-string name', { ...columns, name: 5 }],
    ['an unknown format', { ...columns, format: 'csv' }],
    ['an unknown kind', { ...columns, kind: 'magic' }],
    ['an unknown scope', { ...columns, scope: 'org' }],
    ['an unknown rowMode', { ...columns, rowMode: 'changelog' }],
    ['more than 100 columns', { ...columns, columns: Array.from({ length: 101 }, (_, i) => `c${i}`) }],
    ['a column ref over 200 characters', { ...columns, columns: ['x'.repeat(201)] }],
    ['a non-string column ref', { ...columns, columns: [5] }],
    ['columns kind without columns', { ...columns, columns: undefined }],
    ['placeholders over 50 000 JSON characters', { ...docx, placeholders: ['x'.repeat(50000)] }],
    ['a fileNamePattern over 200 characters', { ...columns, fileNamePattern: 'x'.repeat(201) }],
    ['a project scopeId in lower case', { ...docx, scopeId: 'rpt' }],
    ['a project scopeId with a colon', { ...docx, scopeId: 'RPT:X' }],
    ['a missing project scopeId', { ...docx, scopeId: undefined }],
    ['an id that is not a UUID', { ...columns, id: 'tpl:user:x' }],
    ['a columns kind with the docx format', { ...columns, format: 'docx' }],
    ['a docx kind with the pdf format', { ...docx, format: 'pdf' }],
    ['a layout kind with an unknown layout', { scope: 'site', name: 'L', format: 'pdf', kind: 'layout', layout: 'poster' }],
    ['an unknown paper', { ...columns, paper: 'A3' }],
    ['a non-boolean summary', { ...columns, summary: 'yes' }],
    ['a kind sent as an array', { ...docx, kind: ['docx'] }],
    ['a format sent as an array', { ...docx, format: ['docx'] }],
    ['a scope sent as an array', { ...columns, scope: ['user'] }],
    ['a rowMode sent as an array', { ...columns, rowMode: ['issue'] }],
    ['a paper sent as an array', { ...columns, paper: ['A4'] }],
    ['a layout sent as an array', { scope: 'site', name: 'L', format: 'pdf', kind: 'layout', layout: ['list'] }],
    ['a kind named constructor', { ...columns, kind: 'constructor' }],
    ['a kind named __proto__', { ...columns, kind: '__proto__' }],
    ['a kind named toString', { ...columns, kind: 'toString' }],
    ['a non-object template', 'template'],
    ['a null template', null],
  ])('rejects %s with bad-request', (_, input) => {
    expect(validateTemplate(input)).toEqual('bad-request');
  });
});
