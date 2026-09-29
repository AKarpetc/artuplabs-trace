import { describe, it, expect } from 'vitest';
import { toCsv, capCsv, collectPages } from '../../src/core/csv';

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

describe('capCsv', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ key: `R-${i}`, summary: 'x'.repeat(20) }));

  it('returns the full CSV untouched when under the limit', () => {
    const { csv, truncated } = capCsv(cols, rows, 1_000_000);
    expect(csv).toBe(toCsv(cols, rows));
    expect(truncated).toBe(false);
  });

  it('halves rows until the text fits and reports truncated', () => {
    const fullLength = toCsv(cols, rows).length;
    const { csv, truncated } = capCsv(cols, rows, Math.floor(fullLength / 2));
    expect(csv.length).toBeLessThanOrEqual(Math.floor(fullLength / 2));
    expect(truncated).toBe(true);
  });

  it('falls back to header-only when even one row is too big', () => {
    const bigRows = [{ key: 'R-1', summary: 'x'.repeat(1000) }];
    const { csv, truncated } = capCsv(cols, bigRows, 10);
    expect(csv).toBe(toCsv(cols, []));
    expect(truncated).toBe(true);
  });

  it('reports not truncated for an empty row set', () => {
    const { csv, truncated } = capCsv(cols, [], 1_000_000);
    expect(csv).toBe(toCsv(cols, []));
    expect(truncated).toBe(false);
  });
});

describe('collectPages', () => {
  function pager(total, size) {
    const all = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
    return async (after) => all.filter((r) => r.id > Number(after || 0)).slice(0, size);
  }

  it('exactly the cap is not truncated', async () => {
    const res = await collectPages(pager(10, 5), (r) => r.id, 10);
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(false);
  });

  it('more rows than the cap are cut to the cap and marked truncated', async () => {
    const res = await collectPages(pager(11, 5), (r) => r.id, 10);
    expect(res.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.truncated).toBe(true);
  });

  it('fewer rows than the cap are returned whole', async () => {
    const res = await collectPages(pager(3, 5), (r) => r.id, 10);
    expect(res).toEqual({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: false });
  });
});
