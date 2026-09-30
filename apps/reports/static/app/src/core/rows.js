import { adfToModel, blocksToText, truncateCell } from './adf.js';
import { resolveColumn } from './columns.js';
import { cellValue, linkCell } from './fields.js';
import { EXCEL_CELL_LIMIT } from './limits.js';

const EMPTY = { kind: 'empty', value: null, text: '' };

function finish(cell) {
  if (cell.kind === 'adf') {
    const text = truncateCell(blocksToText(adfToModel(cell.value).blocks));
    return text ? { kind: 'text', value: text, text } : EMPTY;
  }
  if (cell.kind === 'text' && cell.text.length > EXCEL_CELL_LIMIT) {
    const text = truncateCell(cell.text);
    return { kind: 'text', value: text, text };
  }
  return cell;
}

const textOf = (value) => (value ? { kind: 'text', value, text: value } : EMPTY);
const adfText = (doc) => finish(cellValue(null, doc));
const hoursCell = (seconds) => {
  const value = Number(((seconds ?? 0) / 3600).toFixed(2));
  return { kind: 'number', value, text: String(value) };
};
const ownLabel = (labels, key) => (Object.hasOwn(labels, key) ? labels[key] : undefined);
const DATETIME = { type: 'datetime' };

const ITEM_CELLS = {
  'worklog.author': (w) => textOf(w.author?.displayName ?? ''),
  'worklog.started': (w) => cellValue(DATETIME, w.started),
  'worklog.hours': (w) => hoursCell(w.timeSpentSeconds),
  'worklog.comment': (w) => adfText(w.comment),
  'comment.author': (c) => textOf(c.author?.displayName ?? ''),
  'comment.created': (c) => cellValue(DATETIME, c.created),
  'comment.body': (c) => adfText(c.body),
};

/** Turns issues into Excel rows for a column template; unknown columns are dropped and reported. */
export function createRowBuilder({ template, catalog, siteUrl, labels }) {
  const resolved = template.columns.map((ref) => resolveColumn(catalog, ref));
  const kept = resolved.filter((c) => !c.missing);
  const group = template.groupBy ? resolveColumn(catalog, template.groupBy) : null;
  const columns = kept.map((c) => ({ id: c.id, header: c.pseudo ? ownLabel(labels, `column.${c.id}`) ?? c.id : c.field.name }));
  const issueCell = (issue, column) => {
    if (column.id === 'key') return linkCell(issue.key, `${siteUrl}/browse/${issue.key}`);
    return finish(cellValue(column.field, issue.fields?.[column.id]));
  };
  const groupOf = (issue) => {
    if (!group || group.missing) return '';
    return issueCell(issue, group).text || labels.none;
  };
  const itemCell = (item, id) => (item && id.startsWith(`${template.rowMode}.`) ? ITEM_CELLS[id](item) : EMPTY);
  const items = (issue) => {
    if (template.rowMode === 'worklog') return issue.fields?.worklog?.worklogs ?? [];
    if (template.rowMode === 'comment') return issue.fields?.comment?.comments ?? [];
    return [null];
  };
  return {
    columns,
    grouped: Boolean(group) && !group.missing,
    missing: [...resolved, ...(group?.missing ? [group] : [])].filter((c) => c.missing).map((c) => c.ref).filter((ref, i, all) => all.indexOf(ref) === i),
    rowsFor(issue) {
      const groupName = groupOf(issue);
      return items(issue).map((item) => ({
        group: groupName,
        cells: kept.map((c) => (Object.hasOwn(ITEM_CELLS, c.id) ? itemCell(item, c.id) : issueCell(issue, c))),
      }));
    },
  };
}

function sorted(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Counts issues by status, assignee and priority for the summary sheet. */
export function createSummary(labels) {
  const byStatus = new Map();
  const byAssignee = new Map();
  const byPriority = new Map();
  let total = 0;
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  return {
    add(issue) {
      total += 1;
      bump(byStatus, issue.fields?.status?.name ?? labels.none);
      bump(byAssignee, issue.fields?.assignee?.displayName ?? labels.unassigned);
      bump(byPriority, issue.fields?.priority?.name ?? labels.none);
    },
    result() {
      return { total, byStatus: sorted(byStatus), byAssignee: sorted(byAssignee), byPriority: sorted(byPriority) };
    },
  };
}

function sliceUnits(text, max) {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

function tidy(text) {
  let out = text;
  let previous;
  do {
    previous = out;
    out = out.trim().replace(/^'+|'+$/g, '');
  } while (out !== previous);
  return out;
}

const fit = (text, max) => tidy(sliceUnits(text, max));

/** A valid, unique Excel sheet name: no []:*?/\, no edge apostrophes, at most 31 characters, not History. */
export function sheetName(raw, taken) {
  const base = fit(tidy(String(raw ?? '').replace(/[[\]:*?/\\]/g, '-')), 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
    const suffix = ` (${n})`;
    name = `${fit(base, 31 - suffix.length) || 'Sheet'}${suffix}`;
    n += 1;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Splits rows into sheets (one, or one per group) after an optional summary sheet. */
export function assembleSheets({ columns, rows, grouped, summary, labels }) {
  const taken = new Set();
  const summarySheet = summary ? sheetName(labels['sheet.summary'], taken) : null;
  if (!grouped || rows.length === 0) {
    return { summarySheet, sheets: [{ name: sheetName(labels['sheet.issues'], taken), columns, rows: rows.map((r) => r.cells) }] };
  }
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row.cells);
  }
  return {
    summarySheet,
    sheets: [...groups.entries()].map(([group, groupRows]) => ({ name: sheetName(group, taken), columns, rows: groupRows })),
  };
}
