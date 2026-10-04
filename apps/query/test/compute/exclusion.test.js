import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createExclusion } from '../../src/compute/exclusion.js';
import { EXCLUDED_IDS_MAX, VALUE_LIMIT } from '../../src/core/limits.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

function make({ excluded = ['OPS'], searches = {} } = {}) {
  const state = createState({ kvs: createFakeKvs() });
  const searched = [];
  const jira = {
    projects: vi.fn(async () => [{ id: '1', key: 'OPS' }, { id: '2', key: 'DEV' }, { id: '3', key: 'HR' }]),
    searchIds: async (jql) => {
      searched.push(jql);
      const answer = typeof searches === 'function' ? searches(jql) : searches[jql];
      return answer ?? [];
    },
  };
  return { exclude: createExclusion({ jira, state }), state, jira, searched, excluded };
}
const withList = async (m, keys) => {
  await m.state.setExcluded(keys);
  return m;
};

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
  it('keeps a parent result and leaves out the excluded children by id in its root filter', async () => {
    const m = await withList(make({ searches: { '(issuetype in subTaskIssueTypes()) AND parent in (7,8) AND project in ("OPS")': ['70'] } }), ['OPS']);
    expect(await m.exclude({ ids: ['7', '8'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: ['1'] })).toEqual({
      ids: ['7', '8'], field: 'parent', rootFilter: '(issuetype in subTaskIssueTypes()) AND id not in (70)', watch: ['1'],
    });
  });
  it('adds the filter to a parent result without one, and leaves a parent result with no excluded child as it is', async () => {
    const m = await withList(make({ searches: { 'parent in (7) AND project in ("OPS")': ['71', '70'] } }), ['OPS']);
    expect((await m.exclude({ ids: ['7'], field: 'parent', watch: null })).rootFilter).toBe('id not in (70,71)');
    const result = { ids: ['8'], field: 'parent', watch: null };
    expect(await m.exclude(result)).toBe(result);
  });
  it('turns a parent result into the matching ids when too many children are excluded', async () => {
    const many = ids(EXCLUDED_IDS_MAX + 1, 5000);
    const m = await withList(make({ searches: { 'parent in (7) AND project in ("HR", "OPS")': many, 'parent in (7) AND project not in ("HR", "OPS")': ['12', '11'] } }), ['OPS', 'HR']);
    expect(await m.exclude({ ids: ['7'], field: 'parent', watch: ['3'] })).toEqual({ ids: ['11', '12'], field: 'id', watch: ['3'] });
  });
  it('leaves out the excluded issues of a native answer by id, or turns it into ids when there are too many', async () => {
    const m = await withList(make({ searches: { '(sprint = 5) AND project in ("OPS")': ['9', '4'] } }), ['OPS']);
    expect(await m.exclude({ native: 'sprint = 5' })).toEqual({ native: '(sprint = 5) AND id not in (4,9)' });
    const result = { native: 'id = -1' };
    expect(await m.exclude(result)).toBe(result);
    const many = ids(EXCLUDED_IDS_MAX + 1, 5000);
    const n = await withList(make({ searches: { '(attachments is not EMPTY) AND project in ("OPS")': many, '(attachments is not EMPTY) AND project not in ("OPS")': ['3', '2'] } }), ['OPS']);
    expect(await n.exclude({ native: 'attachments is not EMPTY' })).toEqual({ ids: ['2', '3'], field: 'id', watch: null });
  });
  it('passes an error through untouched', async () => {
    const m = await withList(make(), ['OPS']);
    const result = { error: 'Board "B" not found', log: 'Board not found' };
    expect(await m.exclude(result)).toBe(result);
    expect(m.searched).toEqual([]);
  });
});
