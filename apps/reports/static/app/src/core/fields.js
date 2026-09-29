const DURATION = new Set([
  'timespent', 'timeoriginalestimate', 'timeestimate',
  'aggregatetimespent', 'aggregatetimeoriginalestimate', 'aggregatetimeestimate',
]);

const EMPTY = Object.freeze({ kind: 'empty', value: null, text: '' });

function customNumber(id) {
  const match = /^customfield_(\d+)$/.exec(id);
  return match ? Number(match[1]) : -1;
}

function compareFields(a, b) {
  return customNumber(a.id) - customNumber(b.id) || a.id.localeCompare(b.id);
}

/** Indexes GET /rest/api/3/field by id and by lower-case name; on a name clash system fields, then lower ids win. */
export function buildFieldCatalog(rawFields) {
  const list = rawFields.map((f) => ({
    id: f.id,
    name: f.name,
    custom: Boolean(f.custom),
    type: f.schema?.type ?? 'any',
    items: f.schema?.items ?? null,
    system: f.schema?.system ?? null,
    customType: f.schema?.custom ?? null,
  }));
  const byId = new Map(list.map((f) => [f.id, f]));
  const byName = new Map();
  for (const field of [...list].sort(compareFields)) {
    const key = field.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, field);
  }
  return { list, byId, byName };
}

/** Field by id, else by case-insensitive name; null when unknown. */
export function resolveField(catalog, ref) {
  if (!ref) return null;
  return catalog.byId.get(ref) ?? catalog.byName.get(String(ref).toLowerCase()) ?? null;
}

/** First field matching one of the names, in the order given. */
export function findByNames(catalog, names) {
  for (const name of names) {
    const field = catalog.byName.get(name.toLowerCase());
    if (field) return field;
  }
  return null;
}

/** Lowest-id field of a custom field type. */
export function findByCustomType(catalog, customType) {
  return [...catalog.list].sort(compareFields).find((f) => f.customType === customType) ?? null;
}

const textCell = (text) => (text === '' ? EMPTY : { kind: 'text', value: text, text });
const countCell = (n) => (n == null ? EMPTY : { kind: 'number', value: n, text: String(n) });

/** Link cell: shows text, points to url. */
export function linkCell(text, url) {
  return { kind: 'link', value: url, text };
}

function nameOf(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const own = String(value.displayName ?? value.name ?? value.value ?? value.key ?? '');
  return value.child ? `${own} / ${nameOf(value.child)}` : own;
}

function linkText(link) {
  if (link.outwardIssue) return `${link.type?.outward ?? ''} ${link.outwardIssue.key}`.trim();
  if (link.inwardIssue) return `${link.type?.inward ?? ''} ${link.inwardIssue.key}`.trim();
  return '';
}

function itemText(field, item) {
  if (field?.system === 'issuelinks') return linkText(item);
  if (item && typeof item === 'object' && item.key && item.fields) return item.key;
  if (item && typeof item === 'object' && item.filename) return item.filename;
  return nameOf(item);
}

function isAdf(value) {
  return Boolean(value) && typeof value === 'object' && value.type === 'doc' && Array.isArray(value.content);
}

function dateCell(raw) {
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return textCell(raw);
  return { kind: 'date', value: new Date(Date.UTC(y, m - 1, d)), text: raw };
}

function datetimeCell(raw) {
  const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(ms) ? textCell(raw) : { kind: 'datetime', value: new Date(ms), text: raw };
}

const hours = (seconds) => `${Number((seconds / 3600).toFixed(2))} h`;

/** Typed cell for a raw Jira field value; ADF comes back as kind 'adf' for the caller to convert. */
export function cellValue(field, raw) {
  if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return EMPTY;
  const type = field?.type ?? 'any';
  if (field && DURATION.has(field.system ?? field.id) && typeof raw === 'number') {
    return { kind: 'duration', value: raw, text: hours(raw) };
  }
  if (type === 'date' && typeof raw === 'string') return dateCell(raw);
  if (type === 'datetime' && typeof raw === 'string') return datetimeCell(raw);
  if (isAdf(raw)) return { kind: 'adf', value: raw, text: '' };
  if (Array.isArray(raw)) return textCell(raw.map((item) => itemText(field, item)).filter(Boolean).join(', '));
  if (field?.system === 'comment' || type === 'comments-page') return countCell(raw.total ?? raw.comments?.length);
  if (field?.system === 'worklog') return countCell(raw.total ?? raw.worklogs?.length);
  if (type === 'progress') {
    const percent = raw.percent ?? 0;
    return { kind: 'number', value: percent / 100, text: `${percent}%`, percent: true };
  }
  if (type === 'timetracking') return textCell(String(raw.originalEstimate ?? ''));
  if (type === 'watches') return countCell(raw.watchCount);
  if (type === 'votes') return countCell(raw.votes);
  if (typeof raw === 'number') return { kind: 'number', value: raw, text: String(raw) };
  if (typeof raw === 'boolean' || typeof raw === 'string') return textCell(String(raw));
  if (raw.key && raw.fields) return textCell(raw.key);
  return textCell(nameOf(raw) || JSON.stringify(raw).slice(0, 200));
}
