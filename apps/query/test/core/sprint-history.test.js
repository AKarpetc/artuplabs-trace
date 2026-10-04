import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addedAfterStart, categoryAt, createdInSprint, membersAt, removedAfterStart, sprintEvents, sprintIdsOf, sprintOutcome, statusEvents, toMs } from '../../src/core/sprint-history.js';

const FIELDS = new Set(['customfield_10020']);
const ev = (issueId, sprintId, kind, at, changeId = at) => ({ issueId, sprintId, kind, at, changeId: String(changeId) });
const W = { startAt: 100, completeAt: 200 };

describe('changelog parsing', () => {
  it('reads Jira times with a +0000 offset, ISO times and numbers', () => {
    expect([toMs('2026-01-01T10:00:00.000+0000'), toMs('2026-01-01T10:00:00Z'), toMs(5), toMs(undefined)]).toEqual([Date.UTC(2026, 0, 1, 10), Date.UTC(2026, 0, 1, 10), 5, null]);
  });
  it('reads epoch milliseconds sent as a string and rejects garbage', () => {
    expect([toMs('1791098894523'), toMs('soon'), toMs(Number.NaN)]).toEqual([1791098894523, null, null]);
  });
  it('drops changes whose time cannot be read', () => {
    const histories = [
      { id: '1', created: 'never', items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '5' }, { field: 'status', fieldId: 'status', from: '1', to: '2' }] },
      { id: '2', created: '20', items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '6' }] },
    ];
    expect(sprintEvents('7', histories, FIELDS)).toEqual([ev('7', '6', 'added', 20, 2)]);
    expect(statusEvents('7', histories, new Map([['2', 'done']]))).toEqual([]);
  });
  it('accepts missing histories and items', () => {
    expect([sprintEvents('7', undefined, FIELDS), statusEvents('7', [{ id: '1', created: 1 }], new Map())]).toEqual([[], []]);
  });
  it('splits sprint values', () => {
    expect(sprintIdsOf(' 12, 13 ,x')).toEqual(new Set(['12', '13']));
    expect(sprintIdsOf(null)).toEqual(new Set());
  });
  it('turns Sprint field changes into added and removed events', () => {
    const histories = [
      { id: '1', created: 10, items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '5' }] },
      { id: '2', created: 20, items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '5', to: '5, 6' }, { field: 'summary', from: 'a', to: 'b' }] },
      { id: '3', created: 30, items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '5, 6', to: '6' }] },
    ];
    expect(sprintEvents(7, histories, FIELDS)).toEqual([ev('7', '5', 'added', 10, 1), ev('7', '6', 'added', 20, 2), ev('7', '5', 'removed', 30, 3)]);
  });
  it('keeps only status changes that move between categories', () => {
    const cats = new Map([['1', 'new'], ['3', 'indeterminate'], ['4', 'indeterminate'], ['10001', 'done']]);
    const histories = [
      { id: '1', created: 10, items: [{ field: 'status', fieldId: 'status', from: '1', to: '3' }] },
      { id: '2', created: 20, items: [{ field: 'status', fieldId: 'status', from: '3', to: '4' }] },
      { id: '3', created: 30, items: [{ field: 'status', fieldId: 'status', from: '4', to: '10001' }] },
    ];
    expect(statusEvents('7', histories, cats)).toEqual([
      { issueId: '7', at: 10, from: 'new', to: 'indeterminate', changeId: '1' },
      { issueId: '7', at: 30, from: 'indeterminate', to: 'done', changeId: '3' },
    ]);
  });
  it('reads the seeded sprint history from a recorded bulkfetch answer', () => {
    const answer = JSON.parse(readFileSync(new URL('../fixtures/changelog-bulkfetch.json', import.meta.url), 'utf8'));
    const kindsOf = (log) => sprintEvents(log.issueId, log.changeHistories, new Set([answer.sprintFieldId]))
      .filter((e) => e.sprintId === String(answer.sprintId) && e.at < answer.closedAt)
      .sort((a, b) => a.at - b.at)
      .map((e) => e.kind);
    const byRole = Object.fromEntries(answer.issueChangeLogs.map((log) => [answer.roles[log.issueId], kindsOf(log)]));
    expect(byRole).toEqual({ readded: ['added', 'removed', 'added'], removed: ['added', 'removed'], added: ['added'] });
  });
});

describe('added and removed after the start', () => {
  const events = [ev('1', '9', 'added', 50), ev('2', '9', 'added', 150), ev('2', '9', 'removed', 160), ev('3', '9', 'added', 250), ev('4', '8', 'added', 150)];
  it('counts additions inside the sprint window, even if removed later', () => {
    expect(addedAfterStart(events, 9, W)).toEqual(['2']);
  });
  it('counts removals not undone before the close', () => {
    const r = [ev('1', '9', 'removed', 150), ev('1', '9', 'added', 170), ev('2', '9', 'removed', 150), ev('3', '9', 'removed', 250)];
    expect(removedAfterStart(r, '9', W)).toEqual(['2']);
  });
  it('uses now as the end of a running sprint', () => {
    expect(removedAfterStart([ev('5', '9', 'removed', 150)], '9', { startAt: 100, completeAt: null })).toEqual(['5']);
  });
  it('has nothing before the sprint started', () => {
    expect(addedAfterStart(events, '9', { startAt: null, completeAt: null })).toEqual([]);
  });
});

describe('issues created inside a sprint', () => {
  it('takes members without any event of the sprint', () => {
    expect(createdInSprint(['1', '2'], [ev('2', '9', 'added', 150), ev('1', '8', 'added', 150)], '9')).toEqual(['1']);
  });
  it('takes issues whose first event of the sprint removes them', () => {
    expect(createdInSprint([], [ev('3', '9', 'added', 170), ev('3', '9', 'removed', 160), ev('4', '9', 'added', 150), ev('4', '9', 'removed', 160)], 9)).toEqual(['3']);
  });
});

describe('membership and categories at a time', () => {
  it('undoes the events after t', () => {
    const events = [ev('2', '9', 'added', 150), ev('4', '9', 'removed', 160)];
    expect(membersAt(['1', '2'], events, '9', 100)).toEqual(new Set(['1', '4']));
  });
  it('reads the category in force at t', () => {
    const changes = [{ at: 200, from: 'indeterminate', to: 'done', changeId: '2' }, { at: 100, from: 'new', to: 'indeterminate', changeId: '1' }];
    expect([categoryAt(changes, 50, 'done'), categoryAt(changes, 150, 'done'), categoryAt(changes, 250, 'new'), categoryAt([], 1, 'done')]).toEqual(['new', 'indeterminate', 'done', 'done']);
  });
  it('splits the members at the close into done and not done', () => {
    const events = [ev('3', '9', 'removed', 210)];
    const statusByIssue = new Map([['1', [{ at: 150, from: 'indeterminate', to: 'done', changeId: '1' }]], ['2', [{ at: 250, from: 'indeterminate', to: 'done', changeId: '2' }]]]);
    const currentCategory = new Map([['1', 'done'], ['2', 'done'], ['3', 'new']]);
    expect(sprintOutcome({ sprintId: '9', window: W, now: 999, currentIds: ['1', '2'], events, statusByIssue, currentCategory })).toEqual({ complete: ['1'], incomplete: ['2', '3'] });
  });
});
