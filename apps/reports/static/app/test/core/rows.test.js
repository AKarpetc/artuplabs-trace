import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { assembleSheets, createRowBuilder, createSummary, sheetName } from '../../src/core/rows.js';

const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string', system: 'summary' } },
  { id: 'status', name: 'Status', schema: { type: 'status', system: 'status' } },
  { id: 'description', name: 'Description', schema: { type: 'string', system: 'description' } },
  { id: 'worklog', name: 'Log Work', schema: { type: 'array', system: 'worklog' } },
]);
const labels = {
  'column.key': 'Key', 'column.worklog.author': 'Author', 'column.worklog.started': 'Started', 'column.worklog.hours': 'Hours', 'column.worklog.comment': 'Comment',
  'column.comment.author': 'Author', 'column.comment.created': 'Created', 'column.comment.body': 'Comment',
  none: '(none)', unassigned: 'Unassigned', 'sheet.issues': 'Issues', 'sheet.summary': 'Summary',
};
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const issue = (key, fields) => ({ id: key, key, fields });

describe('createRowBuilder', () => {
  const site = 'https://s.atlassian.net';
  it('builds one row per issue with a key link and typed cells, dropping missing columns', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'summary', 'description', 'customfield_99999'], rowMode: 'issue', groupBy: null }, catalog, siteUrl: site, labels });
    expect(b.columns).toEqual([{ id: 'key', header: 'Key' }, { id: 'summary', header: 'Summary' }, { id: 'description', header: 'Description' }]);
    expect(b.missing).toEqual(['customfield_99999']);
    expect(b.rowsFor(issue('RPT-1', { summary: 'S', description: adf('D') }))).toEqual([{ group: '', cells: [
      { kind: 'link', value: `${site}/browse/RPT-1`, text: 'RPT-1' },
      { kind: 'text', value: 'S', text: 'S' },
      { kind: 'text', value: 'D', text: 'D' },
    ] }]);
  });
  it('builds one row per worklog and none for an issue without worklogs', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'worklog.author', 'worklog.started', 'worklog.hours', 'worklog.comment'], rowMode: 'worklog', groupBy: null }, catalog, siteUrl: site, labels });
    const rows = b.rowsFor(issue('RPT-1', { worklog: { total: 1, worklogs: [{ author: { displayName: 'Ann' }, started: '2026-09-29T10:00:00.000+0000', timeSpentSeconds: 5400, comment: adf('fix') }] } }));
    expect(rows[0].cells.slice(1)).toEqual([
      { kind: 'text', value: 'Ann', text: 'Ann' },
      { kind: 'datetime', value: new Date('2026-09-29T10:00:00.000Z'), text: '2026-09-29T10:00:00.000+0000' },
      { kind: 'number', value: 1.5, text: '1.5' },
      { kind: 'text', value: 'fix', text: 'fix' },
    ]);
    expect(b.rowsFor(issue('RPT-2', { worklog: { total: 0, worklogs: [] } }))).toEqual([]);
  });
  it('builds one row per comment', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'comment.author', 'comment.body'], rowMode: 'comment', groupBy: null }, catalog, siteUrl: site, labels });
    const rows = b.rowsFor(issue('RPT-1', { comment: { total: 2, comments: [{ author: { displayName: 'A' }, body: adf('x') }, { author: { displayName: 'B' }, body: adf('y') }] } }));
    expect(rows.map((r) => r.cells[2].text)).toEqual(['x', 'y']);
  });
  it('groups by the text of the group field, empty values under (none)', () => {
    const b = createRowBuilder({ template: { columns: ['key'], rowMode: 'issue', groupBy: 'status' }, catalog, siteUrl: site, labels });
    expect(b.rowsFor(issue('RPT-1', { status: { name: 'Done' } }))[0].group).toBe('Done');
    expect(b.rowsFor(issue('RPT-2', {}))[0].group).toBe('(none)');
  });
  it('reports a column named like an inherited property as missing and produces no cell', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'constructor'], rowMode: 'issue', groupBy: null }, catalog, siteUrl: site, labels });
    expect(b.missing).toEqual(['constructor']);
    expect(b.rowsFor(issue('RPT-1', {}))[0].cells).toEqual([{ kind: 'link', value: `${site}/browse/RPT-1`, text: 'RPT-1' }]);
  });
  it('truncates text longer than the Excel cell limit', () => {
    const b = createRowBuilder({ template: { columns: ['summary'], rowMode: 'issue', groupBy: null }, catalog, siteUrl: site, labels });
    expect(b.rowsFor(issue('RPT-1', { summary: 'x'.repeat(40000) }))[0].cells[0].text.length).toBeLessThanOrEqual(32767);
  });
});

describe('createSummary', () => {
  it('counts by status, assignee and priority, largest first', () => {
    const s = createSummary(labels);
    s.add(issue('1', { status: { name: 'Done' }, assignee: { displayName: 'Ann' }, priority: { name: 'High' } }));
    s.add(issue('2', { status: { name: 'Done' } }));
    s.add(issue('3', { status: { name: 'Open' }, assignee: { displayName: 'Ann' } }));
    expect(s.result()).toEqual({
      total: 3,
      byStatus: [['Done', 2], ['Open', 1]],
      byAssignee: [['Ann', 2], ['Unassigned', 1]],
      byPriority: [['(none)', 2], ['High', 1]],
    });
  });
});

