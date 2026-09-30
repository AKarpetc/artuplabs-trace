/** File-name pattern used when a template has none. */
export const DEFAULT_FILE_PATTERN = '{project}-{date}-{filter}';

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F\u007F]/gu;
const MAX_BASE = 120;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function localDate(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function clean(value) {
  return String(value ?? '').normalize('NFC').replace(FORBIDDEN, '-').replace(/\s+/gu, '-');
}

function sliceUnits(text, max) {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Renders a file-name pattern with {project} {date} {filter} {format} {count}; forbidden characters become '-'. */
export function renderFileName({ pattern = DEFAULT_FILE_PATTERN, values = {}, now, extension, partial = false }) {
  const data = { ...values, date: localDate(now) };
  const filled = pattern.replace(/\{(\w+)\}/g, (_, name) => clean(data[name]));
  const collapsed = clean(filled).replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  const base = sliceUnits(collapsed, MAX_BASE).replace(/[-.]+$/, '') || 'artup-report';
  return `${base}${partial ? '-PARTIAL' : ''}.${extension}`;
}
