import { PALETTE } from './palette.js';

const FORMATS = { date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm', duration: '0.00' };
const argb = (hex) => `FF${hex}`;

function toValue(cell, tzOffset) {
  switch (cell.kind) {
    case 'empty': return null;
    case 'link': return { text: cell.text, hyperlink: cell.value };
    case 'datetime': return new Date(cell.value.getTime() - tzOffset(cell.value) * 60000);
    case 'duration': return Number((cell.value / 3600).toFixed(2));
    case 'date': case 'number': return cell.value;
    default: return cell.text;
  }
}

function widthOf(header, rows, index) {
  const sample = rows.slice(0, 200).map((r) => (r[index]?.text ?? '').split('\n')[0].length);
  return Math.min(60, Math.max(8, header.length + 2, ...sample.map((n) => n + 2)));
}

function styleHeader(row) {
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(PALETTE.headerFill) } };
  });
}

function addDataSheet(wb, sheet, { banner, tzOffset }) {
  const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: banner ? 2 : 1 }] });
  if (banner) ws.addRow([banner]).font = { bold: true, color: { argb: argb(PALETTE.text) } };
  const header = ws.addRow(sheet.columns.map((c) => c.header));
  styleHeader(header);
  sheet.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = widthOf(c.header, sheet.rows, i);
  });
  for (const cells of sheet.rows) {
    const row = ws.addRow(cells.map((c) => toValue(c, tzOffset)));
    cells.forEach((c, i) => {
      const target = row.getCell(i + 1);
      if (FORMATS[c.kind]) target.numFmt = FORMATS[c.kind];
      if (c.percent) target.numFmt = '0%';
      if (c.kind === 'link') target.font = { underline: true, color: { argb: argb(PALETTE.link) } };
    });
  }
  ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: sheet.columns.length } };
}

function addSummarySheet(wb, name, { summary, meta, labels, banner }) {
  const ws = wb.addWorksheet(name);
  if (banner) ws.addRow([banner]).font = { bold: true };
  ws.addRow([labels['summary.jql'], meta.jql]);
  ws.addRow([labels['summary.exportedAt'], meta.exportedAt]);
  ws.addRow([labels['summary.exportedBy'], meta.exportedBy]);
  ws.addRow([labels['summary.count'], meta.count]);
  for (const [key, pairs] of [['summary.byStatus', summary.byStatus], ['summary.byAssignee', summary.byAssignee], ['summary.byPriority', summary.byPriority]]) {
    ws.addRow([]);
    styleHeader(ws.addRow([labels[key], labels['summary.issues']]));
    for (const [label, count] of pairs) ws.addRow([label, count]);
  }
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 60;
}

/** Writes sheets and the optional summary sheet to .xlsx bytes: typed cells, links, frozen header, filter. */
export async function renderXlsx({ assembled, summary, meta, labels, ExcelJS, tzOffset = (d) => d.getTimezoneOffset() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.exportedBy;
  wb.created = meta.now;
  wb.title = meta.title ?? '';
  wb.description = `JQL: ${meta.jql}`;
  const banner = meta.partial ? labels.partialBanner(meta.partial.done, meta.partial.total) : null;
  const withSummary = Boolean(assembled.summarySheet && summary);
  if (withSummary) {
    addSummarySheet(wb, assembled.summarySheet, { summary, meta, labels, banner });
  }
  assembled.sheets.forEach((sheet, i) => addDataSheet(wb, sheet, { banner: i === 0 && !withSummary ? banner : null, tzOffset }));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
