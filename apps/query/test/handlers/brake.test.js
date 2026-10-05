import { describe, expect, it, vi } from 'vitest';
import { BUDGET_AT, makeDeps, RECENT, spend, withBudget } from './makeDeps.js';
import { brake, brakedUntil, brakeNear, brakeOf, scheduleWake } from '../../src/handlers/brake.js';
import { onRefresh, refreshOnce } from '../../src/handlers/refresh.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { HEAVY_ATTEMPTS, REFRESH_USED_MS, PAGE_CACHE_MS, QUEUE_DELAY_MAX_S, RATE_BRAKE_MAX_MS, RATE_BRAKE_MIN_MS, REFRESH_RETRY_DELAY_S } from '../../src/core/limits.js';

const rateLimit = (retryAt) => Object.assign(new Error('The request has been rate-limited.'), { name: 'RateLimitError', status: 429, retryAt });
const NOW = 1000000;
const light = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
const heavyEntry = (key, at, extra = {}) => ({ key: `childIssuesOf[${JSON.stringify(key)}]`, functionName: 'childIssuesOf', userArgs: [key], at, ...extra });
const quietly = async (task) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await task();
  } finally {
    error.mockRestore();
  }
};

describe('brake', () => {
  it('records that a 429 set the pause', async () => {
    const deps = makeDeps();
    await brake(deps, NOW + 425000);
    expect(await brakeOf(deps)).toEqual({ until: NOW + 425000, reason: 'rate' });
  });
  it('pauses the background until the next hour when Jira warns that the pool is nearly used', async () => {
    const deps = makeDeps({ now: () => Date.parse('2026-10-05T07:40:00Z') });
    expect(await brakeNear(deps)).toEqual(Date.parse('2026-10-05T08:00:00Z'));
    expect(await brakeOf(deps)).toEqual({ until: Date.parse('2026-10-05T08:00:00Z'), reason: 'near' });
  });
  it('keeps a later rate pause when the pool is nearly used', async () => {
    const deps = makeDeps({ now: () => Date.parse('2026-10-05T07:40:00Z') });
    await brake(deps, Date.parse('2026-10-05T08:10:00Z'));
    await brakeNear(deps);
    expect(await brakeOf(deps)).toEqual({ until: Date.parse('2026-10-05T08:10:00Z'), reason: 'rate' });
  });
  it('reads a pause stored as a bare time as a rate pause', async () => {
    const deps = makeDeps();
    await deps.state.brake.set(NOW + 60000);
    expect([await brakeOf(deps), await brakedUntil(deps)]).toEqual([{ until: NOW + 60000, reason: 'rate' }, NOW + 60000]);
  });
  it('stops the background while the pool is nearly used', async () => {
    const deps = makeDeps();
    const until = await brakeNear(deps);
    expect([await onRefresh(deps, { body: { kind: 'heavy' } }), await onReconcile(deps)]).toEqual([{ braked: until }, { braked: until }]);
  });
  it('has no pause once it has passed', async () => {
    const deps = makeDeps();
    await brakeNear(deps);
    deps.advance(3600000);
    expect(await brakeOf(deps)).toBe(null);
  });
  it('pauses the background work until the instant Jira named and schedules one wake for it', async () => {
    const deps = makeDeps();
    expect(await brake(deps, NOW + 425000)).toEqual(NOW + 425000);
    expect([await brakedUntil(deps), deps.pushed]).toEqual([NOW + 425000, [[{ kind: 'wake' }, Math.min(425, QUEUE_DELAY_MAX_S)]]]);
  });
  it('pauses for the shortest pause when Jira named no instant', async () => {
    const deps = makeDeps();
    expect(await brake(deps, null)).toEqual(NOW + RATE_BRAKE_MIN_MS);
  });
  it('pauses for at most the longest pause', async () => {
    const deps = makeDeps();
    expect(await brake(deps, NOW + 10 * RATE_BRAKE_MAX_MS)).toEqual(NOW + RATE_BRAKE_MAX_MS);
  });
  it('keeps a later pause already set', async () => {
    const deps = makeDeps();
    await brake(deps, NOW + 600000);
    await brake(deps, NOW + 120000);
    expect(await brakedUntil(deps)).toEqual(NOW + 600000);
  });
  it('lets the background run once the pause has passed', async () => {
    const deps = makeDeps();
    await brake(deps, NOW + 120000);
    deps.advance(120000);
    expect(await brakedUntil(deps)).toBe(null);
  });
  it('pushes no second wake while one is scheduled', async () => {
    const deps = makeDeps();
    await brake(deps, NOW + 120000);
    await brake(deps, NOW + 300000);
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, 120]]);
  });
  it('schedules a wake no later than the queue allows', async () => {
    const deps = makeDeps();
    await scheduleWake(deps, NOW + 3600000);
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, QUEUE_DELAY_MAX_S]]);
  });
  it('schedules a wake again when the queue refused the last one', async () => {
    const deps = makeDeps();
    const push = deps.queue.push;
    deps.queue.push = async () => { throw new Error('400'); };
    expect(await quietly(() => scheduleWake(deps, NOW + 60000))).toBe(false);
    deps.queue.push = push;
    expect(await scheduleWake(deps, NOW + 60000)).toBe(true);
  });
});

