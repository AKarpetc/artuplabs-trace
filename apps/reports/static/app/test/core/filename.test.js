import { describe, expect, it } from 'vitest';
import { renderFileName } from '../../src/core/filename.js';

const now = new Date(2026, 8, 29, 10, 0, 0);

describe('renderFileName', () => {
  it('fills the default pattern with project, local date and filter', () => {
    expect(renderFileName({ values: { project: 'RPT', filter: 'Open bugs' }, now, extension: 'xlsx' })).toBe('RPT-2026-09-29-Open-bugs.xlsx');
  });
  it('drops an empty token together with its separator', () => {
    expect(renderFileName({ values: { project: 'RPT' }, now, extension: 'xlsx' })).toBe('RPT-2026-09-29.xlsx');
  });
  it('replaces characters that filesystems forbid', () => {
    expect(renderFileName({ values: { project: 'RPT', filter: 'a/b:c*?' }, now, extension: 'xlsx' })).toBe('RPT-2026-09-29-a-b-c.xlsx');
  });
  it('keeps Cyrillic and CJK letters', () => {
    expect(renderFileName({ values: { project: 'RPT', filter: 'Отчёт 報告' }, now, extension: 'docx' })).toBe('RPT-2026-09-29-Отчёт-報告.docx');
  });
  it('marks a partial file', () => {
    expect(renderFileName({ values: { project: 'RPT' }, now, extension: 'pdf', partial: true })).toBe('RPT-2026-09-29-PARTIAL.pdf');
  });
  it('falls back to artup-report when the pattern renders empty', () => {
    expect(renderFileName({ pattern: '{filter}', values: {}, now, extension: 'xlsx' })).toBe('artup-report.xlsx');
  });
  it('ignores unknown tokens', () => {
    expect(renderFileName({ pattern: '{nope}-{project}', values: { project: 'RPT' }, now, extension: 'xlsx' })).toBe('RPT.xlsx');
  });
  it('limits the base name to 120 characters', () => {
    const name = renderFileName({ pattern: '{filter}', values: { filter: 'x'.repeat(300) }, now, extension: 'xlsx' });
    expect(name).toBe(`${'x'.repeat(120)}.xlsx`);
  });
});
