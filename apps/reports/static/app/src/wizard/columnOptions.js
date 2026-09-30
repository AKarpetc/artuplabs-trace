import { PSEUDO_COLUMNS, resolveColumn } from '../core/columns.js';

const collatorFor = (locale) => new Intl.Collator(locale);

/** Pseudo-columns a row mode can use: the issue key, plus the worklog or comment columns of that mode. */
export function pseudoColumnsFor(rowMode) {
  return [...PSEUDO_COLUMNS].filter((id) => id === 'key' || id.startsWith(`${rowMode}.`));
}

/** Display name of a column reference: the translated pseudo-column, the Jira field name, or the reference itself; `missing` when the site lacks it. */
export function columnName(catalog, ref, labels) {
  if (!catalog) return { name: ref, missing: false };
  const column = resolveColumn(catalog, ref);
  if (column.pseudo) return { name: labels[`column.${ref}`] ?? ref, missing: false };
  if (column.missing) return { name: ref, missing: true };
  return { name: column.field.name, missing: false };
}

function fieldEntries(catalog, locale) {
  const collator = collatorFor(locale);
  const counts = new Map();
  for (const field of catalog.list) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
  return catalog.list
    .map((field) => ({ value: field.id, label: counts.get(field.name) > 1 ? `${field.name} · ${field.id}` : field.name }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

/** Options of the add-column select: row columns of the mode, then Jira fields; chosen ones left out. */
export function columnOptions({ catalog, rowMode, chosen, labels, locale, groupLabels }) {
  const taken = new Set(chosen.map((ref) => (catalog ? resolveColumn(catalog, ref).id : ref)));
  const row = pseudoColumnsFor(rowMode).filter((id) => !taken.has(id)).map((id) => ({ value: id, label: labels[`column.${id}`] ?? id }));
  const fields = catalog ? fieldEntries(catalog, locale).filter((option) => !taken.has(option.value)) : [];
  return [
    { label: groupLabels.row, options: row },
    { label: groupLabels.fields, options: fields },
  ].filter((group) => group.options.length > 0);
}

/** Options of the group-by select: Jira fields only, sorted by name. */
export function groupByOptions(catalog, locale) {
  return catalog ? fieldEntries(catalog, locale) : [];
}