describe('refresh under a rate limit', () => {
  it('computes nothing while the background is paused and leaves the journal for the wake', async () => {
    const compute = { hasSubtasks: vi.fn() };
    const deps = makeDeps({ pcs: light, compute });
    deps.jira.precomputations = vi.fn(async () => light);
    await brake(deps, NOW + 300000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect(await onRefresh(deps, { body: { kind: 'refresh', ts: NOW } })).toEqual({ braked: NOW + 300000 });
    expect([deps.jira.precomputations.mock.calls.length, compute.hasSubtasks.mock.calls.length, (await deps.journal.read(10)).length]).toEqual([0, 0, 1]);
  });
  it('stops a pass a 429 hit: keeps the rows, writes nothing, pauses the background and wakes at the reset instead of retrying in a minute', async () => {
    const deps = makeDeps({ pcs: light, compute: { hasSubtasks: async () => { throw rateLimit(NOW + 425000); } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const result = await quietly(() => onRefresh(deps, { body: { kind: 'refresh', ts: NOW } }));
    expect(result.braked).toBe(true);
    expect([deps.written, (await deps.journal.read(10)).length, await brakedUntil(deps), await deps.state.lease.get()]).toEqual([[], 1, NOW + 425000, null]);
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, Math.min(425, QUEUE_DELAY_MAX_S)]]);
    expect(deps.pushed.some(([, delay]) => delay === REFRESH_RETRY_DELAY_S)).toBe(false);
  });
  it('records no error for a group a 429 stopped', async () => {
    const deps = makeDeps({ pcs: light, compute: { hasSubtasks: async () => { throw rateLimit(NOW + 60000); } } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await quietly(() => onRefresh(deps, { body: { kind: 'refresh', ts: NOW } }));
    expect(await deps.state.errors()).toEqual([]);
  });
  it('pauses the background when the list of precomputations is rate-limited, without throwing', async () => {
    const deps = makeDeps({ pcs: light });
    deps.jira.precomputations = async () => { throw rateLimit(NOW + 90000); };
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect((await onRefresh(deps, { body: { kind: 'refresh', ts: NOW } })).braked).toBe(true);
    expect([await brakedUntil(deps), await deps.state.lease.get()]).toEqual([NOW + 90000, null]);
  });
  it('writes no group of a pass a 429 stopped', async () => {
    const pcs = [...light, { id: 'p', functionName: 'previousSprint', arguments: ['B'], value: 'sprint = 1', used: RECENT }];
    const previousSprint = vi.fn(async () => ({ ids: ['5'], field: 'sprint' }));
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => { throw rateLimit(NOW + 60000); }, previousSprint } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created', 'sprint'] }, 999500);
    const result = await quietly(() => onRefresh(deps, { body: { kind: 'refresh', ts: NOW } }));
    expect([result.braked, deps.written]).toEqual([true, []]);
  });
});

describe('wake', () => {
  it('runs the journal first and then starts the heavy lane', async () => {
    const deps = makeDeps({ pcs: light, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.heavy.put(heavyEntry('q', 990000));
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'wake' } });
    expect(result.passes).toHaveLength(1);
    expect([deps.written, (await deps.journal.read(10)).length]).toEqual([[{ id: 'h', value: 'id in (2)' }], 0]);
    expect(deps.pushed.map(([body]) => body.kind)).toEqual(['refresh', 'heavy']);
  });
  it('waits again while the pause lasts', async () => {
    const deps = makeDeps({ pcs: light });
    await deps.state.brake.set(NOW + 2000000);
    expect(await onRefresh(deps, { body: { kind: 'wake' } })).toEqual({ braked: NOW + 2000000 });
    expect(deps.pushed).toEqual([[{ kind: 'wake' }, QUEUE_DELAY_MAX_S]]);
  });
});

describe('compute job under a rate limit', () => {
  const job = { kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] };
  it('drops a job while the background is paused: the next function call asks again', async () => {
    const parentsOf = vi.fn();
    const deps = makeDeps({ compute: { parentsOf } });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: NOW });
    await deps.state.brake.set(NOW + 60000);
    expect(await onRefresh(deps, { body: job })).toEqual({ braked: NOW + 60000 });
    expect(parentsOf).not.toHaveBeenCalled();
  });
  it('drops a job no function call asked for within the page cache time', async () => {
    const parentsOf = vi.fn();
    const deps = makeDeps({ compute: { parentsOf } });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: NOW - PAGE_CACHE_MS });
    expect(await onRefresh(deps, { body: job })).toEqual({ skipped: 'parentsOf["q"]' });
    expect(parentsOf).not.toHaveBeenCalled();
  });
  it('pauses the background and returns, so the queue does not retry the job, when a 429 stops it', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => { throw rateLimit(NOW + 425000); } } });
    await deps.state.addJob({ key: 'parentsOf["q"]', functionName: 'parentsOf', userArgs: ['q'], at: NOW });
    expect(await quietly(() => onRefresh(deps, { body: job }))).toEqual({ computed: 'parentsOf["q"]', braked: true });
    expect(await brakedUntil(deps)).toEqual(NOW + 425000);
  });
});

