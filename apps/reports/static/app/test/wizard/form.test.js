import { describe, expect, it } from 'vitest';
import { builtinById } from '../../src/core/builtins.js';
import { DEFAULT_FILE_PATTERN } from '../../src/core/filename.js';
import {
  canStart, defaultPaper, formReducer, initialForm, projectKeysOf, runEntry, runTemplate,
} from '../../src/wizard/useWizardForm.js';

const NONE = { kind: 'none' };
const JQL = { kind: 'jql', jql: 'project = RPT' };
const ISSUE = { kind: 'issue', key: 'RPT-7', projectKey: 'RPT' };

const custom = {
  id: '6f1d2c3b-0000-4000-8000-000000000001', scope: 'user', name: 'Mine', format: 'xlsx', kind: 'columns',
  columns: ['key', 'summary', 'customfield_10016'], rowMode: 'issue', groupBy: 'assignee', summary: true, fileNamePattern: '{project}-mine',
};

const apply = (state, ...actions) => actions.reduce(formReducer, state);

describe('initialForm', () => {
  it('starts with Excel and the first Excel built-in', () => {
    const form = initialForm(NONE, { language: 'de-DE' });
    expect(form).toEqual({
      format: 'xlsx', selected: builtinById('xlsx-issues'), columns: builtinById('xlsx-issues').columns, rowMode: 'issue', groupBy: null,
      summary: true, paper: 'A4', fileNamePattern: DEFAULT_FILE_PATTERN, jql: '', filter: null,
    });
  });

  it('starts an issue entry with Word and its first layout', () => {
    const form = initialForm(ISSUE, { language: 'de-DE' });
    expect([form.format, form.selected]).toEqual(['docx', builtinById('docx-single')]);
  });

  it('copies the built-in columns instead of sharing the array', () => {
    const form = initialForm(NONE, {});
    expect(form.columns).not.toBe(builtinById('xlsx-issues').columns);
  });
});

describe('defaultPaper', () => {
  it.each([['en-US', 'LETTER'], ['en-CA', 'LETTER'], ['en-GB', 'A4'], ['de-DE', 'A4'], [undefined, 'A4']])('%s → %s', (language, paper) => {
    expect(defaultPaper(language)).toBe(paper);
  });

  it('uses Letter when the injected language is en-US', () => {
    expect(initialForm(NONE, { language: 'en-US' }).paper).toBe('LETTER');
  });
});

describe('formReducer', () => {
  it('selects the first built-in of a newly chosen format', () => {
    const form = apply(initialForm(NONE, {}), { type: 'format', format: 'pdf' });
    expect([form.format, form.selected]).toEqual(['pdf', builtinById('pdf-single')]);
  });

  it('keeps the form when the same format is chosen again', () => {
    const start = apply(initialForm(NONE, {}), { type: 'removeColumn', index: 0 });
    expect(formReducer(start, { type: 'format', format: 'xlsx' })).toBe(start);
  });

  it('copies a custom template into the editable form without mutating it', () => {
    const before = structuredClone(custom);
    const form = apply(initialForm(NONE, {}), { type: 'template', template: custom }, { type: 'addColumn', ref: 'status' });
    expect(form).toEqual({
      ...initialForm(NONE, {}), selected: custom, columns: ['key', 'summary', 'customfield_10016', 'status'], rowMode: 'issue', groupBy: 'assignee',
      summary: true, fileNamePattern: '{project}-mine',
    });
    expect(custom).toEqual(before);
  });

  it('takes the paper of a stored layout template', () => {
    const layout = { id: 'x', scope: 'site', name: 'L', format: 'docx', kind: 'layout', layout: 'list', paper: 'LETTER' };
    const form = apply(initialForm(NONE, { language: 'de-DE' }), { type: 'format', format: 'docx' }, { type: 'template', template: layout });
    expect([form.selected, form.paper]).toEqual([layout, 'LETTER']);
  });

  it('adds a column once', () => {
    const form = apply(initialForm(NONE, {}), { type: 'addColumn', ref: 'summary' }, { type: 'addColumn', ref: 'customfield_10030' });
    expect(form.columns).toEqual([...builtinById('xlsx-issues').columns, 'customfield_10030']);
  });

  it('removes a column by index', () => {
    const form = apply(initialForm(NONE, {}), { type: 'template', template: custom }, { type: 'removeColumn', index: 1 });
    expect(form.columns).toEqual(['key', 'customfield_10016']);
  });

  it('moves a column down and up', () => {
    const start = apply(initialForm(NONE, {}), { type: 'template', template: custom });
    expect(apply(start, { type: 'moveColumn', from: 0, to: 2 }).columns).toEqual(['summary', 'customfield_10016', 'key']);
    expect(apply(start, { type: 'moveColumn', from: 2, to: 0 }).columns).toEqual(['customfield_10016', 'key', 'summary']);
  });

  it('ignores moves outside the list', () => {
    const start = apply(initialForm(NONE, {}), { type: 'template', template: custom });
    expect(apply(start, { type: 'moveColumn', from: 0, to: -1 })).toBe(start);
    expect(apply(start, { type: 'moveColumn', from: 2, to: 3 })).toBe(start);
  });

  it('drops the row columns of other row modes when the row mode changes', () => {
    const start = apply(initialForm(NONE, {}), { type: 'template', template: builtinById('xlsx-worklogs') }, { type: 'addColumn', ref: 'comment.body' });
    const form = apply(start, { type: 'rowMode', rowMode: 'comment' });
    expect([form.rowMode, form.columns]).toEqual(['comment', ['key', 'summary', 'comment.body']]);
  });

  it('sets group-by, summary, paper and the file-name pattern', () => {
    const form = apply(
      initialForm(NONE, {}),
      { type: 'groupBy', groupBy: 'status' },
      { type: 'summary', summary: false },
      { type: 'paper', paper: 'LETTER' },
      { type: 'fileNamePattern', fileNamePattern: '{filter}' },
    );
    expect([form.groupBy, form.summary, form.paper, form.fileNamePattern]).toEqual(['status', false, 'LETTER', '{filter}']);
  });

  it('fills the JQL from a chosen filter and remembers the filter', () => {
    const filter = { id: '10101', name: 'Open RPT issues', jql: 'project = RPT AND statusCategory != Done' };
    const form = apply(initialForm(NONE, {}), { type: 'filter', filter });
    expect([form.jql, form.filter]).toEqual([filter.jql, filter]);
  });

  it('forgets the filter once the JQL is edited', () => {
    const filter = { id: '10101', name: 'Open', jql: 'project = RPT' };
    const form = apply(initialForm(NONE, {}), { type: 'filter', filter }, { type: 'jql', jql: 'project = RPT AND status = Done' });
    expect([form.jql, form.filter]).toEqual(['project = RPT AND status = Done', null]);
  });
});

