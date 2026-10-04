import { describe, expect, it } from 'vitest';
import { evaluate, fieldValue, parseExpression } from '../../src/core/expression.js';

const run = (text, values, mode) => {
  const p = parseExpression(text);
  if (p.error) return p;
  return evaluate(p.ast, (name) => values[name] ?? null, mode);
};

describe('parseExpression', () => {
  it('reads precedence and canonical field names', () => {
    const p = parseExpression('timespent > originalestimate * 1.2');
    expect(p.fields).toEqual(['timeoriginalestimate', 'timespent']);
    expect(p.ast).toEqual({ k: 'cmp', op: '>', l: { k: 'field', name: 'timespent' }, r: { k: 'bin', op: '*', l: { k: 'field', name: 'timeoriginalestimate' }, r: { k: 'num', v: 1.2 } } });
  });
  it('keeps quoted field names and duration literals', () => {
    expect(parseExpression('"Story Points" >= 5 and created + 2d < firstCommented').fields).toEqual(['Story Points', 'created', 'firstcommented']);
  });
  it('explains what is wrong', () => {
    expect(parseExpression('timespent >')).toEqual({ error: 'Unexpected end of expression' });
    expect(parseExpression('timespent + 1')).toEqual({ error: 'The expression must compare values, such as a > b' });
    expect(parseExpression('2days > 1')).toEqual({ error: 'Unexpected "2days > 1" at 1' });
    expect(parseExpression('(a > b')).toEqual({ error: 'Missing ")"' });
    expect(parseExpression('a > b c')).toEqual({ error: 'Unexpected "c" at 7' });
    expect(parseExpression('(a > b) + 1 > 2')).toEqual({ error: 'Cannot do arithmetic on a comparison' });
  });
});

describe('evaluate', () => {
  it('compares work time in seconds with 1d = 8h', () => {
    expect(run('timespent > originalestimate * 1.2', { timespent: 36000, timeoriginalestimate: 28800 }, 'number')).toBe(true);
    expect(run('timespent >= 1d', { timespent: 28800 }, 'number')).toBe(true);
    expect(run('timespent >= 1w', { timespent: 5 * 28800 - 1 }, 'number')).toBe(false);
  });
  it('compares dates with calendar intervals', () => {
    const d = Date.UTC(2026, 0, 1);
    expect(run('created + 2d < firstcommented', { created: d, firstcommented: d + 3 * 86400000 }, 'date')).toBe(true);
    expect(run('resolutiondate > duedate', { resolutiondate: d, duedate: d + 1 }, 'date')).toBe(false);
  });
  it('treats a missing value or a division by zero as not matching', () => {
    expect(run('duedate < created', { created: 1 }, 'date')).toBe(false);
    expect(run('votes / watches > 1', { votes: 3, watches: 0 }, 'number')).toBe(false);
  });
  it('combines comparisons with and and or, and negates', () => {
    expect(run('a > 1 and b < 1 or -a < -5', { a: 6, b: 2 }, 'number')).toBe(true);
    expect(run('a > 1 AND b < 1', { a: 6, b: 2 }, 'number')).toBe(false);
  });
});

describe('fieldValue', () => {
  it('reads numbers, dates and Jira objects', () => {
    expect([fieldValue(5), fieldValue('7'), fieldValue('2026-01-02'), fieldValue('2026-01-02T03:04:05.000+0000'), fieldValue({ votes: 2 }), fieldValue({ watchCount: 4 }), fieldValue({ value: 3 }), fieldValue(null), fieldValue('n/a')])
      .toEqual([5, 7, Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 2, 3, 4, 5), 2, 4, 3, null, null]);
  });
});

describe('expression edge cases', () => {
  it('points at the original text of a stray token', () => {
    expect(parseExpression('a > b Due')).toEqual({ error: 'Unexpected "Due" at 7' });
    expect(parseExpression('a > b  2d')).toEqual({ error: 'Unexpected "2d" at 8' });
    expect(parseExpression('> 1')).toEqual({ error: 'Unexpected ">" at 1' });
    expect(parseExpression('a > b and')).toEqual({ error: 'Unexpected end of expression' });
    expect(parseExpression(null)).toEqual({ error: 'Unexpected end of expression' });
  });
  it('reads symbolic and, or, escapes in quoted names and every comparison', () => {
    expect(parseExpression('"a \\"b\\"" > 1 && c < 2 || d = 3').fields).toEqual(['a "b"', 'c', 'd']);
    const v = { a: 2, b: 3 };
    expect(['a < b', 'a <= b', 'a > b', 'a >= b', 'a = b', 'a == 2', 'a != b'].map((t) => run(t, v, 'number')))
      .toEqual([true, true, false, false, false, true, true]);
  });
  it('does arithmetic and keeps empty values empty', () => {
    expect(run('a - b / 2 = 0.5', { a: 2, b: 3 }, 'number')).toBe(true);
    expect(run('-a < 0', {}, 'number')).toBe(false);
    expect(run('-(a) * 2 = -4', { a: 2 }, 'number')).toBe(true);
    expect(run('a + 1h > 3599', { a: 0 }, 'number')).toBe(true);
    expect(run('a + 30m = b', { a: 0, b: 1800000 }, 'date')).toBe(true);
  });
  it('reads unknown objects and malformed dates as empty', () => {
    expect([fieldValue({ name: 'x' }), fieldValue('2026-13-45'), fieldValue('2026-01-02T03:04:05.000Z')])
      .toEqual([null, null, Date.UTC(2026, 0, 2, 3, 4, 5)]);
  });
});

