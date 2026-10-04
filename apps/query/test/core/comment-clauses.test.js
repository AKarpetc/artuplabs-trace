import { describe, expect, it } from 'vitest';
import { extOf, normalizeExt, parseClauses, tokenize } from '../../src/core/comment-clauses.js';
import { CLAUSES_MAX_LENGTH } from '../../src/core/limits.js';

const NOW = Date.UTC(2026, 9, 8, 15, 0);
const DAY = 86400000;

describe('tokenize', () => {
  it('keeps quoted words with spaces and function calls with inner quotes', () => {
    expect(tokenize('by "John Smith" after startOfDay("-1d")')).toEqual({ words: ['by', 'John Smith', 'after', 'startOfDay("-1d")'] });
  });
  it('rejects an unclosed quote', () => {
    expect(tokenize('by "John')).toEqual({ error: 'Unclosed quote in "by "John"' });
  });
});

describe('tokenize edges', () => {
  it('unescapes quotes inside a quoted word and keeps an empty quoted word', () => {
    expect(tokenize('by "a \\"b\\"" x ""')).toEqual({ words: ['by', 'a "b"', 'x', ''] });
  });
  it('reads nothing from blank or missing text', () => {
    expect(tokenize('  \t ')).toEqual({ words: [] });
    expect(tokenize(undefined)).toEqual({ words: [] });
  });
  it('quotes only the start of a long text with an unclosed quote', () => {
    expect(tokenize(`by "${'y'.repeat(200)}`)).toEqual({ error: `Unclosed quote in "by "${'y'.repeat(26)}…"` });
  });
  it('rejects text longer than the limit without reading it', () => {
    expect(tokenize('a'.repeat(CLAUSES_MAX_LENGTH))).toEqual({ words: ['a'.repeat(CLAUSES_MAX_LENGTH)] });
    expect(tokenize('a '.repeat(CLAUSES_MAX_LENGTH))).toEqual({ error: `Conditions are longer than ${CLAUSES_MAX_LENGTH.toLocaleString('en-US')} characters` });
  });
  it('stays fast on many unclosed quotes', () => {
    const start = performance.now();
    expect(tokenize('"\\'.repeat(CLAUSES_MAX_LENGTH / 2)).error).toMatch(/^Unclosed quote/);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('parseClauses', () => {
  it('reads people, roles and dates', () => {
    expect(parseClauses('by 5b10ac after -7d inRole Developers', 'comment', NOW)).toEqual({ clauses: { by: '5b10ac', after: NOW - 7 * DAY, inRole: 'Developers' } });
  });
  it('turns on into one UTC day', () => {
    expect(parseClauses('on 2026-03-29', 'comment', NOW)).toEqual({ clauses: { onStart: Date.UTC(2026, 2, 29), onEnd: Date.UTC(2026, 2, 30) } });
  });
  it('accepts ext only for attachments, without a dot and in lower case', () => {
    expect(parseClauses('ext .PDF', 'attachment', NOW)).toEqual({ clauses: { ext: 'pdf' } });
    expect(parseClauses('ext pdf', 'comment', NOW)).toEqual({ error: 'Unknown clause "ext"; use by, after, before, on, inRole, inGroup' });
  });
  it('rejects an extension that is empty without its dots, so it never matches every file without one', () => {
    expect(parseClauses('ext .', 'attachment', NOW)).toEqual({ error: 'Clause "ext" needs a value' });
    expect(parseClauses('ext "..."', 'attachment', NOW)).toEqual({ error: 'Clause "ext" needs a value' });
  });
  it('normalises the extension of a file name and of a clause the same way', () => {
    expect([normalizeExt('.PDF'), normalizeExt('..Tar'), normalizeExt('x'.repeat(40))]).toEqual(['pdf', 'tar', 'x'.repeat(32)]);
    expect([extOf('Report.Final.XLSX'), extOf('README'), extOf('trailing.'), extOf(undefined)]).toEqual(['xlsx', '', '', '']);
    expect(parseClauses(`ext ${'x'.repeat(40)}`, 'attachment', NOW)).toEqual({ clauses: { ext: 'x'.repeat(32) } });
  });
  it('explains a clause without a value, a repeated clause and a bad date', () => {
    expect(parseClauses('by', 'comment', NOW)).toEqual({ error: 'Clause "by" needs a value' });
    expect(parseClauses('by a by b', 'comment', NOW)).toEqual({ error: 'Clause "by" is given twice' });
    expect(parseClauses('after soon', 'comment', NOW)).toEqual({ error: 'Invalid date "soon"' });
  });
  it('means any comment when empty', () => {
    expect(parseClauses('', 'comment', NOW)).toEqual({ clauses: {} });
  });
});

describe('parseClauses edges', () => {
  it('reads clause names in any case and the remaining comment clauses', () => {
    expect(parseClauses('INGROUP "jira admins" before 2026-10-01', 'comment', NOW)).toEqual({ clauses: { inGroup: 'jira admins', before: Date.UTC(2026, 9, 1) } });
  });
  it('answers comment visibility clauses as not available yet, in any case, before reading their value', () => {
    expect(parseClauses('roleLevel Developers', 'comment', NOW)).toEqual({ error: 'Clause "roleLevel" is not available yet' });
    expect(parseClauses('by a GROUPLEVEL', 'comment', NOW)).toEqual({ error: 'Clause "groupLevel" is not available yet' });
    expect(parseClauses('roleLevel x', 'attachment', NOW)).toEqual({ error: 'Unknown clause "roleLevel"; use by, after, before, on, ext' });
  });
  it('rejects an extension with a dot inside, which no file extension can be', () => {
    expect(parseClauses('ext tar.gz', 'attachment', NOW)).toEqual({ error: 'ext takes the part after the last dot, such as gz' });
  });
  it('lists the attachment clauses and rejects comment-only ones there', () => {
    expect(parseClauses('inRole Developers', 'attachment', NOW)).toEqual({ error: 'Unknown clause "inRole"; use by, after, before, on, ext' });
  });
  it('cuts on with a time to the whole UTC day and rejects a bad on date', () => {
    expect(parseClauses('on "2026-03-29 18:00"', 'attachment', NOW)).toEqual({ clauses: { onStart: Date.UTC(2026, 2, 29), onEnd: Date.UTC(2026, 2, 30) } });
    expect(parseClauses('on yesterday', 'attachment', NOW)).toEqual({ error: 'Invalid date "yesterday"' });
  });
  it('rejects an empty quoted value', () => {
    expect(parseClauses('by ""', 'comment', NOW)).toEqual({ error: 'Clause "by" needs a value' });
  });
  it('treats on given twice as repeated', () => {
    expect(parseClauses('on -1d on -2d', 'comment', NOW)).toEqual({ error: 'Clause "on" is given twice' });
  });
  it('quotes only the start of a long unknown clause', () => {
    expect(parseClauses(`${'z'.repeat(100)} 1`, 'attachment', NOW)).toEqual({ error: `Unknown clause "${'z'.repeat(30)}…"; use by, after, before, on, ext` });
  });
  it('passes on tokenizer errors and rejects an unknown kind', () => {
    expect(parseClauses('by "x', 'comment', NOW)).toEqual({ error: 'Unclosed quote in "by "x"' });
    expect(parseClauses('by x', 'worklog', NOW)).toEqual({ error: 'Unknown clause "by"; use ' });
  });
});
