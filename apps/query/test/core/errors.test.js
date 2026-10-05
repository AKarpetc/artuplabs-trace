import { describe, expect, it } from 'vitest';
import { ERR, FAIL, LOG } from '../../src/core/errors.js';

describe('error texts', () => {
  it('groups thousands in counts', () => {
    expect(ERR.indexBuilding(1500, 40000)).toBe('Index is building: 1,500 of 40,000 issues');
    expect(ERR.tooMany(12000, 9000)).toBe('The result needs 12,000 issues; one function returns at most 9,000. Narrow the subquery.');
  });
  it('quotes the value that was not found or is ambiguous', () => {
    expect(ERR.notFound('Board', 'DEMO')).toBe('Board "DEMO" not found');
    expect(ERR.ambiguous('Sprint', 'S1', 2)).toBe('Sprint "S1" matches 2 items; use its id');
  });
  it('prefixes a message with the function name', () => {
    expect(ERR.withFunction('parentsOf', ERR.perUser('currentUser()'))).toBe('parentsOf: currentUser() is not supported: results are shared by all users');
  });
  it('names the licence, computing and excluded-project states', () => {
    expect([ERR.unlicensed(), ERR.computing(), ERR.excluded('HR')]).toEqual([
      'ArtUp Query license is not active', 'Computing, retry in a minute', 'Project HR is excluded from the ArtUp Query index',
    ]);
  });
  it('names a rejected subquery without quoting it', () => {
    expect(ERR.subqueryRejected()).toBe('Subquery rejected by Jira');
  });
  it('logs a missing or ambiguous value without the value', () => {
    expect([FAIL.notFound('Board', 'Payroll board'), FAIL.ambiguous('Link type', 'secret', 2)]).toEqual([
      { error: 'Board "Payroll board" not found', log: 'Board not found' },
      { error: 'Link type "secret" matches 2 items; use its id', log: 'Link type is ambiguous' },
    ]);
  });
  it('logs an excluded project without its key', () => {
    expect(FAIL.excluded('HR')).toEqual({ error: 'Project HR is excluded from the ArtUp Query index', log: 'Project is excluded' });
  });
});

describe('Jira points errors', () => {
  it('names the subquery size, the points, the limit and how far to narrow', () => {
    expect(ERR.tooExpensive('subtasksOf', { n: 4213, points: 8446, limit: 1800, issues: 890 }))
      .toEqual("subtasksOf: the subquery has about 4,213 issues and needs about 8,446 Jira API points; on this site ArtUp Query may spend at most 1,800 on one function (Jira's rate limit for apps). Narrow the subquery to about 890 issues.");
  });
  it('says at least for a lower bound', () => {
    expect(ERR.tooExpensive('childIssuesOf', { n: 2000, points: 4020, limit: 1800, issues: 890, floor: true })).toContain('needs at least 4,020 Jira API points');
  });
  it('names only the points and the limit for a function without a subquery', () => {
    expect(ERR.tooExpensive('hasSubtasks', { n: 3000, points: 6020, limit: 1800, issues: 890 }))
      .toEqual("hasSubtasks: the site has about 3,000 matching issues and needs about 6,020 Jira API points; on this site ArtUp Query may spend at most 1,800 on one function (Jira's rate limit for apps).");
  });
  it('says the result needs more than the limit when the computation reached it', () => {
    expect(ERR.tooExpensive('expression', { n: null, points: null, limit: 1800 }))
      .toEqual("expression: the result needs more than 1,800 Jira API points; on this site ArtUp Query may spend at most 1,800 on one function (Jira's rate limit for apps). Narrow the subquery.");
  });
  it('names the points the result needs when the subquery was not counted', () => {
    expect(ERR.tooExpensive('expression', { n: null, points: 2500, limit: 1800 }))
      .toEqual("expression: the result needs about 2,500 Jira API points; on this site ArtUp Query may spend at most 1,800 on one function (Jira's rate limit for apps). Narrow the subquery.");
  });
  it('gives no advice to narrow a subquery to a function without one', () => {
    expect(ERR.tooExpensive('hasLinks', { n: null, points: null, limit: 1800 })).toEqual("hasLinks: the result needs more than 1,800 Jira API points; on this site ArtUp Query may spend at most 1,800 on one function (Jira's rate limit for apps).");
  });
  it('names the UTC time to retry after the hourly allowance', () => {
    expect(ERR.allowanceUsed(Date.parse('2026-10-05T14:00:00Z'))).toEqual("ArtUp Query has used this site's Jira API allowance for this hour; retry after 14:00 UTC.");
  });
  it('logs both without numbers or values', () => {
    expect([LOG.tooExpensive(), LOG.allowanceUsed()]).toEqual(['Too expensive for the Jira rate limit', 'Hourly Jira allowance used']);
  });
});
