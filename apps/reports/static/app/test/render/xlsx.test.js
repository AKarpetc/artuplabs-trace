// @vitest-environment node
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderXlsx } from '../../src/render/xlsx.js';

const labels = {
  'summary.jql': 'JQL', 'summary.exportedAt': 'Exported at', 'summary.exportedBy': 'Exported by', 'summary.count': 'Count',
  'summary.byStatus': 'By status', 'summary.byAssignee': 'By assignee', 'summary.byPriority': 'By priority', 'summary.issues': 'Issues',
  partialBanner: (done, total) => `Partial: ${done} of ${total}`,
};
const text = (value) => ({ kind: 'text', value, text: value });
const columns = [{ id: 'key', header: 'Key' }, { id: 'summary', header: 'Summary' }];
const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '2026-09-29 10:00', now: new Date('2026-09-29T10:00:00Z'), count: 2, title: 'My report' };
const summary = { total: 2, byStatus: [['Done', 1], ['Open', 1]], byAssignee: [['Ann', 2]], byPriority: [['High', 2]] };
const assembled = (rows, extra = {}) => ({ summarySheet: null, sheets: [{ name: 'Issues', columns, rows }], ...extra });

async function render(args) {
  const bytes = await renderXlsx({ meta, labels, summary: null, ExcelJS, tzOffset: () => 0, ...args });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return wb;
}
const firstCell = async (cell, args = {}) => {
  const wb = await render({ assembled: assembled([[cell]]), ...args });
  return wb.getWorksheet('Issues').getCell(2, 1);
};