describe('heavy lane under a rate limit', () => {
  const pcs = [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', used: RECENT }];
  it('runs no group while the background is paused and keeps the lane as it is', async () => {
    const childIssuesOf = vi.fn();
    const deps = makeDeps({ pcs, compute: { childIssuesOf } });
    await deps.state.heavy.put(heavyEntry('q', 990000));
    await deps.state.brake.set(NOW + 60000);
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ braked: NOW + 60000 });
    expect([childIssuesOf.mock.calls.length, await deps.state.heavy.oldest()]).toEqual([0, heavyEntry('q', 990000)]);
  });
  it('moves a group a 429 stopped behind the others, counts the try, logs it and waits for the wake instead of pushing itself', async () => {
    const deps = makeDeps({ pcs, compute: { childIssuesOf: async () => { throw rateLimit(NOW + 425000); } } });
    await deps.state.heavy.put(heavyEntry('q', 990000));
    const result = await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
    expect(result).toEqual({ heavy: { computed: 'childIssuesOf["q"]', braked: true } });
    expect(await deps.state.heavy.oldest()).toEqual(heavyEntry('q', NOW, { tries: 1 }));
    expect(await deps.state.errors()).toEqual([{ at: NOW, functionName: 'childIssuesOf', message: 'Stopped by the Jira rate limit' }]);
    expect([deps.pushed, await deps.state.heavy.lease.get()]).toEqual([[[{ kind: 'wake' }, Math.min(425, QUEUE_DELAY_MAX_S)]], null]);
  });
  it('gives a group up after as many rate-limited runs as the attempts allow', async () => {
    const deps = makeDeps({ pcs, compute: { childIssuesOf: async () => { throw rateLimit(null); } } });
    await deps.state.heavy.put(heavyEntry('q', 990000));
    for (let i = 0; i < HEAVY_ATTEMPTS; i += 1) {
      await deps.state.brake.clear();
      await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }));
      deps.advance(1000);
    }
    expect(await deps.state.heavy.oldest()).toBe(null);
  });
});

describe('reconcile under a rate limit', () => {
  const old = new Date(NOW - 2 * 3600000).toISOString();
  const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
  it('reconciles nothing while the background is paused', async () => {
    const indexReconcile = vi.fn();
    const deps = makeDeps({ pcs, indexReconcile });
    deps.jira.precomputations = vi.fn();
    await deps.state.brake.set(NOW + 60000);
    expect(await onReconcile(deps)).toEqual({ braked: NOW + 60000 });
    expect([deps.jira.precomputations.mock.calls.length, indexReconcile.mock.calls.length]).toEqual([0, 0]);
  });
  it('stops at a 429, writes nothing, leaves the index for later and pauses the background without throwing', async () => {
    const indexReconcile = vi.fn();
    const deps = makeDeps({ pcs, indexReconcile, compute: { hasSubtasks: async () => { throw rateLimit(NOW + 120000); } } });
    expect(await onReconcile(deps)).toEqual({ braked: true });
    expect([deps.written, indexReconcile.mock.calls.length, await brakedUntil(deps)]).toEqual([[], 0, NOW + 120000]);
  });
  it('pauses the background when the index gap filler is rate-limited', async () => {
    const deps = makeDeps({ indexReconcile: async () => { throw rateLimit(NOW + 120000); } });
    expect(await onReconcile(deps)).toEqual({ braked: true });
  });
});

