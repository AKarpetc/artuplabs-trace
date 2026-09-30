import { useMemo, useReducer } from 'react';
import { BUILTINS } from '../core/builtins.js';
import { ROW_MODES } from '../core/columns.js';
import { DEFAULT_FILE_PATTERN } from '../core/filename.js';

/** Output formats in the order the wizard offers them. */
export const FORMATS = ['xlsx', 'docx', 'pdf'];

const LETTER_LANGUAGES = new Set(['en-US', 'en-CA']);

/** Paper size for a browser language: Letter in the United States and Canada, else A4. */
export function defaultPaper(language) {
  return LETTER_LANGUAGES.has(language) ? 'LETTER' : 'A4';
}

const firstBuiltin = (format) => BUILTINS.find((b) => b.format === format);

function withTemplate(state, template) {
  const next = { ...state, format: template.format, selected: template };
  if (template.kind === 'columns') {
    next.columns = [...template.columns];
    next.rowMode = template.rowMode ?? 'issue';
    next.groupBy = template.groupBy ?? null;
    next.summary = Boolean(template.summary);
  }
  if (template.paper) next.paper = template.paper;
  if (template.fileNamePattern) next.fileNamePattern = template.fileNamePattern;
  return next;
}

/** Starting form for an entry: Word for a single issue, else Excel; its first built-in; paper from the browser language. */
export function initialForm(entry, { language } = {}) {
  const format = entry?.kind === 'issue' ? 'docx' : 'xlsx';
  const base = {
    format, selected: null, columns: [], rowMode: 'issue', groupBy: null, summary: false,
    paper: defaultPaper(language), fileNamePattern: DEFAULT_FILE_PATTERN, jql: '', filter: null,
  };
  return withTemplate(base, firstBuiltin(format));
}

const otherModeColumn = (rowMode) => (ref) => ROW_MODES.some((mode) => mode !== rowMode && ref.startsWith(`${mode}.`));

function moveColumn(state, from, to) {
  const { columns } = state;
  if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return state;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...state, columns: next };
}

/** Pure form transitions: format, template, columns, row mode, group-by, summary, paper, file name, JQL and filter. */
export function formReducer(state, action) {
  switch (action.type) {
    case 'format': return action.format === state.format ? state : withTemplate(state, firstBuiltin(action.format));
    case 'template': return withTemplate(state, action.template);
    case 'addColumn': return state.columns.includes(action.ref) ? state : { ...state, columns: [...state.columns, action.ref] };
    case 'removeColumn': return { ...state, columns: state.columns.filter((_, i) => i !== action.index) };
    case 'moveColumn': return moveColumn(state, action.from, action.to);
    case 'rowMode': return { ...state, rowMode: action.rowMode, columns: state.columns.filter((ref) => !otherModeColumn(action.rowMode)(ref)) };
    case 'groupBy': return { ...state, groupBy: action.groupBy };
    case 'summary': return { ...state, summary: action.summary };
    case 'paper': return { ...state, paper: action.paper };
    case 'fileNamePattern': return { ...state, fileNamePattern: action.fileNamePattern };
    case 'jql': return { ...state, jql: action.jql, filter: state.filter?.jql === action.jql ? state.filter : null };
    case 'filter': return { ...state, jql: action.filter?.jql ?? state.jql, filter: action.filter };
    default: return state;
  }
}

/** True when the export can start: issues are known (entry or typed JQL) and an Excel export has columns. */
export function canStart(state, entry) {
  const hasIssues = entry.kind !== 'none' || state.jql.trim() !== '';
  return hasIssues && (state.format !== 'xlsx' || state.columns.length > 0);
}

/** Template the pipeline runs: the edited Excel settings, or the chosen layout/Word template with paper and file-name pattern. */
export function runTemplate(state) {
  const { selected, fileNamePattern } = state;
  if (selected.kind === 'columns') {
    const { columns, rowMode, groupBy, summary } = state;
    return { id: selected.id, format: 'xlsx', kind: 'columns', columns, rowMode, groupBy, summary, fileNamePattern };
  }
  return { ...selected, paper: state.paper, fileNamePattern };
}

/** Entry the pipeline runs: typed JQL (named after the chosen filter) on the global page, else the entry itself. */
export function runEntry(state, entry) {
  if (entry.kind !== 'none') return entry;
  return { kind: 'jql', jql: state.jql.trim(), label: state.filter?.name ?? '' };
}

/** Project keys for template lookup: the entry's project, else an issue key's prefix, else none. */
export function projectKeysOf(entry) {
  if (entry.projectKey) return [entry.projectKey];
  if (entry.kind === 'issue') return [entry.key.split('-')[0]];
  return [];
}

/** Wizard form state for `entry` with named actions; `language` (default navigator.language) picks the paper size. */
export function useWizardForm(entry, { language = globalThis.navigator?.language } = {}) {
  const [state, dispatch] = useReducer(formReducer, undefined, () => initialForm(entry, { language }));
  const actions = useMemo(() => ({
    setFormat: (format) => dispatch({ type: 'format', format }),
    chooseTemplate: (template) => dispatch({ type: 'template', template }),
    addColumn: (ref) => dispatch({ type: 'addColumn', ref }),
    removeColumn: (index) => dispatch({ type: 'removeColumn', index }),
    moveColumn: (from, to) => dispatch({ type: 'moveColumn', from, to }),
    setRowMode: (rowMode) => dispatch({ type: 'rowMode', rowMode }),
    setGroupBy: (groupBy) => dispatch({ type: 'groupBy', groupBy }),
    setSummary: (summary) => dispatch({ type: 'summary', summary }),
    setPaper: (paper) => dispatch({ type: 'paper', paper }),
    setFileNamePattern: (fileNamePattern) => dispatch({ type: 'fileNamePattern', fileNamePattern }),
    setJql: (jql) => dispatch({ type: 'jql', jql }),
    chooseFilter: (filter) => dispatch({ type: 'filter', filter }),
  }), []);
  return { state, ...actions, canStart: canStart(state, entry) };
}