describe('expression bounds', () => {
  it('rejects text longer than the length limit', () => {
    expect(parseExpression(`a > ${'1'.repeat(1000)}`)).toEqual({ error: 'The expression is longer than 1,000 characters' });
  });
  it('rejects deeply nested parentheses', () => {
    expect(parseExpression(`${'('.repeat(65)}a > 1${')'.repeat(65)}`)).toEqual({ error: 'The expression is nested deeper than 64 levels' });
  });
  it('rejects a long chain of leading minus signs', () => {
    expect(parseExpression(`${'-'.repeat(70)}a > 1`)).toEqual({ error: 'The expression is nested deeper than 64 levels' });
  });
  it('rejects a long arithmetic chain', () => {
    expect(parseExpression(`${Array(70).fill('a').join(' + ')} > 1`)).toEqual({ error: 'The expression is nested deeper than 64 levels' });
  });
  it('rejects a long chain of or', () => {
    expect(parseExpression(Array(70).fill('a > 1').join(' or '))).toEqual({ error: 'The expression is nested deeper than 64 levels' });
  });
  it('accepts an expression at the depth limit', () => {
    expect(parseExpression(`${Array(63).fill('a').join(' + ')} > 1`).error).toBeUndefined();
  });
  it('never throws from evaluate, even when called deep in the stack', () => {
    const p = parseExpression(`${Array(63).fill('a').join(' + ')} > 1`);
    const deep = (n) => (n === 0 ? evaluate(p.ast, () => 1, 'number') : deep(n - 1));
    expect(deep(5000)).toBe(true);
  });
  it('quotes at most 30 characters of the text in an error', () => {
    expect(parseExpression(`2days ${'x'.repeat(100)}`)).toEqual({ error: `Unexpected "2days ${'x'.repeat(24)}…" at 1` });
  });
});

describe('and and or operands', () => {
  it('rejects bare fields joined by and', () => {
    expect(parseExpression('a and b')).toEqual({ error: 'The expression must compare values, such as a > b' });
  });
  it('rejects a comparison and a bare field joined by and', () => {
    expect(parseExpression('a > 1 and b')).toEqual({ error: 'The expression must compare values, such as a > b' });
  });
  it('rejects a bare field on the left of or', () => {
    expect(parseExpression('a or b > 1')).toEqual({ error: 'The expression must compare values, such as a > b' });
  });
  it('accepts nested and and or in parentheses', () => {
    expect(run('(a > 1 or b > 1) and (a < 9)', { a: 2, b: 0 }, 'number')).toBe(true);
  });
});

describe('non-finite and malformed values', () => {
  it('treats an infinite literal as empty', () => {
    expect(run(`a < ${'9'.repeat(400)}`, { a: 1 }, 'number')).toBe(false);
  });
  it('treats NaN from arithmetic as empty so != does not match', () => {
    expect(run(`a - a != 1`, { a: Infinity }, 'number')).toBe(false);
  });
  it('reads NaN and Infinity field values as empty', () => {
    expect([fieldValue(NaN), fieldValue(Infinity)]).toEqual([null, null]);
  });
  it('rejects an empty quoted name', () => {
    expect(parseExpression('"" > 1')).toEqual({ error: 'Unexpected """" at 1' });
  });
  it('returns null for a duration in an unknown mode', () => {
    expect(evaluate({ k: 'dur', v: 1, unit: 'd' }, () => null, 'text')).toBeNull();
  });
});

describe('evaluate guard', () => {
  it('returns null when reading a value throws', () => {
    const p = parseExpression('a > 1');
    expect(evaluate(p.ast, () => { throw new Error('boom'); }, 'number')).toBeNull();
  });
});
