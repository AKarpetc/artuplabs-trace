import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createExclusion } from '../../src/compute/exclusion.js';
import { EXCLUDED_IDS_MAX, EXCLUSION_PROJECTS_TTL_MS, ROOT_FILTER_VALUES, VALUE_LIMIT } from '../../src/core/limits.js';
import { buildFragment, valuesOf } from '../../src/core/tree.js';

const valuesIn = (jql) => [...jql.matchAll(/\bin \(([^)]*)\)/g)].reduce((sum, m) => sum + m[1].split(',').length, 0);

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

function make({ excluded = ['OPS'], searches = {}, pages = {} } = {}) {
  const state = createState({ kvs: createFakeKvs() });
  const searched = [];
  const pageSizes = [];
  let now = 1000;
  const jira = {
    searchPage: async (jql, token, options = {}) => {
      searched.push(`page ${jql}`);
      pageSizes.push(options.maxResults ?? null);
      return pages[jql] ?? { ids: [], nextPageToken: null };
    },
    projects: vi.fn(async () => [{ id: '1', key: 'OPS' }, { id: '2', key: 'DEV' }, { id: '3', key: 'HR' }]),
    searchIds: async (jql) => {
      searched.push(jql);
      const answer = typeof searches === 'function' ? searches(jql) : searches[jql];
      return answer ?? [];
    },
  };
  return { exclude: createExclusion({ jira, state, now: () => now }), state, jira, searched, pageSizes, excluded, advance: (ms) => { now += ms; } };
}
const withList = async (m, keys) => {
  await m.state.setExcluded(keys);
  return m;
};

describe('exclusion within the 1 000 values of a fragment', () => {
  it('keeps the excluded children in the root filter while they leave the root room for its values', async () => {
    const removed = ids(VALUE_LIMIT - ROOT_FILTER_VALUES, 50000);
    const m = await withList(make({ pages: { [`parent in (${ids(800).join(',')}) AND project in ("OPS")`]: { ids: removed, nextPageToken: null } } }), ['OPS']);
    const out = await m.exclude({ ids: ids(800), field: 'parent', watch: null });
    const root = buildFragment({ functionName: 'issuesInEpics', userArgs: ['S'], page: null, values: valuesOf(out.ids), field: out.field, rootFilter: out.rootFilter, levels: 1 });
    expect(out.rootFilter).toEqual(`id not in (${removed.join(',')})`);
    expect(valuesIn(root.jql)).toBeLessThanOrEqual(VALUE_LIMIT);
  });
  it('turns a parent result into ids when the excluded children would leave the root filter no room', async () => {
    const removed = ids(VALUE_LIMIT - ROOT_FILTER_VALUES + 1, 50000);
    const base = `parent in (${ids(800).join(',')})`;
    const m = await withList(make({ pages: { [`${base} AND project in ("OPS")`]: { ids: removed, nextPageToken: null } }, searches: { [`${base} AND project not in ("OPS")`]: ['9'] } }), ['OPS']);
    expect(await m.exclude({ ids: ids(800), field: 'parent', watch: null })).toEqual({ ids: ['9'], field: 'id', watch: null });
  });
});

