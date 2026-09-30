import { describe, expect, it } from 'vitest';
import { buildFieldCatalog, cellValue, findByCustomType, findByNames, linkCell, resolveField } from '../../src/core/fields.js';

const RAW = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
  { id: 'duedate', name: 'Due date', custom: false, schema: { type: 'date', system: 'duedate' } },
  { id: 'created', name: 'Created', custom: false, schema: { type: 'datetime', system: 'created' } },
  { id: 'timespent', name: 'Time Spent', custom: false, schema: { type: 'number', system: 'timespent' } },
  { id: 'labels', name: 'Labels', custom: false, schema: { type: 'array', items: 'string', system: 'labels' } },
  { id: 'fixVersions', name: 'Fix versions', custom: false, schema: { type: 'array', items: 'version', system: 'fixVersions' } },
  { id: 'issuelinks', name: 'Linked Issues', custom: false, schema: { type: 'array', items: 'issuelinks', system: 'issuelinks' } },
  { id: 'subtasks', name: 'Sub-tasks', custom: false, schema: { type: 'array', items: 'issuelinks', system: 'subtasks' } },
  { id: 'comment', name: 'Comment', custom: false, schema: { type: 'comments-page', system: 'comment' } },
  { id: 'status', name: 'Status', custom: false, schema: { type: 'status', system: 'status' } },
  { id: 'assignee', name: 'Assignee', custom: false, schema: { type: 'user', system: 'assignee' } },
  { id: 'description', name: 'Description', custom: false, schema: { type: 'string', system: 'description' } },
  { id: 'customfield_10200', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  { id: 'customfield_10016', name: 'story points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10300', name: 'Region', custom: true, schema: { type: 'option-with-child', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect' } },
  { id: 'customfield_10400', name: 'Done %', custom: true, schema: { type: 'progress' } },
];
const catalog = buildFieldCatalog(RAW);
const f = (id) => catalog.byId.get(id);

describe('buildFieldCatalog', () => {
  it('names a field Jira returns without a name by its id', () => {
    const nameless = buildFieldCatalog([{ id: 'customfield_10900', custom: true, schema: { type: 'string' } }, { id: 'summary', name: null }]);
    expect([nameless.list.map((field) => field.name), resolveField(nameless, 'CUSTOMFIELD_10900')?.id]).toEqual([['customfield_10900', 'summary'], 'customfield_10900']);
  });
});

describe('resolveField', () => {
  it('finds a field by id', () => {
    expect(resolveField(catalog, 'duedate')?.name).toBe('Due date');
  });
  it('finds a field by name ignoring case', () => {
    expect(resolveField(catalog, 'DUE DATE')?.id).toBe('duedate');
  });
  it('prefers the lowest custom id when two fields share a name', () => {
    expect(resolveField(catalog, 'Story Points')?.id).toBe('customfield_10016');
  });
  it('returns null for an unknown reference', () => {
    expect(resolveField(catalog, 'customfield_99999')).toBeNull();
  });
  it('finds by a list of names and by custom type', () => {
    expect(findByNames(catalog, ['Story point estimate', 'Story Points'])?.id).toBe('customfield_10016');
    expect(findByCustomType(catalog, 'com.pyxis.greenhopper.jira:gh-sprint')?.id).toBe('customfield_10020');
  });
});

describe('cellValue', () => {
  it('returns empty for null, empty string and empty arrays', () => {
    expect(cellValue(f('summary'), null)).toEqual({ kind: 'empty', value: null, text: '' });
    expect(cellValue(f('labels'), [])).toEqual({ kind: 'empty', value: null, text: '' });
  });
  it('turns a date into a UTC-midnight Date', () => {
    expect(cellValue(f('duedate'), '2026-09-29')).toEqual({ kind: 'date', value: new Date(Date.UTC(2026, 8, 29)), text: '2026-09-29' });
  });
  it('parses Jira datetimes with a +hhmm offset', () => {
    expect(cellValue(f('created'), '2026-09-29T10:15:30.000+0300')).toEqual({
      kind: 'datetime', value: new Date('2026-09-29T07:15:30.000Z'), text: '2026-09-29T10:15:30.000+0300',
    });
  });
  it('keeps durations in seconds', () => {
    expect(cellValue(f('timespent'), 5400)).toEqual({ kind: 'duration', value: 5400, text: '1.5 h' });
  });
  it('joins arrays of strings and named objects', () => {
    expect(cellValue(f('labels'), ['a', 'b'])).toEqual({ kind: 'text', value: 'a, b', text: 'a, b' });
    expect(cellValue(f('fixVersions'), [{ name: '1.0' }, { name: '1.1' }])).toEqual({ kind: 'text', value: '1.0, 1.1', text: '1.0, 1.1' });
  });
  it('writes issue links with their direction', () => {
    const raw = [
      { type: { outward: 'blocks', inward: 'is blocked by' }, outwardIssue: { key: 'RPT-2' } },
      { type: { outward: 'blocks', inward: 'is blocked by' }, inwardIssue: { key: 'RPT-3' } },
    ];
    expect(cellValue(f('issuelinks'), raw).text).toBe('blocks RPT-2, is blocked by RPT-3');
  });
  it('lists sub-task keys', () => {
    expect(cellValue(f('subtasks'), [{ key: 'RPT-5', fields: {} }]).text).toBe('RPT-5');
  });
  it('counts comments', () => {
    expect(cellValue(f('comment'), { total: 3, comments: [] })).toEqual({ kind: 'number', value: 3, text: '3' });
  });
  it('names users, statuses and cascading options', () => {
    expect(cellValue(f('assignee'), { displayName: 'Ann' }).text).toBe('Ann');
    expect(cellValue(f('status'), { name: 'Done' }).text).toBe('Done');
    expect(cellValue(f('customfield_10300'), { value: 'EU', child: { value: 'DE' } }).text).toBe('EU / DE');
  });
  it('names sprints', () => {
    expect(cellValue(f('customfield_10020'), [{ id: 1, name: 'Sprint 1' }]).text).toBe('Sprint 1');
  });
  it('passes ADF through for the caller to convert', () => {
    const doc = { type: 'doc', version: 1, content: [] };
    expect(cellValue(f('description'), doc)).toEqual({ kind: 'adf', value: doc, text: '' });
  });
  it('turns progress into a fraction', () => {
    expect(cellValue(f('customfield_10400'), { percent: 40 })).toEqual({ kind: 'number', value: 0.4, text: '40%', percent: true });
  });
  it('keeps numbers of an unknown field as numbers', () => {
    expect(cellValue(null, 7)).toEqual({ kind: 'number', value: 7, text: '7' });
  });
  it('falls back to a short JSON text for an unknown object', () => {
    expect(cellValue(null, { a: 1 }).text).toBe('{"a":1}');
  });
});

describe('linkCell', () => {
  it('builds a link cell', () => {
    expect(linkCell('RPT-1', 'https://x/browse/RPT-1')).toEqual({ kind: 'link', value: 'https://x/browse/RPT-1', text: 'RPT-1' });
  });
});
