import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/core/csv';

const cols = [{ key: 'key', title: 'Key' }, { key: 'summary', title: 'Summary' }];

describe('toCsv', () => {
  it('writes BOM, header and rows with CRLF', () => {
    expect(toCsv(cols, [{ key: 'R-1', summary: 'Plain' }])).toBe('﻿Key,Summary\r\nR-1,Plain\r\n');
  });

  it('quotes commas, quotes and newlines', () => {
    const out = toCsv(cols, [{ key: 'R-2', summary: 'a, "b"\nc' }]);
    expect(out).toBe('﻿Key,Summary\r\nR-2,"a, ""b""\nc"\r\n');
  });

  it('neutralises formula prefixes', () => {
    const out = toCsv(cols, [{ key: 'R-3', summary: '=HYPERLINK("x")' }, { key: 'R-4', summary: '+1' }, { key: 'R-5', summary: '-2' }, { key: 'R-6', summary: '@a' }]);
    expect(out.split('\r\n').slice(1, 5)).toEqual([
      `R-3,"'=HYPERLINK(""x"")"`,
      "R-4,'+1",
      "R-5,'-2",
      "R-6,'@a",
    ]);
  });

  it('keeps non-ASCII text and renders null as empty', () => {
    expect(toCsv(cols, [{ key: 'R-7', summary: null }, { key: 'R-8', summary: 'Требование ✓' }]))
      .toBe('﻿Key,Summary\r\nR-7,\r\nR-8,Требование ✓\r\n');
  });
});
