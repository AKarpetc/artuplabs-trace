import { describe, expect, it } from 'vitest';
import { commentTimesWanted, errorKindOf, REWRITE_ALL_KIND, familyWants, groupPrecomputations, isTimeRelative, needsRepair, pricedOut, queryOverlap, reconcileTargets, summarizeJournal } from '../../src/core/affected.js';
import { ERR } from '../../src/core/errors.js';

const row = (ts, ids, kinds) => ({ key: `t:${String(ts).padStart(15, '0')}:abc`, value: { ids, kinds } });
const NOW = Date.parse('2026-10-10T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600000;

describe('summarizeJournal', () => {
  it('merges ids and kinds and keeps the oldest timestamp', () => {
    expect(summarizeJournal([row(200, ['2', '1'], ['link']), row(100, ['1'], ['issue-updated'])])).toEqual({ touched: ['1', '2'], kinds: ['issue-updated', 'link'], all: false, firstAt: 100 });
  });
  it('recomputes everything when the page is full', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, [String(i)], ['issue-updated']));
    expect(summarizeJournal(rows).all).toBe(true);
  });
  it('recomputes everything after an unknown event or a row without kinds', () => {
    expect(summarizeJournal([row(1, ['1'], ['unknown'])]).all).toBe(true);
    expect(summarizeJournal([{ key: 't:000000000000001:x', value: { ids: ['1'] } }]).all).toBe(true);
  });
  it('recomputes everything after a change of the excluded projects', () => {
    expect(summarizeJournal([row(1, [], [REWRITE_ALL_KIND])])).toEqual({ touched: [], kinds: [REWRITE_ALL_KIND], all: true, firstAt: 1 });
  });
  it('reads a row without ids as touching nothing', () => {
    expect(summarizeJournal([{ key: 't:000000000000005:x', value: { kinds: ['sprint'] } }])).toEqual({ touched: [], kinds: ['sprint'], all: false, firstAt: 5 });
  });
  it('checks up to 200 touched issues group by group instead of recomputing everything', () => {
    expect(summarizeJournal([row(1, Array.from({ length: 200 }, (_, i) => String(i)), ['issue-updated'])]).all).toBe(false);
  });
  it('recomputes everything when more than 200 issues are touched', () => {
    expect(summarizeJournal([row(1, Array.from({ length: 201 }, (_, i) => String(i)), ['issue-updated'])]).all).toBe(true);
  });
});

describe('groupPrecomputations', () => {
  const pcs = [
    { id: 'a', functionName: 'subtasksOf', arguments: ['project = A'], used: iso(HOUR) },
    { id: 'b', functionName: 'subtasksOf', arguments: ['project = A', '__aq:l2'], used: iso(HOUR) },
    { id: 'c', functionName: 'subtasksOf', arguments: ['project = B'], used: iso(8 * 24 * HOUR) },
    { id: 'd', functionName: 'gone', arguments: [] },
    { id: 'e', functionName: 'hasLinks', arguments: [] },
  ];
  it('joins pages to their root, drops inactive and unknown functions', () => {
    expect(groupPrecomputations(pcs, { now: NOW, activeMs: 7 * 24 * HOUR })).toEqual([
      { key: 'subtasksOf["project = A"]', functionName: 'subtasksOf', family: 'query', userArgs: ['project = A'], items: [pcs[0], pcs[1]] },
      { key: 'hasLinks[]', functionName: 'hasLinks', family: 'links', userArgs: [], items: [pcs[4]] },
    ]);
  });
});

