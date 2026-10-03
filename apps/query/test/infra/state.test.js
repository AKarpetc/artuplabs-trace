import { describe, expect, it } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';

describe('state', () => {
  it('keeps the newest 20 errors first', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    for (let i = 0; i < 25; i += 1) await state.recordError({ at: i, functionName: 'f', message: `m${i}` });
    const errors = await state.errors();
    expect([errors.length, errors[0].message, errors[19].message]).toEqual([20, 'm24', 'm5']);
  });
  it('forgets compute jobs older than the page cache and replaces a job of the same group', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    await state.addJob({ key: 'a', functionName: 'f', userArgs: ['x'], at: 0 });
    await state.addJob({ key: 'b', functionName: 'f', userArgs: ['y'], at: 500000 });
    await state.addJob({ key: 'b', functionName: 'f', userArgs: ['y'], at: 550000 });
    expect(await state.jobs(650000)).toEqual([{ key: 'b', functionName: 'f', userArgs: ['y'], at: 550000 }]);
  });
  it('stores each job under its own key and deletes only stale ones', async () => {
    const kvs = createFakeKvs({ pageSize: 2 });
    const state = createState({ kvs, hash: (s) => `h${s}`, beginsWith });
    for (const [key, at] of [['a', 0], ['b', 500000], ['c', 500000], ['d', 0]]) await state.addJob({ key, functionName: 'f', userArgs: [], at });
    expect((await state.jobs(650000)).map((j) => j.key)).toEqual(['b', 'c']);
    expect([...kvs.data.keys()].sort()).toEqual(['q:job:hb', 'q:job:hc']);
  });
  it('keeps a job added while stale jobs are being cleaned', async () => {
    const kvs = createFakeKvs({ pageSize: 1 });
    const state = createState({ kvs, hash: (s) => s, beginsWith });
    await state.addJob({ key: 'old', functionName: 'f', userArgs: [], at: 0 });
    const x = { key: 'x', functionName: 'f', userArgs: ['p'], at: 700000 };
    await Promise.all([state.addJob(x), state.jobs(700000)]);
    expect(await state.jobs(700000)).toEqual([x]);
  });
  it('keeps both of two jobs added at once', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    const jobs = ['a', 'b'].map((key) => ({ key, functionName: 'f', userArgs: [], at: 1 }));
    await Promise.all(jobs.map((j) => state.addJob(j)));
    expect(await state.jobs(2)).toEqual(jobs);
  });
  it('stores excluded projects sorted and unique', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    await state.setExcluded(['B', 'A', 'B']);
    expect(await state.excluded()).toEqual(['A', 'B']);
  });
  it('keeps index progress per part', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    await state.progress.setPart('sprint', { done: 1, total: 2 });
    expect(await state.progress.get()).toEqual({ sprint: { done: 1, total: 2 } });
    await state.progress.setPart('comments', { done: 0, total: 2 });
    expect(Object.keys(await state.progress.get())).toEqual(['sprint', 'comments']);
  });
  it('reads unset records as null', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    expect([await state.pending.get(), await state.lease.get(), await state.progress.get()]).toEqual([null, null, null]);
  });
  it('stores only the time, function name and error text of an error, never its arguments', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    await state.recordError({ at: 1, functionName: 'f', message: 'boom', userArgs: ['project = SECRET'] });
    expect(await state.errors()).toEqual([{ at: 1, functionName: 'f', message: 'boom' }]);
  });
  it('clears a record', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    await state.lastRefresh.set({ at: 5 });
    expect(await state.lastRefresh.get()).toEqual({ at: 5 });
    await state.lastRefresh.clear();
    expect(await state.lastRefresh.get()).toBeNull();
  });
  it('reads, writes and clears one part of the index progress', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    await state.progress.setPart('comments', { done: 1, total: 3 });
    expect(await state.progress.getPart('comments')).toEqual({ done: 1, total: 3 });
    await state.progress.clearPart('comments');
    expect([await state.progress.getPart('comments'), await state.progress.get()]).toEqual([null, null]);
  });
  it('reads no excluded projects and no jobs before any are stored', async () => {
    const state = createState({ kvs: createFakeKvs(), hash: (s) => s, beginsWith });
    expect([await state.excluded(), await state.jobs(0), await state.errors()]).toEqual([[], [], []]);
  });
});