describe('exclusion', () => {
  it('leaves a result as it is and asks Jira nothing when no project is excluded', async () => {
    const m = make();
    const result = { ids: ['1', '2'], field: 'id', watch: null };
    expect(await m.exclude(result)).toBe(result);
    expect([m.searched, m.jira.projects.mock.calls.length]).toEqual([[], 0]);
  });
  it('drops the matching issues of excluded projects by id, searching as the app in chunks', async () => {
    const m = await withList(make({ searches: (jql) => (jql.startsWith('id in (1,') ? ['2', '5'] : jql.startsWith('id in (1001,') ? ['1001'] : []) }), ['OPS']);
    const out = await m.exclude({ ids: ids(1500), field: 'id', watch: ['9'] });
    expect(out.ids).toEqual(ids(1500).filter((id) => !['2', '5', '1001'].includes(id)));
    expect(out.watch).toEqual(['9']);
    expect(m.searched.map((q) => q.replace(/\(\d[\d,]*\)/, '(…)'))).toEqual(['id in (…) AND project in ("OPS")', 'id in (…) AND project in ("OPS")']);
    expect(m.searched[0].startsWith(`id in (${ids(VALUE_LIMIT).join(',')})`)).toBe(true);
  });
  it('never puts a project Jira does not know into a search, and does nothing when no excluded key is known', async () => {
    const m = await withList(make(), ['GONE', 'OPS']);
    await m.exclude({ ids: ['1'], field: 'id', watch: null });
    expect(m.searched).toEqual(['id in (1) AND project in ("OPS")']);
    const n = await withList(make(), ['GONE']);
    const result = { ids: ['1'], field: 'id', watch: null };
    expect(await n.exclude(result)).toBe(result);
    expect(n.searched).toEqual([]);
  });
  it('keeps a parent result and leaves out the excluded children by id in its root filter, reading one page per chunk', async () => {
    const m = await withList(make({ pages: { '(issuetype in subTaskIssueTypes()) AND parent in (7,8) AND project in ("OPS")': { ids: ['70'], nextPageToken: null } } }), ['OPS']);
    expect(await m.exclude({ ids: ['7', '8'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: ['1'] })).toEqual({
      ids: ['7', '8'], field: 'parent', rootFilter: '(issuetype in subTaskIssueTypes()) AND id not in (70)', watch: ['1'],
    });
    expect(m.searched).toEqual(['page (issuetype in subTaskIssueTypes()) AND parent in (7,8) AND project in ("OPS")']);
  });
  it('adds the filter to a parent result without one, and leaves a parent result with no excluded child as it is', async () => {
    const m = await withList(make({ pages: { 'parent in (7) AND project in ("OPS")': { ids: ['71', '70'], nextPageToken: null } } }), ['OPS']);
    expect((await m.exclude({ ids: ['7'], field: 'parent', watch: null })).rootFilter).toBe('id not in (70,71)');
    const result = { ids: ['8'], field: 'parent', watch: null };
    expect(await m.exclude(result)).toBe(result);
  });
  it('turns a parent result into the matching ids when more children are excluded than one clause may list, without paging through them', async () => {
    const pages = { 'parent in (7) AND project in ("HR", "OPS")': { ids: ids(10, 5000), nextPageToken: 'more' } };
    const m = await withList(make({ pages, searches: { 'parent in (7) AND project not in ("HR", "OPS")': ['12', '11'] } }), ['OPS', 'HR']);
    expect(await m.exclude({ ids: ['7'], field: 'parent', watch: ['3'] })).toEqual({ ids: ['11', '12'], field: 'id', watch: ['3'] });
    const many = { 'parent in (7) AND project in ("OPS")': { ids: ids(EXCLUDED_IDS_MAX + 1, 5000), nextPageToken: null } };
    const n = await withList(make({ pages: many, searches: { 'parent in (7) AND project not in ("OPS")': ['4'] } }), ['OPS']);
    expect((await n.exclude({ ids: ['7'], field: 'parent', watch: null })).ids).toEqual(['4']);
  });
  it('reads one more excluded child than one clause may list, and no more', async () => {
    const m = await withList(make(), ['OPS']);
    await m.exclude({ ids: ['7'], field: 'parent', watch: null });
    expect(m.pageSizes).toEqual([EXCLUDED_IDS_MAX + 1]);
  });
  it('returns a native answer unfiltered and runs no search for it', async () => {
    const m = await withList(make(), ['OPS']);
    for (const native of ['sprint = 5', 'attachments is not EMPTY', 'NOT (issue in hasComments("+2"))']) {
      const result = { native };
      expect(await m.exclude(result)).toBe(result);
    }
    expect([m.searched, m.jira.projects.mock.calls.length]).toEqual([[], 0]);
  });
  it('lists the projects once for many computations and again after a minute or a new list', async () => {
    const m = await withList(make(), ['OPS']);
    await m.exclude({ ids: ['1'], field: 'id', watch: null });
    await m.exclude({ ids: ['2'], field: 'id', watch: null });
    expect(m.jira.projects).toHaveBeenCalledTimes(1);
    m.advance(EXCLUSION_PROJECTS_TTL_MS);
    await m.exclude({ ids: ['3'], field: 'id', watch: null });
    expect(m.jira.projects).toHaveBeenCalledTimes(2);
    await m.state.setExcluded(['DEV']);
    await m.exclude({ ids: ['4'], field: 'id', watch: null });
    expect(m.jira.projects).toHaveBeenCalledTimes(3);
  });
  it('passes an error through untouched', async () => {
    const m = await withList(make(), ['OPS']);
    const result = { error: 'Board "B" not found', log: 'Board not found' };
    expect(await m.exclude(result)).toBe(result);
    expect(m.searched).toEqual([]);
  });
});
