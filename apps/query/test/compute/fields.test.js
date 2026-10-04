import { describe, expect, it } from 'vitest';
import { createFieldCompute } from '../../src/compute/fields.js';
import { FIELD_EVAL_CHUNK } from '../../src/core/limits.js';

const FIELDS = [{ id: 'created', name: 'Created' }, { id: 'duedate', name: 'Due date' }, { id: 'resolutiondate', name: 'Resolved' }, { id: 'timespent', name: 'Time Spent' }, { id: 'timeoriginalestimate', name: 'Original Estimate' }, { id: 'customfield_10016', name: 'Story Points' }];
const ISSUES = [
  { id: '1', fields: { created: '2026-01-01T00:00:00.000+0000', duedate: '2026-01-05', resolutiondate: '2026-01-07T00:00:00.000+0000', timespent: 36000, timeoriginalestimate: 28800, customfield_10016: 8 } },
  { id: '2', fields: { created: '2026-01-01T00:00:00.000+0000', duedate: '2026-01-10', resolutiondate: '2026-01-07T00:00:00.000+0000', timespent: 3600, timeoriginalestimate: 28800, customfield_10016: null } },
];

function make({ comments = false } = {}) {
  const calls = [];
  const jira = {
    fields: async () => FIELDS,
    searchIds: async () => ['1', '2'],
    bulkIssues: async (ids, fields) => {
      calls.push(fields);
      return ISSUES;
    },
  };
  const repo = { commentBounds: async () => new Map([['1', { first: Date.UTC(2026, 0, 4), last: Date.UTC(2026, 0, 6) }]]) };
  return { compute: createFieldCompute({ jira, repo, commentsShipped: () => comments }), calls };
}

describe('field compute', () => {
  it('dateCompare compares date fields with calendar intervals', async () => {
    expect(await make().compute.dateCompare({ subquery: 'S', expression: 'resolutiondate > duedate' }, { reconcile: [] })).toEqual({ ids: ['1'], field: 'id', watch: ['1', '2'] });
  });
  it('expression uses work time and reads only the fields it needs', async () => {
    const { compute, calls } = make();
    expect((await compute.expression({ subquery: 'S', expression: 'timespent > originalestimate * 1.2' }, { reconcile: [] })).ids).toEqual(['1']);
    expect(calls[0]).toEqual(['timeoriginalestimate', 'timespent']);
  });
  it('resolves a quoted display name to its field id', async () => {
    expect((await make().compute.expression({ subquery: 'S', expression: '"Story Points" >= 5' }, { reconcile: [] })).ids).toEqual(['1']);
  });
  it('reads firstCommented from the comment index when it is shipped', async () => {
    expect((await make({ comments: true }).compute.dateCompare({ subquery: 'S', expression: 'created + 2d < firstCommented' }, { reconcile: [] })).ids).toEqual(['1']);
  });
  it('explains an unknown field', async () => {
    expect((await make().compute.expression({ subquery: 'S', expression: 'nope > 1' }, { reconcile: [] })).error).toBe('expression: Field "nope" not found');
  });
  it('explains a parse error', async () => {
    expect((await make().compute.expression({ subquery: 'S', expression: 'timespent >' }, { reconcile: [] })).error).toBe('expression: Unexpected end of expression');
  });
  it('explains firstCommented without the comment index', async () => {
    expect((await make().compute.dateCompare({ subquery: 'S', expression: 'created < firstCommented' }, { reconcile: [] })).error).toBe('dateCompare: firstCommented needs the comment index, which this site does not have');
  });
});