describe('canStart', () => {
  it('is false for the global page while the JQL is empty', () => {
    expect(canStart(apply(initialForm(NONE, {}), { type: 'jql', jql: '   ' }), NONE)).toBe(false);
  });

  it('is true for the global page once JQL is typed', () => {
    expect(canStart(apply(initialForm(NONE, {}), { type: 'jql', jql: 'project = RPT' }), NONE)).toBe(true);
  });

  it('is true for an entry that brings its own issues', () => {
    expect(canStart(initialForm(JQL, {}), JQL)).toBe(true);
  });

  it('is false for Excel without columns', () => {
    const form = apply(initialForm(JQL, {}), { type: 'template', template: { ...custom, columns: ['key'] } }, { type: 'removeColumn', index: 0 });
    expect(canStart(form, JQL)).toBe(false);
  });
});

describe('runTemplate', () => {
  it('builds the Excel template from the edited columns', () => {
    const form = apply(initialForm(NONE, {}), { type: 'template', template: custom }, { type: 'removeColumn', index: 2 }, { type: 'summary', summary: false });
    expect(runTemplate(form)).toEqual({
      id: custom.id, format: 'xlsx', kind: 'columns', columns: ['key', 'summary'], rowMode: 'issue', groupBy: 'assignee', summary: false,
      fileNamePattern: '{project}-mine',
    });
  });

  it('gives a layout the chosen paper and pattern', () => {
    const form = apply(initialForm(NONE, { language: 'en-US' }), { type: 'format', format: 'pdf' }, { type: 'template', template: builtinById('pdf-sprint') });
    expect(runTemplate(form)).toEqual({ ...builtinById('pdf-sprint'), paper: 'LETTER', fileNamePattern: DEFAULT_FILE_PATTERN });
  });
});

describe('runEntry', () => {
  it('turns typed JQL and the chosen filter into a jql entry', () => {
    const filter = { id: '1', name: 'Open', jql: 'project = RPT' };
    expect(runEntry(apply(initialForm(NONE, {}), { type: 'filter', filter }), NONE)).toEqual({ kind: 'jql', jql: 'project = RPT', label: 'Open' });
  });

  it('keeps an entry that brings its own issues', () => {
    expect(runEntry(initialForm(ISSUE, {}), ISSUE)).toBe(ISSUE);
  });
});

describe('projectKeysOf', () => {
  it.each([
    [ISSUE, ['RPT']],
    [{ kind: 'issue', key: 'ABC-1' }, ['ABC']],
    [{ kind: 'board', boardId: 3, projectKey: 'OPS' }, ['OPS']],
    [{ kind: 'sprint', sprintId: 3 }, []],
    [JQL, []],
    [NONE, []],
  ])('%o → %o', (entry, keys) => {
    expect(projectKeysOf(entry)).toEqual(keys);
  });
});