describe('familyWants', () => {
  it('maps change kinds to the families they make stale', () => {
    expect(familyWants('subtasks', ['issue-created'])).toBe(true);
    expect(familyWants('subtasks', ['link'])).toBe(false);
    expect(familyWants('sprint', ['status'])).toBe(true);
    expect(familyWants('sprint', ['issue-created'])).toBe(true);
    expect(familyWants('board', ['sprint'])).toBe(true);
    expect(familyWants('links', ['link'])).toBe(true);
    expect(familyWants('links', ['issue-deleted'])).toBe(true);
    expect(familyWants('links', ['issue-updated'])).toBe(false);
    expect(familyWants('comment', ['issue-deleted'])).toBe(true);
    expect([familyWants('comment', ['issue-created']), familyWants('attachment', ['issue-created']), familyWants('attachment', ['issue-deleted'])]).toEqual([true, true, true]);
    expect(familyWants('attachment', ['comment'])).toBe(false);
  });
  it('recomputes the groups of an index part once that part is built', () => {
    expect(['sprint', 'comment', 'attachment', 'board', 'query'].map((f) => familyWants(f, ['index-sprint']) || familyWants(f, ['index-comments']))).toEqual([true, true, true, false, false]);
    expect([familyWants('sprint', ['index-comments']), familyWants('comment', ['index-sprint'])]).toEqual([false, false]);
  });
  it('wants nothing for a family it does not know', () => {
    expect(familyWants('gone', ['issue-created', 'sprint'])).toBe(false);
  });
});

describe('queryOverlap', () => {
  it('is stale when a touched issue is watched', () => {
    expect(queryOverlap({ watched: true, liveHits: [] })).toBe(true);
  });
  it('is stale when a touched issue now matches the subquery', () => {
    expect(queryOverlap({ watched: false, liveHits: ['5'] })).toBe(true);
  });
  it('is stale when the watch list or the live check is unknown', () => {
    expect(queryOverlap({ watched: null, liveHits: [] })).toBe(true);
    expect(queryOverlap({ watched: false, liveHits: null })).toBe(true);
  });
  it('is fresh when nothing touched is related', () => {
    expect(queryOverlap({ watched: false, liveHits: [] })).toBe(false);
  });
});

describe('reconcileTargets', () => {
  const group = (functionName, userArgs, used, updated) => ({ key: functionName, functionName, family: 'query', userArgs, items: [{ id: 'x', used: iso(used), updated: iso(updated), value: 'id in (1)' }] });
  it('picks groups used in the last day that were not rewritten for an hour or depend on the clock', () => {
    const stale = group('a', ['project = A'], HOUR, 2 * HOUR);
    const fresh = group('b', ['project = A'], HOUR, 10 * 60000);
    const clock = group('c', ['after -7d'], HOUR, 10 * 60000);
    const unused = group('d', ['project = A'], 2 * 24 * HOUR, 2 * HOUR);
    expect(reconcileTargets([stale, fresh, clock, unused], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 50 })).toEqual([stale, clock]);
  });
  it('keeps at most max groups, oldest first', () => {
    const older = group('a', ['x'], HOUR, 5 * HOUR);
    const newer = group('b', ['x'], HOUR, 2 * HOUR);
    expect(reconcileTargets([newer, older], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 1 })).toEqual([older]);
  });
});

describe('needsRepair', () => {
  it('flags a stored value that still carries an error, which makes Jira answer no issues', () => {
    expect(needsRepair({ value: 'id in (1)', error: 'Computing, retry in a minute' })).toBe(true);
    expect(needsRepair({ value: 'id in (1)', error: '' })).toBe(true);
  });
  it('accepts a value alone or an error alone', () => {
    expect([needsRepair({ value: 'id in (1)' }), needsRepair({ value: 'id in (1)', error: null }), needsRepair({ error: 'Board "B" not found' })]).toEqual([false, false, false]);
  });
  it('flags a precomputation with neither value nor error', () => {
    expect(needsRepair({ id: 'x' })).toBe(true);
  });
});

describe('reconcileTargets for broken precomputations', () => {
  it('picks a recently rewritten group whose stored value still carries an error', () => {
    const broken = { key: 'a', functionName: 'a', family: 'query', userArgs: ['x'], items: [{ id: 'x', used: iso(HOUR), updated: iso(60000), value: 'id in (1)', error: 'Computing, retry in a minute' }] };
    const fine = { key: 'b', functionName: 'b', family: 'query', userArgs: ['x'], items: [{ id: 'y', used: iso(HOUR), updated: iso(60000), value: 'id in (1)' }] };
    expect(reconcileTargets([broken, fine], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 50 })).toEqual([broken]);
  });
});

