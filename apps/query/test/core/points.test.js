import { describe, expect, it } from 'vitest';
import { admit, capOf, countQueryOf, passInterval, estimate, groupClass, groupLimit, lightLimit, hourKey, issuesWithin, LANES, laneOfRefresh, laneRoom, nextHour, pointsOf, pointsSummary } from '../../src/core/points.js';
import { FUNCTIONS } from '../../src/core/catalog.js';
import { BULK_CONCURRENCY_NEAR, CHANGELOG_POINT_FACTOR, COMMENT_POINT_FACTOR, FIELD_RANGES, FIELDS_PAGE, POINTS_OVERHEAD, POINTS_OVERRUN, SITE_POINTS_TIER1, SITE_POINTS_TIER2, VALUE_LIMIT } from '../../src/core/limits.js';

const list = (n, make = (i) => ({ id: String(i) })) => Array.from({ length: n }, (_, i) => make(i));

describe('pointsOf', () => {
  it('charges 1 for an answer without a body, such as a 429', () => {
    expect(pointsOf('POST', '/rest/api/3/search/jql', null)).toEqual(1);
  });
  it('charges 1 plus each issue of a search page', () => {
    expect(pointsOf('POST', '/rest/api/3/search/jql', { issues: list(7) })).toEqual(8);
  });
  it('charges 1 plus each issue of a bulkfetch', () => {
    expect(pointsOf('POST', '/rest/api/3/issue/bulkfetch', { issues: list(100) })).toEqual(101);
  });
  it('charges the issues of a bulkfetch that holds comments by the comment factor', () => {
    const issues = list(10, (i) => ({ id: String(i), fields: { comment: { comments: [] } } }));
    expect(pointsOf('POST', '/rest/api/3/issue/bulkfetch', { issues })).toEqual(1 + 10 * COMMENT_POINT_FACTOR);
  });
  it('charges the issues of a changelog bulkfetch by the changelog factor', () => {
    expect(pointsOf('POST', '/rest/api/3/changelog/bulkfetch', { issueChangeLogs: list(40) })).toEqual(1 + 40 * CHANGELOG_POINT_FACTOR);
  });
  it('charges each value of a list read with startAt', () => {
    expect(pointsOf('GET', '/rest/agile/1.0/board/*/sprint', { values: list(12), isLast: true })).toEqual(13);
  });
  it('charges each precomputation Jira lists', () => {
    expect(pointsOf('GET', '/rest/api/3/jql/function/computation', { values: list(100) })).toEqual(101);
  });
  it('charges each entry of the field and status lists', () => {
    expect([pointsOf('GET', '/rest/api/3/field', list(300)), pointsOf('GET', '/rest/api/3/status', list(25))]).toEqual([301, 26]);
  });
  it('charges each link type', () => {
    expect(pointsOf('GET', '/rest/api/3/issueLinkType', { issueLinkTypes: list(4) })).toEqual(5);
  });
  it('charges one issue read by id', () => {
    expect(pointsOf('GET', '/rest/api/3/issue/*', { id: '1', fields: {} })).toEqual(2);
  });
  it('charges 2 per user a user search finds', () => {
    expect(pointsOf('GET', '/rest/api/3/user/search', list(5))).toEqual(11);
  });
  it('charges 2 per member of a group', () => {
    expect(pointsOf('GET', '/rest/api/3/group/member', { values: list(3), isLast: true })).toEqual(7);
  });
  it('charges 2 per actor of a project role', () => {
    expect(pointsOf('GET', '/rest/api/3/project/*/role/*', { actors: list(4) })).toEqual(9);
  });
  it('charges 1 for a write, an approximate count and a parse', () => {
    expect([
      pointsOf('POST', '/rest/api/3/jql/function/computation', { values: list(3) }),
      pointsOf('POST', '/rest/api/3/search/approximate-count', { count: 50000 }),
      pointsOf('POST', '/rest/api/3/jql/parse', { queries: list(1) }),
    ]).toEqual([1, 1, 1]);
  });
  it('charges 1 for an answer it does not know', () => {
    expect(pointsOf('GET', '/rest/api/3/project/*/role', { Developers: 'url' })).toEqual(1);
  });
  it('charges 1 when a known list field is missing', () => {
    expect([pointsOf('POST', '/rest/api/3/search/jql', {}), pointsOf('GET', '/rest/api/3/field', { odd: true })]).toEqual([1, 1]);
  });
});