describe('field compute edges', () => {
  const run = async (expression, { fn = 'expression', jira = {}, repo, gate, comments = true } = {}) => {
    const seen = { bounds: [], bulk: [], search: [] };
    const base = {
      fields: async () => FIELDS,
      searchIds: async (jql, options) => {
        seen.search.push([jql, options]);
        return ['2', '1'];
      },
      bulkIssues: async (ids, fields) => {
        seen.bulk.push([ids, fields]);
        return ISSUES.filter((x) => ids.includes(x.id));
      },
    };
    const bounds = repo ?? { commentBounds: async (ids) => { seen.bounds.push(ids); return new Map([['2', { first: Date.UTC(2026, 0, 2), last: Date.UTC(2026, 0, 9) }]]); } };
    const compute = createFieldCompute({ jira: { ...base, ...jira }, repo: bounds, commentsShipped: () => comments, commentGate: gate });
    return { reply: await compute[fn]({ subquery: 'S', expression }, { reconcile: ['7'] }), seen };
  };

  it('logs an unknown field without its name', async () => {
    expect((await run('nope > 1')).reply.log).toBe('Field not found');
  });
  it('logs a parse error without the expression', async () => {
    expect((await run('timespent > "secret"x')).reply.log).toBe('Invalid expression');
  });
  it('logs comment times without the comment index as a fixed text', async () => {
    expect((await run('created < lastCommented', { comments: false })).reply).toEqual({ error: 'expression: lastCommented needs the comment index, which this site does not have', log: 'Comment index not shipped' });
  });
  it('rejects a display name two fields share, asking for the id', async () => {
    const jira = { fields: async () => [...FIELDS, { id: 'customfield_2', name: 'Story points' }] };
    expect((await run('"Story Points" > 1', { jira })).reply).toEqual({ error: 'expression: Field "Story Points" matches 2 items; use its id', log: 'Field is ambiguous' });
  });
  it('prefers an id over a display name and ignores case', async () => {
    const jira = { fields: async () => [{ id: 'Created', name: 'x' }, { id: 'customfield_9', name: 'created' }, ...FIELDS.slice(1)] };
    expect((await run('CREATED < duedate', { jira, fn: 'dateCompare' })).seen.bulk[0][1]).toEqual(['Created', 'duedate']);
  });
  it('passes the reconcile ids to the subquery and watches it in id order', async () => {
    const { reply, seen } = await run('timespent > 0');
    expect(seen.search).toEqual([['S', { reconcile: ['7'] }]]);
    expect(reply).toEqual({ ids: ['1', '2'], field: 'id', watch: ['1', '2'] });
  });
  it('reads comment bounds only for the pseudo-fields, for the subquery issues', async () => {
    expect((await run('timespent > 0')).seen.bounds).toEqual([]);
    const { reply, seen } = await run('lastCommented > resolutiondate', { fn: 'dateCompare' });
    expect([reply.ids, seen.bounds, seen.bulk[0][1]]).toEqual([['2'], [['1', '2']], ['resolutiondate']]);
  });
  it('reads no issue fields when the expression compares only comment times', async () => {
    const bounds = { commentBounds: async () => new Map([['1', { first: Date.UTC(2026, 0, 1), last: Date.UTC(2026, 0, 20) }], ['2', { first: Date.UTC(2026, 0, 1), last: Date.UTC(2026, 0, 3) }]]) };
    const { reply, seen } = await run('lastCommented > firstCommented + 7d', { fn: 'dateCompare', repo: bounds });
    expect([reply.ids, seen.bulk]).toEqual([['1'], []]);
  });
  it('treats an issue without visible comments as an empty pseudo-field', async () => {
    expect((await run('firstCommented < created + 30d', { fn: 'dateCompare' })).reply.ids).toEqual(['2']);
  });
  it('answers the comment index readiness error before reading any issue', async () => {
    const { reply, seen } = await run('created < firstCommented', { gate: async () => 'Index is building: 3 of 9 issues' });
    expect([reply, seen.search]).toEqual([{ error: 'Index is building: 3 of 9 issues', log: 'Index is building: 3 of 9 issues' }, []]);
    expect((await run('timespent > 0', { gate: async () => 'Index is building: 3 of 9 issues' })).reply.ids).toEqual(['1', '2']);
  });
  it('reads the subquery issues in bounded slices and keeps only matching ids', async () => {
    const many = Array.from({ length: FIELD_EVAL_CHUNK * 2 + 3 }, (_, i) => String(i + 1));
    const jira = {
      searchIds: async () => many,
      bulkIssues: async (ids) => ids.map((id) => ({ id, fields: { timespent: Number(id) % 2 } })),
    };
    const { reply } = await run('timespent > 0', { jira });
    expect(reply.ids).toHaveLength(FIELD_EVAL_CHUNK + 2);
    expect(reply.watch).toHaveLength(many.length);
  });
  it('slices bulk reads to at most the chunk size', async () => {
    const many = Array.from({ length: FIELD_EVAL_CHUNK + 1 }, (_, i) => String(i + 1));
    const sizes = [];
    const jira = { searchIds: async () => many, bulkIssues: async (ids) => { sizes.push(ids.length); return []; } };
    await run('timespent > 0', { jira });
    expect(sizes).toEqual([FIELD_EVAL_CHUNK, 1]);
  });
  it('compares nothing for an issue whose field is missing or not a number', async () => {
    const jira = { bulkIssues: async () => [{ id: '1', fields: {} }, { id: '2', fields: { customfield_10016: { name: 'x' } } }, { id: '3' }] };
    expect((await run('"Story Points" >= 0 or "Story Points" < 0', { jira })).reply.ids).toEqual([]);
  });
});