describe('reconcileTargets without rewrite times', () => {
  it('takes the creation time when a precomputation was never rewritten, and treats no time as oldest', () => {
    const created = { key: 'a', functionName: 'a', family: 'query', userArgs: ['x'], items: [{ id: 'x', used: iso(HOUR), created: iso(30 * 60000), value: 'id in (1)' }] };
    const blank = { key: 'b', functionName: 'b', family: 'query', userArgs: ['x'], items: [{ id: 'y', used: iso(HOUR), value: 'id in (1)' }] };
    expect(reconcileTargets([created, blank], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 50 })).toEqual([blank]);
  });
});

describe('isTimeRelative', () => {
  it.each([['after -7d', true], ['created > startOfWeek()', true], ['on 2026-01-01', false], ['project = A-7d', false]])('%s → %s', (arg, expected) => {
    expect(isTimeRelative([arg])).toBe(expected);
  });
});

describe('commentTimesWanted', () => {
  const group = (functionName, expression) => ({ functionName, userArgs: ['project = A', expression] });
  it('wants comment changes for a fields group that reads comment times', () => {
    expect([commentTimesWanted(group('dateCompare', 'created < firstCommented'), ['comment']), commentTimesWanted(group('expression', 'LASTCOMMENTED > 0'), ['index-comments'])]).toEqual([true, true]);
  });
  it('leaves other kinds, other expressions and other functions to the overlap check', () => {
    expect([
      commentTimesWanted(group('dateCompare', 'created < firstCommented'), ['issue-updated']),
      commentTimesWanted(group('dateCompare', 'created < duedate'), ['comment']),
      commentTimesWanted(group('parentsOf', 'firstCommented'), ['comment']),
      commentTimesWanted({ functionName: 'expression', userArgs: [] }, ['comment']),
      commentTimesWanted({ functionName: 'expression' }, ['comment']),
    ]).toEqual([false, false, false, false, false]);
  });
});

describe('needsRepair from a cached list record', () => {
  it('reads whether a value and an error are stored from the record', () => {
    expect([
      needsRepair({ hasValue: true, errorKind: 'other' }),
      needsRepair({ hasValue: false, errorKind: null }),
      needsRepair({ hasValue: true, errorKind: null }),
      needsRepair({ hasValue: false, errorKind: 'other' }),
    ]).toEqual([true, true, false, false]);
  });
});

describe('errorKindOf', () => {
  it('names a stored error by kind', () => {
    expect([errorKindOf(undefined), errorKindOf(null), errorKindOf(ERR.tooExpensive('hasSubtasks', { n: null, points: null, limit: 9 })), errorKindOf('Board "B" not found')])
      .toEqual([null, null, 'tooExpensive', 'other']);
  });
});

describe('pricedOut', () => {
  const pc = (extra) => ({ id: 'x', ...extra });
  it('is a group whose every precomputation stores the too-expensive error', () => {
    const text = ERR.tooExpensive('hasSubtasks', { n: null, points: null, limit: 9 });
    expect([
      pricedOut({ items: [pc({ errorKind: 'tooExpensive' }), pc({ error: text })] }),
      pricedOut({ items: [pc({ errorKind: 'tooExpensive' }), pc({ hasValue: true, errorKind: null })] }),
      pricedOut({ items: [] }),
    ]).toEqual([true, false, false]);
  });
  it('leaves a priced-out group out of the reconcile', () => {
    const group = { key: 'a', functionName: 'a', family: 'query', userArgs: ['x'], items: [{ id: 'x', used: iso(HOUR), updated: iso(5 * HOUR), errorKind: 'tooExpensive', hasValue: false }] };
    expect(reconcileTargets([group], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 50 })).toEqual([]);
  });
});