describe('estimate', () => {
  it('leaves room in its overhead for the requests of a search read in id ranges, the count and the parse', () => {
    expect(2 * FIELD_RANGES + 1 + 1 + 1 <= POINTS_OVERHEAD).toEqual(true);
  });
  it('lets a finished computation pass its limit by one round of range pages', () => {
    expect(Math.max(FIELD_RANGES, BULK_CONCURRENCY_NEAR) * (FIELDS_PAGE + 1) <= POINTS_OVERRUN).toEqual(true);
  });
  it('reads the subquery of subtasksOf once with its subtasks, a point per issue and per page of FIELDS_PAGE', () => {
    expect([estimate('subtasksOf', VALUE_LIMIT), estimate('subtasksOf', 1200), estimate('subtasksOf', 1500)]).toEqual([
      { points: 1010 + POINTS_OVERHEAD, floor: false }, { points: 1212 + POINTS_OVERHEAD, floor: false }, { points: 1515 + POINTS_OVERHEAD, floor: false },
    ]);
  });
  it('reads the subquery once with its fields for a hierarchy function', () => {
    expect(['parentsOf', 'issuesInEpics', 'hasSubtasks'].map((f) => estimate(f, 500))).toEqual(Array(3).fill({ points: 505 + POINTS_OVERHEAD, floor: false }));
  });
  it('reads twice per issue for a function that fetches the issues of its subquery', () => {
    expect(['linkedIssuesOf', 'expression', 'dateCompare'].map((f) => estimate(f, 500)))
      .toEqual(Array(3).fill({ points: 1000 + POINTS_OVERHEAD, floor: false }));
  });
  it('gives a lower bound for a function whose result fans out', () => {
    expect([estimate('epicsOf', 500), ...['childIssuesOf', 'linkedIssuesOfRecursive', 'linkedIssuesOfRecursiveLimited'].map((f) => estimate(f, 500))])
      .toEqual([{ points: 505 + POINTS_OVERHEAD, floor: true }, ...Array(3).fill({ points: 1000 + POINTS_OVERHEAD, floor: true })]);
  });
  it('reads once per issue for a computed link function', () => {
    expect(['hasLinks', 'hasLinkType'].map((f) => estimate(f, 300))).toEqual(Array(2).fill({ points: 300 + POINTS_OVERHEAD, floor: false }));
  });
  it('reads twice per sprint issue for a sprint function that fetches its issues', () => {
    expect(['incompleteInSprint', 'completeInSprint'].map((f) => estimate(f, 40)))
      .toEqual(Array(2).fill({ points: 80 + POINTS_OVERHEAD, floor: false }));
  });
  it('reads a sprint once per issue for the issues added after its start', () => {
    expect(estimate('addedAfterSprintStart', 40)).toEqual({ points: 40 + POINTS_OVERHEAD, floor: false });
  });
  it('knows the cost of every function of the catalog', () => {
    expect(FUNCTIONS.filter((f) => estimate(f.name, 1).floor && !['epicsOf', 'childIssuesOf', 'linkedIssuesOfRecursive', 'linkedIssuesOfRecursiveLimited'].includes(f.name)).map((f) => f.name)).toEqual([]);
  });
  it('costs only the overhead for an index or native function', () => {
    expect(['commented', 'hasComments', 'fileAttached', 'previousSprint', 'hasAttachments', 'removedAfterSprintStart'].map((f) => estimate(f, 50000)))
      .toEqual(Array(6).fill({ points: POINTS_OVERHEAD, floor: false }));
  });
  it('treats a function it does not know as a fan-out lower bound', () => {
    expect(estimate('unknown', 10)).toEqual({ points: 20 + POINTS_OVERHEAD, floor: true });
  });
});

describe('hourKey', () => {
  it('names the UTC hour of an instant', () => {
    expect(hourKey(Date.parse('2026-10-05T07:59:59.999Z'))).toEqual('2026100507');
  });
  it('moves to the next hour on the hour', () => {
    expect(hourKey(Date.parse('2026-10-05T23:00:00Z'))).toEqual('2026100523');
  });
});

describe('nextHour', () => {
  it('is the start of the next UTC hour', () => {
    expect(nextHour(Date.parse('2026-10-05T23:30:00Z'))).toEqual(Date.parse('2026-10-06T00:00:00Z'));
  });
  it('is an hour later on the hour itself', () => {
    expect(nextHour(Date.parse('2026-10-05T07:00:00Z'))).toEqual(Date.parse('2026-10-05T08:00:00Z'));
  });
});

describe('capOf', () => {
  it('is the Tier 1 cap by default', () => {
    expect(capOf(undefined, undefined)).toEqual(SITE_POINTS_TIER1);
  });
  it('is the Tier 2 cap for tier 2', () => {
    expect(capOf(2, undefined)).toEqual(SITE_POINTS_TIER2);
  });
  it('takes a positive override over the tier', () => {
    expect(capOf(2, 2000)).toEqual(2000);
  });
  it('ignores an override that is not a positive number', () => {
    expect([capOf(1, 0), capOf(1, Number.NaN), capOf(1, -5), capOf(3, null)]).toEqual(Array(4).fill(SITE_POINTS_TIER1));
  });
});

