import { describe, expect, it } from 'vitest';
import { commentCountTest, compileExpression, hasExtension, linkedOthers, valueOfField } from '../../scripts/lib/reference.mjs';

const BLOCKS = { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' };
const RELATES = { name: 'Relates', outward: 'relates to', inward: 'relates to' };
const issue = {
  fields: {
    issuelinks: [
      { type: BLOCKS, outwardIssue: { id: '1' } },
      { type: BLOCKS, inwardIssue: { id: '2' } },
      { type: RELATES, inwardIssue: { id: '3' } },
    ],
  },
};

describe('reference link direction', () => {
  it('takes every link without a type', () => {
    expect(linkedOthers(issue)).toEqual(['1', '2', '3']);
  });
  it('takes both sides for the exact type name', () => {
    expect(linkedOthers(issue, 'Blocks')).toEqual(['1', '2']);
  });
  it('takes one side for a direction description, whatever its case', () => {
    expect([linkedOthers(issue, 'BLOCKS '), linkedOthers(issue, 'is blocked by')]).toEqual([['1'], ['2']]);
  });
  it('takes both sides when both descriptions are the same', () => {
    expect(linkedOthers(issue, 'relates to')).toEqual(['3']);
  });
  it('matches a type name loosely only when it is no description', () => {
    expect([linkedOthers(issue, 'relates'), linkedOthers(issue, 'unknown')]).toEqual([['3'], []]);
  });
});

describe('reference comment helpers', () => {
  it('reads a hasComments argument the ScriptRunner way, fewer than n including no comments', () => {
    const counts = [0, 1, 2, 3, 4];
    const passing = (arg) => counts.filter(commentCountTest(arg));
    expect([passing(undefined), passing('2'), passing('+2'), passing('-2')]).toEqual([[1, 2, 3, 4], [2], [3, 4], [0, 1]]);
    expect(() => commentCountTest('two')).toThrow('unsupported comment count');
  });
  it('matches a file extension without its leading dots and never an empty one', () => {
    expect([hasExtension('Report.PDF', '.pdf'), hasExtension('report.pdf', 'df'), hasExtension('README', '.'), hasExtension('a.tar.gz', 'gz')]).toEqual([true, false, false, true]);
  });
});

describe('reference field expressions', () => {
  const values = { timespent: 36000, timeoriginalestimate: 28800, duedate: Date.UTC(2026, 0, 5), resolutiondate: Date.UTC(2026, 0, 7), 'Story Points': null };
  const get = (name) => values[name] ?? null;
  it('reads aliases, quoted names, work and calendar durations', () => {
    expect(compileExpression('timespent > originalestimate * 1.2', 'number').test(get)).toBe(true);
    expect(compileExpression('resolutiondate > due + 1d', 'date').test(get)).toBe(true);
    expect(compileExpression('timespent >= 1d + 2h', 'number').test(get)).toBe(true);
    expect(compileExpression('"Story Points" >= 0 || timespent / 0 > 1', 'number')).toMatchObject({ fields: ['Story Points', 'timespent'] });
    expect(compileExpression('"Story Points" >= 0 || timespent / 0 > 1', 'number').test(get)).toBe(false);
    expect(compileExpression('(timespent - 1h) > 8h and -timespent < 0', 'number').test(get)).toBe(true);
  });
  it('refuses text it cannot read', () => {
    expect(() => compileExpression('timespent >', 'number')).toThrow('reference: cannot read');
    expect(() => compileExpression('timespent', 'number')).toThrow('reference: cannot read');
  });
  it('turns REST values into numbers', () => {
    expect([valueOfField(null), valueOfField(3), valueOfField({ votes: 2 }), valueOfField('7'), valueOfField('2026-01-05'), valueOfField('2026-01-07T00:00:00.000+0000'), valueOfField('x')])
      .toEqual([null, 3, 2, 7, Date.UTC(2026, 0, 5), Date.UTC(2026, 0, 7), null]);
  });
});
