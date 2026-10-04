import { describe, expect, it } from 'vitest';
import { EMPTY, forOperator, isNotIn, pageCall, quote } from '../../src/core/jql-build.js';

describe('quote', () => {
  it('escapes quotes and backslashes', () => {
    expect(quote('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });
  it('keeps unicode as it is', () => {
    expect(quote('метка = "тест"')).toBe('"метка = \\"тест\\""');
  });
});

describe('pageCall', () => {
  it('repeats a nested function call byte for byte and appends the page token', () => {
    const inner = 'issue in linkedIssuesOf("project = A", "blocks")';
    expect(pageCall('subtasksOf', [inner], { kind: 'leaf', index: 2 })).toBe('issue in subtasksOf("issue in linkedIssuesOf(\\"project = A\\", \\"blocks\\")", "__aq:l2")');
  });
  it('matches no issue with EMPTY', () => {
    expect(EMPTY).toBe('id = -1');
  });
});

describe('forOperator', () => {
  it('keeps the JQL of an in clause and of a clause without an operator', () => {
    expect([forOperator('id in (1,2)', 'in'), forOperator('id in (1,2)', undefined), forOperator('id in (1)', 'IN')]).toEqual(['id in (1,2)', 'id in (1,2)', 'id in (1)']);
  });
  it('answers not in with the complement of the JQL, whatever its spelling', () => {
    expect(['not in', 'NOT IN', 'not_in', 'NOT_IN', ' not  in '].map((op) => forOperator('id in (1,2)', op))).toEqual(Array(5).fill('NOT (id in (1,2))'));
  });
  it('complements an empty result into every issue and a negated JQL back into the positive set', () => {
    expect(forOperator(EMPTY, 'not in')).toBe('NOT (id = -1)');
    expect(forOperator('NOT (issue in hasComments("+2"))', 'not in')).toBe('NOT (NOT (issue in hasComments("+2")))');
  });
  it('never adds a project clause, whatever else is passed', () => {
    expect([forOperator('id in (1)', 'in', ['OPS']), forOperator('id in (1)', 'not in', ['OPS'])]).toEqual(['id in (1)', 'NOT (id in (1))']);
  });
  it('tells a not in operator', () => {
    expect([isNotIn('not in'), isNotIn('NOT_IN'), isNotIn('in'), isNotIn(null)]).toEqual([true, true, false, false]);
  });
});
