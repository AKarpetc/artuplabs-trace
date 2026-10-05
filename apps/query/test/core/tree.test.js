import { describe, expect, it } from 'vitest';
import { buildFragment, filterValues, treeShape, valuesOf } from '../../src/core/tree.js';
import { ROOT_FILTER_VALUES, VALUE_LIMIT } from '../../src/core/limits.js';

const ids = (n) => Array.from({ length: n }, (_, i) => String(1000 + i));
const call = (page) => `issue in subtasksOf("project = \\"A\\"", "__aq:${page}")`;
const base = { functionName: 'subtasksOf', userArgs: ['project = "A"'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()' };

describe('treeShape', () => {
  it.each([
    [0, 2, { kind: 'list', leaves: 0 }],
    [1000, 2, { kind: 'list', leaves: 1 }],
    [1001, 2, { kind: 'tree', levels: 1, leaves: 2 }],
    [9000, 2, { kind: 'tree', levels: 1, leaves: 9 }],
    [9001, 2, { kind: 'tree', levels: 2, leaves: 10, mids: 2 }],
    [81000, 2, { kind: 'tree', levels: 2, leaves: 81, mids: 9 }],
    [81001, 2, { kind: 'over', capacity: 81000 }],
    [9001, 1, { kind: 'over', capacity: 9000 }],
  ])('%i values at %i levels → %o', (n, levels, shape) => {
    expect(treeShape(n, levels)).toEqual(shape);
  });
});

describe('buildFragment', () => {
  it('stores up to 1 000 values as one list under the root filter', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(['3', '5']), levels: 1 })).toEqual({ jql: '(issuetype in subTaskIssueTypes()) AND (parent in (3,5))' });
  });
  it('moves values that leave no room for the root filter within Jira\'s 1 000 values into one leaf call', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(ids(VALUE_LIMIT - ROOT_FILTER_VALUES + 1)), levels: 1 })).toEqual({ jql: `(issuetype in subTaskIssueTypes()) AND (${call('l1')})` });
  });
  it('keeps values that leave room for the root filter as one list', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(ids(VALUE_LIMIT - ROOT_FILTER_VALUES)), levels: 1 }).jql).toMatch(/^\(issuetype in subTaskIssueTypes\(\)\) AND \(parent in \(/);
  });
  it('counts the values the root filter lists itself, so excluded ids leave the list room only within 1 000', () => {
    const excluded = `id not in (${Array.from({ length: 300 }, (_, i) => 90000 + i).join(',')})`;
    const root = buildFragment({ ...base, functionName: 'issuesInEpics', rootFilter: excluded, page: null, values: valuesOf(ids(800)), levels: 1 });
    expect(root.jql).toEqual(`(${excluded}) AND (issue in issuesInEpics("project = \\"A\\"", "__aq:l1"))`);
    expect(buildFragment({ ...base, rootFilter: excluded, page: null, values: valuesOf(ids(VALUE_LIMIT - ROOT_FILTER_VALUES - 300)), levels: 1 }).jql).toMatch(/AND \(parent in \(/);
  });
  it('counts the values of every list in a root filter', () => {
    expect(filterValues('(issuetype in subTaskIssueTypes()) AND id not in (1,2,3) AND x in (4, 5)')).toEqual(5);
    expect(filterValues('issuetype in subTaskIssueTypes()')).toEqual(0);
  });
  it('keeps 1 000 values as one list when there is no root filter', () => {
    expect(buildFragment({ ...base, rootFilter: undefined, page: null, values: valuesOf(ids(VALUE_LIMIT)), levels: 1 }).jql).toMatch(/^parent in \(/);
  });
  it('serves the whole list from the one leaf it moved there', () => {
    expect(buildFragment({ ...base, page: { kind: 'leaf', index: 1 }, values: valuesOf(ids(VALUE_LIMIT)), levels: 1 })).toEqual({ jql: `parent in (${ids(VALUE_LIMIT).join(',')})` });
  });
  it('keeps an OR inside the root filter from escaping the AND', () => {
    expect(buildFragment({ ...base, rootFilter: 'project = A OR project = B', page: null, values: valuesOf(['3']), levels: 1 })).toEqual({ jql: '(project = A OR project = B) AND (parent in (3))' });
  });
  it('omits the filter when there is none', () => {
    expect(buildFragment({ ...base, rootFilter: undefined, field: 'id', page: null, values: valuesOf(['7']), levels: 1 })).toEqual({ jql: 'id in (7)' });
  });
  it('matches nothing for no values', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf([]), levels: 1 })).toEqual({ jql: 'id = -1' });
  });
  it('splits 2 500 values into three leaf calls that quote the subquery', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(ids(2500)), levels: 1 })).toEqual({
      jql: `(issuetype in subTaskIssueTypes()) AND (${call('l1')} OR ${call('l2')} OR ${call('l3')})`,
    });
  });
  it('gives each leaf its own 1 000 values without the root filter', () => {
    expect(buildFragment({ ...base, page: { kind: 'leaf', index: 3 }, values: valuesOf(ids(2500)), levels: 1 })).toEqual({ jql: `parent in (${ids(2500).slice(2000).join(',')})` });
  });
  it('returns EMPTY for a leaf beyond the values after the result shrank', () => {
    expect(buildFragment({ ...base, page: { kind: 'leaf', index: 2 }, values: valuesOf(ids(800)), levels: 1 })).toEqual({ jql: 'id = -1' });
  });
  it('routes 12 000 values through two middle nodes at two levels', () => {
    const v = valuesOf(ids(12000));
    expect(buildFragment({ ...base, page: null, values: v, levels: 2 })).toEqual({ jql: `(issuetype in subTaskIssueTypes()) AND (${call('m1')} OR ${call('m2')})` });
    expect(buildFragment({ ...base, page: { kind: 'mid', index: 2 }, values: v, levels: 2 })).toEqual({ jql: `(${call('l10')} OR ${call('l11')} OR ${call('l12')})` });
  });
  it('returns EMPTY for a middle node beyond the leaves', () => {
    expect(buildFragment({ ...base, page: { kind: 'mid', index: 3 }, values: valuesOf(ids(12000)), levels: 2 })).toEqual({ jql: 'id = -1' });
  });
  it('explains an over-capacity result with numbers', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(ids(9001)), levels: 1 })).toEqual({ error: 'The result needs 9,001 issues; one function returns at most 9,000. Narrow the subquery.' });
  });
  it('explains an over-capacity result with numbers at a middle node too, instead of matching nothing', () => {
    expect(buildFragment({ ...base, page: { kind: 'mid', index: 1 }, values: valuesOf(ids(81001)), levels: 2 })).toEqual({ error: 'The result needs 81,001 issues; one function returns at most 81,000. Narrow the subquery.' });
  });
});
