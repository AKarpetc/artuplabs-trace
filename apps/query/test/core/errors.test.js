import { describe, expect, it } from 'vitest';
import { ERR, FAIL } from '../../src/core/errors.js';

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
