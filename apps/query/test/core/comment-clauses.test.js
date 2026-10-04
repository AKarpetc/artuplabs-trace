import { describe, expect, it } from 'vitest';
import { issuesWith, metaMatches, parseClauses, tokenize, extOf, normalizeExt } from '../../src/core/comment-clauses.js';
import { CLAUSES_MAX_LENGTH } from '../../src/core/limits.js';

const NOW = Date.UTC(2026, 9, 8, 15, 0);
const DAY = 86400000;
const meta = (id, issueId, author, createdAt, extra = {}) => ({ id, issueId, projectId: '1', author, createdAt, visType: null, visValue: null, ext: '', ...extra });

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
    expect(parseClauses('ext pdf', 'comment', NOW)).toEqual({ error: 'Unknown clause "ext"; use by, after, before, on, inRole, inGroup, roleLevel, groupLevel' });
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
    expect(parseClauses('INGROUP "jira admins" ROLELEVEL Developers groupLevel staff before 2026-10-01', 'comment', NOW)).toEqual({
      clauses: { inGroup: 'jira admins', roleLevel: 'Developers', groupLevel: 'staff', before: Date.UTC(2026, 9, 1) },
    });
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

describe('matching', () => {
  const metas = [
    meta('1', '10', 'a', 100),
    meta('2', '10', 'b', 200),
    meta('3', '11', 'a', 150, { visType: 'role', visValue: 'Developers' }),
    meta('4', '12', 'c', 50, { projectId: '2' }),
  ];
  it('finds issues with any matching comment', () => {
    expect(issuesWith(metas, { by: 'a' }, { people: { by: new Set(['a']) } })).toEqual(['10', '11']);
  });
  it('checks only the last comment with last', () => {
    expect(issuesWith(metas, { by: 'a' }, { last: true, people: { by: new Set(['a']) } })).toEqual(['11']);
  });
  it('reads visibility for roleLevel and author membership per project for inRole', () => {
    expect(issuesWith(metas, { roleLevel: 'developers' }, {})).toEqual(['11']);
    expect(issuesWith(metas, { inRole: 'Dev' }, { people: { inRole: new Map([['1', new Set(['b'])]]) } })).toEqual(['10']);
  });
  it('applies date windows strictly after and before', () => {
    expect(metaMatches(metas[0], { after: 100 }, {})).toBe(false);
    expect(metaMatches(metas[0], { before: 101 }, {})).toBe(true);
    expect(metaMatches(metas[0], { onStart: 0, onEnd: 100 }, {})).toBe(false);
  });
});

describe('matching edges', () => {
  const metas = [
    meta('9', '20', 'a', 300, { visType: 'group', visValue: 'Staff', ext: 'pdf' }),
    meta('10', '20', 'b', 300, { ext: 'png' }),
    meta('5', '21', 'a', 100, { projectId: 3, ext: 'pdf' }),
    meta('6', '21', 'b', 90),
  ];
  it('matches every comment with no clauses and without options', () => {
    expect(issuesWith(metas, {})).toEqual(['20', '21']);
    expect(issuesWith([], {}, { last: true })).toEqual([]);
  });
  it('breaks a tie on the time by the larger numeric id for last', () => {
    expect(issuesWith(metas, { ext: 'png' }, { last: true })).toEqual(['20']);
    expect(issuesWith([...metas].reverse(), { ext: 'png' }, { last: true })).toEqual(['20']);
  });
  it('matches group visibility, group membership and the extension', () => {
    expect(issuesWith(metas, { groupLevel: 'staff' }, {})).toEqual(['20']);
    expect(issuesWith(metas, { roleLevel: 'staff' }, {})).toEqual([]);
    expect(issuesWith(metas, { inGroup: 'g' }, { people: { inGroup: new Set(['b']) } })).toEqual(['20', '21']);
    expect(issuesWith(metas, { ext: 'pdf' }, {})).toEqual(['20', '21']);
  });
  it('finds no one when people were not resolved', () => {
    expect(metaMatches(metas[0], { by: 'a' }, undefined)).toBe(false);
    expect(metaMatches(metas[0], { inGroup: 'g' }, {})).toBe(false);
    expect(metaMatches(metas[0], { inRole: 'r' }, { inRole: new Map() })).toBe(false);
  });
  it('reads the role of an author in a numeric project id', () => {
    expect(metaMatches(metas[2], { inRole: 'r' }, { inRole: new Map([['3', new Set(['a'])]]) })).toBe(true);
  });
  it('includes the start of an on day and excludes its end', () => {
    expect(metaMatches(metas[2], { onStart: 100, onEnd: 200 }, {})).toBe(true);
    expect(metaMatches(metas[2], { after: 99, before: 101 }, {})).toBe(true);
    expect(metaMatches(metas[2], { after: 100 }, {})).toBe(false);
    expect(metaMatches(metas[2], { before: 100 }, {})).toBe(false);
  });
  it('treats a missing visibility value as no match', () => {
    expect(metaMatches(meta('1', '1', 'a', 1, { visType: 'role' }), { roleLevel: 'x' }, {})).toBe(false);
  });
});