describe('heavy groups nobody uses', () => {
  const longAgo = new Date(NOW - REFRESH_USED_MS - 1000).toISOString();
  const idle = [{ id: 'c', functionName: 'childIssuesOf', arguments: ['q'], value: 'parent in (1)', used: longAgo }];
  it('leaves a slow group nobody used for a day out of the heavy lane (the hourly reconcile catches up once it is used again)', async () => {
    const childIssuesOf = vi.fn();
    const deps = makeDeps({ pcs: idle, compute: { childIssuesOf } });
    await deps.cache.write('childIssuesOf["q"]', { values: ['1'], watch: ['9'], field: 'parent', rootFilter: null, at: 1, source: 'job', ms: 60000 });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-updated'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ recomputed: 0, handed: 0 });
    expect([childIssuesOf.mock.calls.length, await deps.state.heavy.oldest(), deps.pushed, (await deps.journal.read(10)).length]).toEqual([0, null, [], 0]);
  });
  it('drops a waiting group nobody used for a day without computing it and goes on with the next', async () => {
    const childIssuesOf = vi.fn();
    const deps = makeDeps({ pcs: idle, compute: { childIssuesOf } });
    await deps.state.heavy.put(heavyEntry('q', 990000));
    await deps.state.heavy.put(heavyEntry('r', 995000));
    expect(await onRefresh(deps, { body: { kind: 'heavy' } })).toEqual({ heavy: { computed: 'childIssuesOf["q"]', unused: true } });
    expect([childIssuesOf.mock.calls.length, (await deps.state.heavy.oldest()).key, deps.pushed]).toEqual([0, 'childIssuesOf["r"]', [[{ kind: 'heavy' }, null]]]);
  });
  it('pauses the background without throwing when the lane cannot list the precomputations', async () => {
    const deps = makeDeps();
    deps.jira.precomputations = async () => { throw rateLimit(NOW + 60000); };
    await deps.state.heavy.put(heavyEntry('q', 990000));
    expect(await quietly(() => onRefresh(deps, { body: { kind: 'heavy' } }))).toEqual({ heavy: null });
    expect([await brakedUntil(deps), await deps.state.heavy.oldest(), await deps.state.heavy.lease.get()]).toEqual([NOW + 60000, heavyEntry('q', 990000), null]);
  });
  it('logs which functions a pass computed and handed over, by name only, when requests are logged', async () => {
    const deps = makeDeps({ pcs: light, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) }, logKvs: { requests: true } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await refreshOnce(deps);
    expect(log.mock.calls).toEqual([['refresh pass: 1 groups, computed hasSubtasks@0h 1, handed none']]);
    log.mockRestore();
  });
  it('recomputes no group, light or slow, that Jira has not used for a day; the reconcile rewrites it within an hour of its next use', async () => {
    const hasSubtasks = vi.fn();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: longAgo }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect(await refreshOnce(deps)).toMatchObject({ groups: 0, recomputed: 0 });
    expect([hasSubtasks.mock.calls.length, (await deps.journal.read(10)).length]).toEqual([0, 0]);
  });
});

describe('compute job under the points budget', () => {
  const job = { kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] };
  const key = 'parentsOf["q"]';
  const parentsOf = (spending) => vi.fn(async () => { for (const n of spending) await spend(n); return { ids: ['3'], field: 'id', watch: [] }; });
  it('runs from the function lane after refresh used its own reserve', async () => {
    const compute = { parentsOf: parentsOf([30]) };
    const deps = withBudget(makeDeps({ compute }));
    await deps.state.addJob({ key, functionName: 'parentsOf', userArgs: ['q'], at: BUDGET_AT });
    await deps.points.add('refresh', 3000);
    expect(await onRefresh(deps, { body: job })).toEqual({ computed: key, changed: 0 });
    expect((await deps.cache.meta(key)).pts).toEqual(30);
  });
  it('waits, computing nothing, while the function lane cannot hold the points the group last cost', async () => {
    const compute = { parentsOf: parentsOf([]) };
    const deps = withBudget(makeDeps({ compute }));
    await deps.state.addJob({ key, functionName: 'parentsOf', userArgs: ['q'], at: BUDGET_AT, pts: 600, floor: false });
    await deps.points.add('fn', 1000);
    expect(await onRefresh(deps, { body: job })).toEqual({ computed: key, waitUntil: Date.parse('2026-10-05T07:30:00Z') });
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('keeps the points it spent as a lower bound when the budget stops it', async () => {
    const deps = withBudget(makeDeps({ compute: { parentsOf: parentsOf([1500, 1]) } }));
    await deps.state.addJob({ key, functionName: 'parentsOf', userArgs: ['q'], at: BUDGET_AT });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await onRefresh(deps, { body: job })).toEqual({ computed: key, stopped: 'group' });
    error.mockRestore();
    expect(await deps.state.job(key)).toMatchObject({ pts: 1500, floor: true });
  });
});
