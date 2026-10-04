import { describe, expect, it } from 'vitest';
import { groupKey, pageOf, pageToken, parseArgs, splitPage } from '../../src/core/args.js';

describe('page tokens', () => {
  it('round-trips leaf and middle pages', () => {
    expect(pageOf(pageToken({ kind: 'leaf', index: 7 }))).toEqual({ kind: 'leaf', index: 7 });
    expect(pageOf(pageToken({ kind: 'mid', index: 2 }))).toEqual({ kind: 'mid', index: 2 });
  });
  it('rejects strings that only look like a token', () => {
    expect([pageOf('__aq:l0'), pageOf('__aq:x1'), pageOf('tree:3'), pageOf(' __aq:l1'), pageOf(undefined)]).toEqual([null, null, null, null, null]);
  });
  it('strips only a trailing token', () => {
    expect(splitPage(['project = A', '__aq:l2'])).toEqual({ userArgs: ['project = A'], page: { kind: 'leaf', index: 2 } });
    expect(splitPage(['__aq:l2', 'blocks'])).toEqual({ userArgs: ['__aq:l2', 'blocks'], page: null });
    expect(splitPage(undefined)).toEqual({ userArgs: [], page: null });
  });
  it('reads missing arguments as empty strings', () => {
    expect(splitPage([null, undefined])).toEqual({ userArgs: ['', ''], page: null });
  });
});

describe('parseArgs', () => {
  it('names the arguments of a function', () => {
    expect(parseArgs('linkedIssuesOfRecursiveLimited', ['key = A-1', ' 3 ', 'blocks'])).toEqual({
      args: { subquery: 'key = A-1', depth: 3, linkType: 'blocks' }, userArgs: ['key = A-1', ' 3 ', 'blocks'], page: null,
    });
  });
  it('keeps the page token apart from optional arguments', () => {
    expect(parseArgs('childIssuesOf', ['key = A-1', '__aq:m1'])).toEqual({ args: { subquery: 'key = A-1' }, userArgs: ['key = A-1'], page: { kind: 'mid', index: 1 } });
  });
  it('explains the usage when arguments are missing or extra', () => {
    expect(parseArgs('subtasksOf', [])).toEqual({ error: 'Usage: subtasksOf(subquery)' });
    expect(parseArgs('hasSubtasks', ['x'])).toEqual({ error: 'Usage: hasSubtasks()' });
    expect(parseArgs('addedAfterSprintStart', [])).toEqual({ error: 'Usage: addedAfterSprintStart(board, [sprint])' });
  });
  it('rejects a count of links or attachments as a second argument', () => {
    expect(parseArgs('hasLinks', ['blocks', '+2'])).toEqual({ error: 'Usage: hasLinks([linkType])' });
    expect(parseArgs('hasAttachments', ['pdf', '+3'])).toEqual({ error: 'Usage: hasAttachments([extension])' });
  });
  it('asks for one call per link type when several link types are given', () => {
    expect(parseArgs('linkedIssuesOf', ['', 'is blocked by', 'is cloned by'])).toEqual({
      error: 'linkedIssuesOf: takes one link type; call it once per link type and join the calls with OR, e.g. issue in linkedIssuesOf(…, "is blocked by") OR issue in linkedIssuesOf(…, "is cloned by")',
      log: 'Several link types',
    });
    expect(parseArgs('linkedIssuesOfRecursive', ['key = A-1', 'blocks', 'clones', 'relates to']).error).toMatch(/^linkedIssuesOfRecursive: takes one link type;/);
  });
  it('still explains the usage when a link function gets too few arguments', () => {
    expect(parseArgs('linkedIssuesOf', [])).toEqual({ error: 'Usage: linkedIssuesOf(subquery, [linkType])' });
  });
  it('rejects a depth outside 1..10 or not a number', () => {
    expect(parseArgs('childIssuesOf', ['key = A-1', '11'])).toEqual({ error: 'childIssuesOf: depth must be between 1 and 10' });
    expect(parseArgs('childIssuesOf', ['key = A-1', '0'])).toEqual({ error: 'childIssuesOf: depth must be between 1 and 10' });
    expect(parseArgs('childIssuesOf', ['key = A-1', 'two'])).toEqual({ error: 'childIssuesOf: depth must be a whole number' });
  });
  it('rejects an empty subquery', () => {
    expect(parseArgs('parentsOf', ['  '])).toEqual({ error: 'parentsOf: subquery must not be empty' });
  });
  it('rejects currentUser() because results are shared by all users', () => {
    expect(parseArgs('parentsOf', ['assignee = currentUser()'])).toEqual({ error: 'parentsOf: currentUser() is not supported: results are shared by all users' });
    expect(parseArgs('commented', ['by currentUser()'])).toEqual({ error: 'commented: currentUser() is not supported: results are shared by all users' });
  });
  it('normalises a file extension', () => {
    expect(parseArgs('hasAttachments', ['.XLSX']).args).toEqual({ extension: 'xlsx' });
  });
  it('rejects an extension that is only dots', () => {
    expect(parseArgs('hasAttachments', ['..'])).toEqual({ error: 'hasAttachments: extension must not be empty' });
  });
  it('runs comment functions without clauses', () => {
    expect(parseArgs('lastComment', [])).toEqual({ args: {}, userArgs: [], page: null });
  });
  it('rejects an unknown function', () => {
    expect(parseArgs('nope', [])).toEqual({ error: 'Unknown function nope' });
  });
  it('builds the same group key for the root and its pages', () => {
    const root = parseArgs('subtasksOf', ['project = "A"']);
    const leaf = parseArgs('subtasksOf', ['project = "A"', '__aq:l4']);
    expect(groupKey('subtasksOf', leaf.userArgs)).toBe(groupKey('subtasksOf', root.userArgs));
    expect(groupKey('subtasksOf', ['a'])).not.toBe(groupKey('parentsOf', ['a']));
  });
});

describe('hasComments count', () => {
  it('reads a bare number as exactly that many comments', () => {
    expect(parseArgs('hasComments', ['3']).args).toEqual({ count: { op: 'exactly', n: 3 } });
  });
  it('reads +n as more than n comments', () => {
    expect(parseArgs('hasComments', [' +5 ']).args).toEqual({ count: { op: 'more', n: 5 } });
  });
  it('reads -n as fewer than n comments', () => {
    expect(parseArgs('hasComments', ['-3']).args).toEqual({ count: { op: 'fewer', n: 3 } });
  });
  it('means any comment without a count', () => {
    expect(parseArgs('hasComments', []).args).toEqual({});
  });
  it('rejects a count that is not a signed whole number', () => {
    expect(parseArgs('hasComments', ['>=2'])).toEqual({ error: 'hasComments: count must be a whole number, optionally with + or -' });
    expect(parseArgs('hasComments', ['+'])).toEqual({ error: 'hasComments: count must be a whole number, optionally with + or -' });
  });
  it('rejects a count outside 1..10000', () => {
    expect(parseArgs('hasComments', ['0'])).toEqual({ error: 'hasComments: count must be between 1 and 10000' });
    expect(parseArgs('hasComments', ['+10001'])).toEqual({ error: 'hasComments: count must be between 1 and 10000' });
  });
});