describe('sheetName', () => {
  it('replaces forbidden characters and keeps names unique ignoring case', () => {
    const taken = new Set();
    expect([sheetName('A/B', taken), sheetName('A-B', taken), sheetName('a-b', taken)]).toEqual(['A-B', 'A-B (2)', 'a-b (3)']);
  });
  it('limits names to 31 characters including the suffix', () => {
    const taken = new Set();
    sheetName('x'.repeat(40), taken);
    expect(sheetName('x'.repeat(40), taken)).toBe(`${'x'.repeat(27)} (2)`);
  });
  it('avoids the reserved name History and empty names', () => {
    const taken = new Set();
    expect([sheetName('History', taken), sheetName("''", taken)]).toEqual(['History (2)', 'Sheet']);
  });
});

describe('row builder edge cases', () => {
  const site = 'https://s.atlassian.net';
  it('reports an unresolved group field as missing and does not group', () => {
    const b = createRowBuilder({ template: { columns: ['key'], rowMode: 'issue', groupBy: 'customfield_99999' }, catalog, siteUrl: site, labels });
    expect([b.missing, b.grouped, b.rowsFor(issue('RPT-1', {}))[0].group]).toEqual([['customfield_99999'], false, '']);
  });
  it('marks the builder grouped when the group field resolves', () => {
    const b = createRowBuilder({ template: { columns: ['key'], rowMode: 'issue', groupBy: 'status' }, catalog, siteUrl: site, labels });
    expect(b.grouped).toBe(true);
  });
  it('gives empty cells for item columns of the other row mode', () => {
    const b = createRowBuilder({ template: { columns: ['comment.author', 'worklog.author'], rowMode: 'worklog', groupBy: null }, catalog, siteUrl: site, labels });
    const rows = b.rowsFor(issue('RPT-1', { worklog: { worklogs: [{ author: { displayName: 'Ann' } }] } }));
    expect(rows[0].cells).toEqual([{ kind: 'empty', value: null, text: '' }, { kind: 'text', value: 'Ann', text: 'Ann' }]);
  });
  it('gives empty cells for item columns in issue mode', () => {
    const b = createRowBuilder({ template: { columns: ['worklog.hours'], rowMode: 'issue', groupBy: null }, catalog, siteUrl: site, labels });
    expect(b.rowsFor(issue('RPT-1', {}))[0].cells).toEqual([{ kind: 'empty', value: null, text: '' }]);
  });
});

describe('sheetName edge cases', () => {
  it('strips apostrophes left at the edges after trimming', () => {
    expect(sheetName(" 'Done' ", new Set())).toBe('Done');
  });
  it('strips an apostrophe exposed by the length cut', () => {
    expect(sheetName(`${'x'.repeat(30)}'y`, new Set())).toBe('x'.repeat(30));
  });
  it('replaces every forbidden character', () => {
    expect(sheetName('a]b:c*d?e\\f[g/h', new Set())).toBe('a-b-c-d-e-f-g-h');
  });
  it('keeps 31 characters and cuts 32 to 31', () => {
    expect([sheetName('y'.repeat(31), new Set()), sheetName('z'.repeat(32), new Set())]).toEqual(['y'.repeat(31), 'z'.repeat(31)]);
  });
  it('does not leave half a surrogate pair at the cut', () => {
    expect(sheetName(`${'x'.repeat(30)}\u{1F600}`, new Set())).toBe('x'.repeat(30));
  });
  it('keeps a suffixed name free of edge apostrophes', () => {
    const taken = new Set();
    const raw = `${'x'.repeat(26)}'ab`;
    sheetName(raw, taken);
    expect(sheetName(raw, taken)).toBe(`${'x'.repeat(26)} (2)`);
  });
});

describe('assembleSheets', () => {
  const columns = [{ id: 'key', header: 'Key' }];
  const cell = (t) => ({ kind: 'text', value: t, text: t });
  it('puts everything on one sheet after the summary sheet', () => {
    const out = assembleSheets({ columns, rows: [{ group: '', cells: [cell('a')] }], grouped: false, summary: true, labels });
    expect(out).toEqual({ summarySheet: 'Summary', sheets: [{ name: 'Issues', columns, rows: [[cell('a')]] }] });
  });
  it('makes one sheet per group in order of first appearance', () => {
    const out = assembleSheets({ columns, rows: [{ group: 'Open', cells: [cell('a')] }, { group: 'Done', cells: [cell('b')] }, { group: 'Open', cells: [cell('c')] }], grouped: true, summary: false, labels });
    expect(out.sheets.map((s) => [s.name, s.rows.length])).toEqual([['Open', 2], ['Done', 1]]);
    expect(out.summarySheet).toBeNull();
  });
  it('never gives a group the summary sheet name', () => {
    const out = assembleSheets({ columns, rows: [{ group: 'Summary', cells: [cell('a')] }], grouped: true, summary: true, labels });
    expect(out.sheets[0].name).toBe('Summary (2)');
  });
  it('emits one empty data sheet when grouped with no rows', () => {
    const out = assembleSheets({ columns, rows: [], grouped: true, summary: false, labels });
    expect(out).toEqual({ summarySheet: null, sheets: [{ name: 'Issues', columns, rows: [] }] });
  });
  it('emits one empty data sheet when ungrouped with no rows', () => {
    const out = assembleSheets({ columns, rows: [], grouped: false, summary: false, labels });
    expect(out.sheets).toEqual([{ name: 'Issues', columns, rows: [] }]);
  });
});