describe('renderXlsx data sheet', () => {
  it('writes the column headers as the first row', async () => {
    const ws = (await render({ assembled: assembled([[text('RPT-1'), text('a')]]) })).getWorksheet('Issues');
    expect(ws.getRow(1).values.slice(1)).toEqual(['Key', 'Summary']);
  });

  it('makes header cells bold with the header fill', async () => {
    const cell = (await render({ assembled: assembled([]) })).getWorksheet('Issues').getCell(1, 1);
    expect({ bold: cell.font.bold, fill: cell.fill.fgColor.argb }).toEqual({ bold: true, fill: 'FFF4F5F7' });
  });

  it('freezes the header row', async () => {
    const ws = (await render({ assembled: assembled([[text('a'), text('b')]]) })).getWorksheet('Issues');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('puts an autofilter over the header row', async () => {
    const ws = (await render({ assembled: assembled([[text('a'), text('b')]]) })).getWorksheet('Issues');
    expect(ws.autoFilter).toBe('A1:B1');
  });

  it('keeps header, frozen view and filter on a sheet without rows', async () => {
    const ws = (await render({ assembled: assembled([]) })).getWorksheet('Issues');
    expect({ header: ws.getRow(1).values.slice(1), view: ws.views[0].ySplit, filter: ws.autoFilter }).toEqual({
      header: ['Key', 'Summary'], view: 1, filter: 'A1:B1',
    });
  });

  it('reads a link cell back as text with a hyperlink', async () => {
    const cell = await firstCell({ kind: 'link', value: 'https://s.atlassian.net/browse/RPT-1', text: 'RPT-1' });
    expect(cell.value).toEqual({ text: 'RPT-1', hyperlink: 'https://s.atlassian.net/browse/RPT-1' });
  });

  it('stores a date at UTC midnight with a date format', async () => {
    const date = new Date('2026-03-05T00:00:00Z');
    const cell = await firstCell({ kind: 'date', value: date, text: '2026-03-05' });
    expect({ value: cell.value, fmt: cell.numFmt }).toEqual({ value: date, fmt: 'yyyy-mm-dd' });
  });

  it('stores a datetime as the wall-clock time of the given offset', async () => {
    const cell = await firstCell({ kind: 'datetime', value: new Date('2026-03-05T07:15:00Z'), text: '' }, { tzOffset: () => -180 });
    expect({ value: cell.value, fmt: cell.numFmt }).toEqual({ value: new Date('2026-03-05T10:15:00Z'), fmt: 'yyyy-mm-dd hh:mm' });
  });

  it('stores a duration in hours with two decimals', async () => {
    const cell = await firstCell({ kind: 'duration', value: 5400, text: '' });
    expect({ value: cell.value, fmt: cell.numFmt }).toEqual({ value: 1.5, fmt: '0.00' });
  });

  it('formats a percent number as a percentage', async () => {
    const cell = await firstCell({ kind: 'number', value: 0.25, text: '25%', percent: true });
    expect({ value: cell.value, fmt: cell.numFmt }).toEqual({ value: 0.25, fmt: '0%' });
  });

  it('leaves an empty cell empty', async () => {
    const cell = await firstCell({ kind: 'empty', value: null, text: '' });
    expect(cell.value).toBeNull();
  });

  it('sizes columns between 8 and 60 following the longest text', async () => {
    const rows = [[text('K'), text('x'.repeat(200))], [text('K'), text('y'.repeat(20))]];
    const ws = (await render({ assembled: assembled(rows) })).getWorksheet('Issues');
    expect([ws.getColumn(1).width, ws.getColumn(2).width]).toEqual([8, 60]);
  });

  it('widens a column to the longest sampled text', async () => {
    const ws = (await render({ assembled: assembled([[text('K'), text('z'.repeat(20))]]) })).getWorksheet('Issues');
    expect(ws.getColumn(2).width).toBe(22);
  });

  it('puts the partial banner first and freezes below the header', async () => {
    const wb = await render({ assembled: assembled([[text('a'), text('b')]]), meta: { ...meta, partial: { done: 1, total: 2 } } });
    const ws = wb.getWorksheet('Issues');
    expect({ banner: ws.getCell(1, 1).value, header: ws.getCell(2, 1).value, ySplit: ws.views[0].ySplit, filter: ws.autoFilter }).toEqual({
      banner: 'Partial: 1 of 2', header: 'Key', ySplit: 2, filter: 'A2:B2',
    });
  });
});

describe('renderXlsx summary sheet', () => {
  const withSummary = () => render({ assembled: assembled([], { summarySheet: 'Summary' }), summary });

  it('places the summary sheet first', async () => {
    const wb = await withSummary();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Issues']);
  });

  it('lists JQL, exported-at, exported-by and count rows', async () => {
    const ws = (await withSummary()).getWorksheet('Summary');
    const rows = [1, 2, 3, 4].map((n) => ws.getRow(n).values.slice(1));
    expect(rows).toEqual([['JQL', 'project = RPT'], ['Exported at', '2026-09-29 10:00'], ['Exported by', 'Ann'], ['Count', 2]]);
  });

  it('writes the three count tables with bold headers', async () => {
    const ws = (await withSummary()).getWorksheet('Summary');
    const tables = [6, 10, 13].map((n) => ({ row: ws.getRow(n).values.slice(1), bold: ws.getCell(n, 1).font.bold }));
    expect(tables).toEqual([
      { row: ['By status', 'Issues'], bold: true },
      { row: ['By assignee', 'Issues'], bold: true },
      { row: ['By priority', 'Issues'], bold: true },
    ]);
  });

  it('writes the count rows under a table header', async () => {
    const ws = (await withSummary()).getWorksheet('Summary');
    expect([7, 8].map((n) => ws.getRow(n).values.slice(1))).toEqual([['Done', 1], ['Open', 1]]);
  });

  it('adds no summary sheet when the summary is null', async () => {
    const wb = await render({ assembled: assembled([]), summary: null });
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Issues']);
  });

  it('puts the partial banner on the summary sheet when there is one', async () => {
    const wb = await render({ assembled: assembled([], { summarySheet: 'Summary' }), summary, meta: { ...meta, partial: { done: 1, total: 2 } } });
    expect(wb.getWorksheet('Summary').getCell(1, 1).value).toBe('Partial: 1 of 2');
  });
});

describe('renderXlsx workbook', () => {
  it('sets creator, title, time and a description with the JQL and the issue count', async () => {
    const wb = await render({ assembled: assembled([]) });
    expect({ creator: wb.creator, title: wb.title, created: wb.created.toISOString(), description: wb.description }).toEqual({
      creator: 'Ann', title: 'My report', created: '2026-09-29T10:00:00.000Z', description: 'JQL: project = RPT\nCount: 2',
    });
  });

  it('renders 10 000 rows by 15 columns in under 5 seconds', async () => {
    const cols = Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, header: `Column ${i}` }));
    const rows = Array.from({ length: 10000 }, (_, r) => cols.map((c, i) => (i % 3 === 0 ? { kind: 'number', value: r, text: String(r) } : text(`row ${r} col ${i}`))));
    const started = performance.now();
    const bytes = await renderXlsx({ assembled: { summarySheet: null, sheets: [{ name: 'Issues', columns: cols, rows }] }, summary: null, meta, labels, ExcelJS, tzOffset: () => 0 });
    const elapsed = performance.now() - started;
    expect({ bytes: bytes.length > 0, fast: elapsed < 5000 }).toEqual({ bytes: true, fast: true });
  }, 20000);
});