describe('laneOfRefresh', () => {
  it('spends a deferred function computation from the function lane', () => {
    expect(laneOfRefresh({ kind: 'compute' })).toEqual('fn');
  });
  it('spends a heavy lane run from the heavy lane', () => {
    expect(laneOfRefresh({ kind: 'heavy' })).toEqual('heavy');
  });
  it('spends journal passes, verifies and wakes from the refresh lane', () => {
    expect([laneOfRefresh({ kind: 'refresh' }), laneOfRefresh({ verify: ['1'] }), laneOfRefresh({ kind: 'wake' }), laneOfRefresh(undefined)]).toEqual(Array(4).fill('refresh'));
  });
  it('names every lane once', () => {
    expect(LANES).toEqual(['fn', 'index-event', 'refresh', 'heavy', 'reconcile', 'backfill']);
  });
});

describe('admit', () => {
  const C = 10000;
  const at = (minute) => Date.parse(`2026-10-05T07:${String(minute).padStart(2, '0')}:00Z`);
  const HALF = Date.parse('2026-10-05T07:30:00Z');
  const NEXT = Date.parse('2026-10-05T08:00:00Z');
  it('admits a step that fits the lane reserve', () => {
    expect(admit('refresh', 1000, { refresh: 2000 }, at(5), C)).toEqual({ ok: true });
  });
  it('admits a step that ends exactly at the reserve', () => {
    expect(admit('fn', 500, { fn: 1000 }, at(5), C)).toEqual({ ok: true });
  });
  it('makes a step past its reserve wait for half past before half past, even with the rest of the hour unspent', () => {
    expect(admit('fn', 501, { fn: 1000 }, at(29), C)).toEqual({ waitUntil: HALF });
  });
  it('keeps the reserve of a lane whose neighbour used up its own before half past', () => {
    expect(admit('refresh', 3000, { 'index-event': 1000, fn: 1500 }, at(10), C)).toEqual({ ok: true });
  });
  it('lends unspent points from half past', () => {
    expect(admit('backfill', 2000, { backfill: 1000 }, at(30), C)).toEqual({ ok: true });
  });
  it('lends no more than the hour has left', () => {
    expect(admit('fn', 1600, { fn: 1500, refresh: 7000 }, at(40), C)).toEqual({ waitUntil: NEXT });
  });
  it('lends the function lane the last tenth of the hour', () => {
    expect(admit('fn', 900, { fn: 1500, refresh: 7500 }, at(40), C)).toEqual({ ok: true });
  });
  it('lends other lanes only up to nine tenths of the hour', () => {
    expect([admit('heavy', 600, { heavy: 2500, refresh: 4500, fn: 1500 }, at(45), C), admit('heavy', 500, { heavy: 2500, refresh: 4500, fn: 1500 }, at(45), C)])
      .toEqual([{ waitUntil: NEXT }, { ok: true }]);
  });
  it('refuses a step even within its own reserve once the hour is spent', () => {
    expect(admit('reconcile', 500, { reconcile: 0, refresh: 9500 }, at(50), C)).toEqual({ waitUntil: NEXT });
  });
});

describe('laneRoom', () => {
  const C = 10000;
  it('is what is left of the lane reserve before half past', () => {
    expect(laneRoom('fn', { fn: 400 }, Date.parse('2026-10-05T07:10:00Z'), C)).toEqual(1100);
  });
  it('is never below zero', () => {
    expect(laneRoom('fn', { fn: 4000 }, Date.parse('2026-10-05T07:10:00Z'), C)).toEqual(0);
  });
  it('adds what the hour has left from half past', () => {
    expect(laneRoom('fn', { fn: 1000, refresh: 3000 }, Date.parse('2026-10-05T07:31:00Z'), C)).toEqual(6000);
  });
});

describe('groupLimit', () => {
  it('is a fifth of the site cap', () => {
    expect([groupLimit(SITE_POINTS_TIER1), groupLimit(SITE_POINTS_TIER2)]).toEqual([1800, 17000]);
  });
});

describe('issuesWithin', () => {
  it('is how many issues a function reads within the points', () => {
    expect([issuesWithin('expression', 1800), issuesWithin('hasLinks', 1800), issuesWithin('subtasksOf', 1800)]).toEqual([890, 1780, 1762]);
  });
  it('fits the estimate of subtasksOf on the count it names', () => {
    expect(estimate('subtasksOf', issuesWithin('subtasksOf', 1800)).points).toBeLessThanOrEqual(1800);
  });
});

