const SCOPES = ['user', 'project', 'site'];
const FORMATS = ['xlsx', 'docx', 'pdf'];
const KIND_FORMATS = { columns: ['xlsx'], layout: ['docx', 'pdf'], docx: ['docx'] };
const ROW_MODES = ['issue', 'worklog', 'comment'];
const LAYOUTS = ['single', 'list', 'sprint', 'release'];
const PAPERS = ['A4', 'LETTER'];
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_NAME = 80;
const MAX_COLUMNS = 100;
const MAX_REF = 200;
const MAX_PATTERN = 200;
const MAX_PLACEHOLDERS_JSON = 50000;
const MAX_PROJECT_KEY = 255;

/** Site templates share this scope id. */
export const SITE_SCOPE_ID = 'site';

const isString = (v, max) => typeof v === 'string' && v.length <= max;

/** True for a Jira project key such as RPT or ABC_1. */
export function isProjectKey(value) {
  return isString(value, MAX_PROJECT_KEY) && PROJECT_KEY.test(value);
}

/** True for a lower-case UUID string. */
export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function placeholdersFit(value) {
  if (!Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_PLACEHOLDERS_JSON;
  } catch {
    return false;
  }
}

const CHECKS = {
  id: isUuid,
  rowMode: (v) => ROW_MODES.includes(v),
  groupBy: (v) => v === null || (isString(v, MAX_REF) && v.length > 0),
  summary: (v) => typeof v === 'boolean',
  layout: (v) => LAYOUTS.includes(v),
  paper: (v) => PAPERS.includes(v),
  fileNamePattern: (v) => isString(v, MAX_PATTERN),
  columns: (v) => Array.isArray(v) && v.length <= MAX_COLUMNS && v.every((c) => isString(c, MAX_REF) && c.length > 0),
  placeholders: placeholdersFit,
};

function scopeIdOf(input) {
  if (input.scope === 'user') return '';
  if (input.scope === 'site') return SITE_SCOPE_ID;
  return isProjectKey(input.scopeId) ? input.scopeId : undefined;
}

/** Cleaned template metadata with unknown keys stripped, or 'bad-request'; the user scope id is left for the caller. */
export function validateTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'bad-request';
  const { scope, name, format, kind } = input;
  if (!SCOPES.includes(scope) || !FORMATS.includes(format) || !KIND_FORMATS[kind]?.includes(format)) return 'bad-request';
  if (!isString(name, MAX_NAME) || name.trim() === '') return 'bad-request';
  const scopeId = scopeIdOf(input);
  if (scopeId === undefined) return 'bad-request';
  if (kind === 'columns' && input.columns === undefined) return 'bad-request';
  if (kind === 'layout' && input.layout === undefined) return 'bad-request';
  const clean = { scope, scopeId, name, format, kind };
  for (const [key, check] of Object.entries(CHECKS)) {
    if (input[key] === undefined) continue;
    if (!check(input[key])) return 'bad-request';
    clean[key] = input[key];
  }
  return clean;
}
