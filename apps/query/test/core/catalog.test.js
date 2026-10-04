import { describe, expect, it } from 'vitest';
import { FUNCTIONS, FUNCTION_BY_NAME, SHIPPED_GROUPS, shippedFunctions, usage } from '../../src/core/catalog.js';

describe('catalog', () => {
  it('defines 24 functions with unique names and keys', () => {
    expect(FUNCTIONS).toHaveLength(24);
    expect(new Set(FUNCTIONS.map((f) => f.name)).size).toBe(24);
    expect(new Set(FUNCTIONS.map((f) => f.key)).size).toBe(24);
  });
  it('uses lower-case kebab keys', () => {
    expect(FUNCTIONS.filter((f) => !/^[a-z][a-z-]{2,40}$/.test(f.key))).toEqual([]);
  });
  it('keeps required arguments before optional ones', () => {
    for (const f of FUNCTIONS) {
      const flags = f.args.map((a) => a.required);
      expect(flags, f.name).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    }
  });
  it('gives every function an example that calls it with issue in', () => {
    expect(FUNCTIONS.filter((f) => !f.examples.length || !f.examples.every((e) => e.includes(`issue in ${f.name}(`)))).toEqual([]);
  });
  it('writes optional arguments in brackets', () => {
    expect(usage(FUNCTION_BY_NAME.get('linkedIssuesOfRecursiveLimited'))).toBe('linkedIssuesOfRecursiveLimited(subquery, depth, [linkType])');
    expect(usage(FUNCTION_BY_NAME.get('hasSubtasks'))).toBe('hasSubtasks()');
  });
  it('lets lastComment and commented run without clauses', () => {
    expect([usage(FUNCTION_BY_NAME.get('commented')), usage(FUNCTION_BY_NAME.get('lastComment'))]).toEqual(['commented([clauses])', 'lastComment([clauses])']);
  });
  it('takes a signed comment count in hasComments', () => {
    expect(FUNCTION_BY_NAME.get('hasComments').args).toEqual([{ name: 'count', type: 'count', required: false, min: 1, max: 10000 }]);
  });
  it('requires the sprint only where the closed sprint matters', () => {
    expect(['addedAfterSprintStart', 'removedAfterSprintStart', 'incompleteInSprint', 'completeInSprint'].map((n) => usage(FUNCTION_BY_NAME.get(n)))).toEqual([
      'addedAfterSprintStart(board, [sprint])', 'removedAfterSprintStart(board, [sprint])', 'incompleteInSprint(board, sprint)', 'completeInSprint(board, sprint)',
    ]);
  });
  it('ships the groups built so far', () => {
    expect(SHIPPED_GROUPS).toEqual(['query', 'site', 'board', 'sprint', 'comment', 'attachment', 'fields']);
    expect(shippedFunctions().map((f) => f.name)).toEqual([
      'subtasksOf', 'parentsOf', 'epicsOf', 'issuesInEpics', 'childIssuesOf', 'linkedIssuesOf', 'linkedIssuesOfRecursive', 'linkedIssuesOfRecursiveLimited', 'hasLinks', 'hasLinkType', 'hasSubtasks', 'previousSprint', 'nextSprint',
      'addedAfterSprintStart', 'removedAfterSprintStart', 'incompleteInSprint', 'completeInSprint',
      'commented', 'lastComment', 'hasComments', 'fileAttached', 'hasAttachments', 'dateCompare', 'expression',
    ]);
  });
});