describe('countQueryOf', () => {
  it('counts the subquery of a function that reads it', () => {
    expect(countQueryOf('expression', { subquery: 'project = A' })).toEqual('project = A');
  });
  it('counts the subtasks of the site for hasSubtasks', () => {
    expect(countQueryOf('hasSubtasks', {})).toEqual('issuetype in subTaskIssueTypes()');
  });
  it('counts nothing for a function whose cost does not grow with a query', () => {
    expect([countQueryOf('commented', {}), countQueryOf('previousSprint', { board: 'b' }), countQueryOf('incompleteInSprint', { board: 'b' })]).toEqual([null, null, null]);
  });
});

describe('estimate without a count', () => {
  it('is the overhead as a lower bound for a function that reads issues', () => {
    expect(estimate('incompleteInSprint', null)).toEqual({ points: POINTS_OVERHEAD, floor: true });
  });
  it('is the overhead for a function that reads none', () => {
    expect(estimate('commented', null)).toEqual({ points: POINTS_OVERHEAD, floor: false });
  });
});

describe('laneRoom keeps the hour within the cap', () => {
  const C = 9000;
  const late = Date.parse('2026-10-05T07:31:00Z');
  const cases = [{ fn: 9000 }, { refresh: 8100 }, { fn: 1350, refresh: 2700 }, { heavy: 100 }, {}, { 'index-event': 900, backfill: 4000, fn: 200 }];
  it('leaves no lane room past the cap after half past', () => {
    const over = cases.flatMap((spent) => LANES.filter((lane) => Object.values(spent).reduce((a, b) => a + b, 0) + laneRoom(lane, spent, late, C) > C).map((lane) => [lane, spent]));
    expect(over).toEqual([]);
  });
  it('keeps what the function reserve has left out of the room of other lanes after half past', () => {
    expect(laneRoom('refresh', { refresh: 2700, heavy: 2250, reconcile: 900, backfill: 900, 'index-event': 900 }, late, C)).toEqual(0);
  });
  it('still lends the function lane what the hour has left', () => {
    expect(laneRoom('fn', { refresh: 6000 }, late, C)).toEqual(3000);
  });
  it('keeps what the function reserve has left out of the room of other lanes before half past too', () => {
    expect(laneRoom('refresh', { backfill: 7650 }, Date.parse('2026-10-05T07:10:00Z'), C)).toEqual(0);
  });
});

describe('countQueryOf for link functions', () => {
  it('counts the issues with the link type', () => {
    expect([countQueryOf('hasLinks', { linkType: 'blocks' }), countQueryOf('hasLinkType', { linkType: 'Duplicate' }), countQueryOf('hasLinks', {})])
      .toEqual(['issueLinkType = "blocks"', 'issueLinkType = "Duplicate"', null]);
  });
});

describe('groupClass', () => {
  const C = 10000;
  it('is light up to a twentieth of the cap', () => {
    expect([groupClass({ points: 500, floor: false }, C), groupClass({ points: 501, floor: false }, C)]).toEqual(['light', 'medium']);
  });
  it('is medium up to the group limit and over past it', () => {
    expect([groupClass({ points: 2000, floor: false }, C), groupClass({ points: 2001, floor: false }, C)]).toEqual(['medium', 'over']);
  });
  it('lets a finished computation pass the group limit by one request round', () => {
    expect([groupClass({ points: 2000 + POINTS_OVERRUN, measured: true }, C), groupClass({ points: 2001 + POINTS_OVERRUN, measured: true }, C)]).toEqual(['medium', 'over']);
  });
  it('is over for a lower bound that reached the group limit', () => {
    expect(groupClass({ points: 2000, floor: true }, C)).toEqual('over');
  });
  it('is unknown without points', () => {
    expect(groupClass(null, C)).toEqual('unknown');
  });
  it('is a twentieth of the cap for the light limit', () => {
    expect(lightLimit(SITE_POINTS_TIER1)).toEqual(450);
  });
});

describe('passInterval', () => {
  it('spreads the overhead of a pass over half of the refresh reserve of an hour', () => {
    expect(passInterval(50, 9000)).toEqual(Math.round(3600 * 50 / (0.5 * 2700)));
  });
  it('waits at least 5 s and at most 300 s', () => {
    expect([passInterval(0, 9000), passInterval(1, 9000), passInterval(400, 9000), passInterval(100000, 9000)]).toEqual([5, 5, 300, 300]);
  });
});

describe('pointsSummary', () => {
  it('names the site sum, the lanes in name order, the cap and the key count', () => {
    expect(pointsSummary({ byLane: { refresh: 2, fn: 1 }, total: 3, keys: 2 }, 9000)).toEqual('site 3, lanes {fn 1, refresh 2}, cap 9000, keys 2');
  });
});
