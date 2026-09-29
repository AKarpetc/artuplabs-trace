import { findByCustomType, findByNames, resolveField } from './fields.js';

/** Columns that are not Jira fields. */
export const PSEUDO_COLUMNS = new Set([
  'key',
  'worklog.author', 'worklog.started', 'worklog.hours', 'worklog.comment',
  'comment.author', 'comment.created', 'comment.body',
]);

/** One row per issue, per worklog or per comment. */
export const ROW_MODES = ['issue', 'worklog', 'comment'];

const SPECIAL = {
  '@storyPoints': (catalog) => findByNames(catalog, ['Story Points', 'Story point estimate']),
  '@sprint': (catalog) => findByCustomType(catalog, 'com.pyxis.greenhopper.jira:gh-sprint'),
};

/** Resolves a template column reference to a Jira field or a pseudo-column; unknown fields are marked missing. */
export function resolveColumn(catalog, ref) {
  if (PSEUDO_COLUMNS.has(ref)) return { ref, id: ref, field: null, pseudo: true, missing: false };
  const field = SPECIAL[ref] ? SPECIAL[ref](catalog) : resolveField(catalog, ref);
  if (!field) return { ref, id: ref, field: null, pseudo: false, missing: true };
  return { ref, id: field.id, field, pseudo: false, missing: false };
}
