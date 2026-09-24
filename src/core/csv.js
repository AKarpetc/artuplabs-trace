const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** RFC 4180 CSV with BOM; cells that look like spreadsheet formulas are prefixed with a quote. */
export function toCsv(columns, rows) {
  const header = columns.map((c) => cell(c.title)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(row[c.key])).join(','));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}

/** Builds CSV from rows, halving the row count until the text is at most maxChars; returns { csv, truncated }. */
export function capCsv(columns, rows, maxChars) {
  let count = rows.length;
  let csv = toCsv(columns, rows);
  while (csv.length > maxChars && count > 0) {
    count = count === 1 ? 0 : Math.ceil(count / 2);
    csv = toCsv(columns, rows.slice(0, count));
  }
  return { csv, truncated: count < rows.length };
}

/** Pages through fetchPage(after) until exhausted or more than max rows are seen; truncated only when rows beyond max exist. */
export async function collectPages(fetchPage, cursorOf, max) {
  const rows = [];
  let after = '';
  while (rows.length <= max) {
    const page = await fetchPage(after);
    if (!page.length) {
      break;
    }
    rows.push(...page);
    after = cursorOf(page[page.length - 1]);
  }
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}
