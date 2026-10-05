import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { onLifecycle, resumeAfterDeploy, resumeOncePerProcess } from '../../src/handlers/lifecycle.js';
import { makeDeps } from './makeDeps.js';

describe('onLifecycle', () => {
  it('migrates and starts only the parts that were never built', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.progress.setPart('comments', { readyAt: 1 });
    const deps = {
      state, migrate: vi.fn(async () => {}), shippedParts: () => ['sprint', 'comments'], now: () => 9,
      jira: { projects: async () => [], approximateCount: async () => 0 },
      indexParts: { sprint: { prepare: async () => {} }, comments: { prepare: async () => {} } },
      backfillQueue: { push: vi.fn(async () => {}) },
    };
    expect(await onLifecycle(deps)).toEqual({ started: ['sprint'] });
    expect(deps.migrate).toHaveBeenCalled();
    expect(deps.backfillQueue.push.mock.calls).toEqual([[{ kind: 'backfill', part: 'sprint', generation: 9 }]]);
  });
  it('only migrates while no index part is shipped', async () => {
    const deps = { migrate: vi.fn(async () => {}), shippedParts: () => [] };
    expect(await onLifecycle(deps)).toEqual({ started: [] });
    expect(deps.migrate).toHaveBeenCalledTimes(1);
  });
});

describe('resume after a deploy', () => {
  function deployed({ version = '4.27.0', seen = '4.26.0' } = {}) {
    const backfill = [];
    const deps = makeDeps({
      appVersion: () => version,
      newToken: () => 'c2',
      backfillQueue: { push: async (body, delay) => { backfill.push([body, delay ?? null]); } },
    });
    return { deps, backfill, ready: async () => { if (seen) await deps.state.version.set(seen); } };
  }
  it('queues a wake for the journal at once, past the wake and the refresh job the old version had scheduled', async () => {
    const { deps, ready } = deployed();
    await ready();
    await deps.journal.append({ ids: ['1'], kinds: ['issue-updated'] }, deps.now());
    await deps.state.wake.set(deps.now() + 200000);
    await deps.state.pending.set(deps.now());
    await resumeAfterDeploy(deps);
    expect([deps.pushed, await deps.state.pending.get()]).toEqual([[[{ kind: 'wake' }, 1]], null]);
  });
  it('queues no wake while the journal is empty', async () => {
    const { deps, ready } = deployed();
    await ready();
    await resumeAfterDeploy(deps);
    expect(deps.pushed).toEqual([]);
  });
  it('continues every unfinished index part under a new chain and leaves finished parts alone', async () => {
    const { deps, backfill, ready } = deployed();
    await ready();
    await deps.state.progress.setPart('sprint', { generation: 5, done: 10, chain: 'c1' });
    await deps.state.progress.setPart('comments', { generation: 6, finishedAt: 7, readyAt: 7 });
    await resumeAfterDeploy(deps);
    expect(backfill).toEqual([[{ kind: 'backfill', part: 'sprint', generation: 5, chain: 'c2' }, null]]);
    expect((await deps.state.progress.getPart('sprint')).chain).toEqual('c2');
  });
  it('resumes once per version: the next call of the same version does nothing', async () => {
    const { deps, backfill, ready } = deployed();
    await ready();
    await deps.state.progress.setPart('sprint', { generation: 5, done: 10 });
    await resumeAfterDeploy(deps);
    await resumeAfterDeploy(deps);
    expect([backfill.length, await deps.state.version.get()]).toEqual([1, '4.27.0']);
  });
  it('does nothing when the version is the one it last resumed', async () => {
    const { deps, backfill, ready } = deployed({ seen: '4.27.0' });
    await ready();
    await deps.journal.append({ ids: ['1'], kinds: ['issue-updated'] }, deps.now());
    await deps.state.progress.setPart('sprint', { generation: 5, done: 10 });
    await resumeAfterDeploy(deps);
    expect([deps.pushed, backfill]).toEqual([[], []]);
  });
  it('records the version only once every push went through, so a failed resume is tried again', async () => {
    const { deps, backfill, ready } = deployed();
    await ready();
    await deps.journal.append({ ids: ['1'], kinds: ['issue-updated'] }, deps.now());
    await deps.state.progress.setPart('sprint', { generation: 5, done: 10 });
    const push = deps.backfillQueue.push;
    deps.backfillQueue.push = async () => { throw new Error('400 Bad Request'); };
    await expect(resumeAfterDeploy(deps)).rejects.toThrow('400 Bad Request');
    expect(await deps.state.version.get()).toEqual('4.26.0');
    deps.backfillQueue.push = push;
    expect(await resumeAfterDeploy(deps)).toBe(true);
    expect([await deps.state.version.get(), backfill.length, deps.pushed.length]).toEqual(['4.27.0', 1, 2]);
  });
  it('fails the resume when the wake cannot be queued', async () => {
    const { deps, ready } = deployed();
    await ready();
    await deps.journal.append({ ids: ['1'], kinds: ['issue-updated'] }, deps.now());
    deps.queue.push = async () => { throw new Error('400 Bad Request'); };
    await expect(resumeAfterDeploy(deps)).rejects.toThrow('400 Bad Request');
    expect([await deps.state.version.get(), await deps.state.wake.get()]).toEqual(['4.26.0', null]);
  });
  it('does nothing without a known app version', async () => {
    const { deps, backfill, ready } = deployed({ version: null });
    await ready();
    await deps.state.progress.setPart('sprint', { generation: 5, done: 10 });
    await resumeAfterDeploy(deps);
    expect(backfill).toEqual([]);
  });
  it('resumes on the installed and upgraded events too', async () => {
    const { deps, backfill, ready } = deployed();
    await ready();
    Object.assign(deps, { migrate: async () => {}, shippedParts: () => ['sprint'] });
    await deps.state.progress.setPart('sprint', { generation: 5, done: 10 });
    await onLifecycle(deps);
    expect(backfill).toEqual([[{ kind: 'backfill', part: 'sprint', generation: 5, chain: 'c2' }, null]]);
  });
});

describe('resume once per process', () => {
  it('checks the version on the first call only, once it went through', async () => {
    const get = vi.fn(async () => '4.27.0');
    const deps = { appVersion: () => '4.27.0', state: { version: { get } } };
    const resume = resumeOncePerProcess(deps);
    await resume();
    await resume();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('logs a failed check without values and tries again on the next call', async () => {
    const get = vi.fn(async () => { throw new Error('kvs down'); });
    const resume = resumeOncePerProcess({ appVersion: () => '4.27.0', state: { version: { get } } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await resume();
    await resume();
    expect([get.mock.calls.length, error.mock.calls[0]]).toEqual([2, ['resume after deploy failed: Error']]);
    error.mockRestore();
  });
  it('logs the version it resumed for', async () => {
    const { deps } = { deps: makeDeps({ appVersion: () => '4.27.0', newToken: () => 't', backfillQueue: { push: async () => {} } }) };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await resumeOncePerProcess(deps)();
    expect(log.mock.calls.map((c) => c[0])).toContain('resumed the queued background work after a deploy: 4.27.0');
    log.mockRestore();
  });
});
