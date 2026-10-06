import { describe, expect, it, vi } from 'vitest';
import { makeDeps, RECENT } from './makeDeps.js';
import { onEvent } from '../../src/handlers/trigger.js';
import { onRefresh } from '../../src/handlers/refresh.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { onBackfill } from '../../src/handlers/backfill.js';
import { handleFunction } from '../../src/handlers/functions.js';
import { backgroundLicensed } from '../../src/handlers/licence.js';
import { REWRITE_ALL_KIND } from '../../src/core/affected.js';
import { ERR } from '../../src/core/errors.js';

const UNLICENSED = () => ({ environmentType: 'PRODUCTION' });
const LICENSED = () => ({ environmentType: 'PRODUCTION', license: { active: true } });
const EVENT = { eventType: 'avi:jira:created:issuelink', issueLink: { sourceIssueId: 1, destinationIssueId: 2 } };
const pcs = [
  { id: 'a', functionName: 'hasSubtasks', arguments: [], operator: 'in', value: 'id in (1)', used: RECENT },
  { id: 'b', functionName: 'parentsOf', arguments: ['q'], operator: 'not in', value: 'id in (2)', used: RECENT },
];

describe('licence of the background work', () => {
  it('works in development, where Jira sends no licence', () => {
    expect(backgroundLicensed({ appContext: () => ({ environmentType: 'DEVELOPMENT' }) })).toBe(true);
  });
  it('works when the app context is unknown', () => {
    expect(backgroundLicensed({ appContext: () => null })).toBe(true);
  });
  it('stops in production without an active licence', () => {
    expect([backgroundLicensed({ appContext: UNLICENSED }), backgroundLicensed({ appContext: LICENSED })]).toEqual([false, true]);
  });
  it('neither indexes, journals nor queues an event of an unlicensed site', async () => {
    const indexEvent = vi.fn(async () => null);
    const deps = makeDeps({ appContext: UNLICENSED, indexEvent });
    expect(await onEvent(deps, EVENT)).toEqual({ unlicensed: true });
    expect([indexEvent.mock.calls.length, await deps.journal.read(10), deps.pushed]).toEqual([0, [], []]);
  });
  it('runs no refresh pass for an unlicensed site', async () => {
    const searchIds = vi.fn(async () => []);
    const deps = makeDeps({ appContext: UNLICENSED, pcs });
    deps.jira.searchIds = searchIds;
    await deps.journal.append({ ids: ['1'], kinds: ['link'] }, deps.now());
    expect(await onRefresh(deps, { body: { kind: 'refresh' } })).toEqual({ unlicensed: true });
    expect([searchIds.mock.calls.length, deps.written]).toEqual([0, []]);
  });
  it('fills no index part for an unlicensed site', async () => {
    const push = vi.fn(async () => {});
    const deps = makeDeps({ appContext: UNLICENSED, backfillQueue: { push }, indexParts: { sprint: {} } });
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1 } })).toEqual({ unlicensed: true });
    expect(push).not.toHaveBeenCalled();
  });
  it('stores the licence error in every precomputation once, and checks no index', async () => {
    const indexReconcile = vi.fn(async () => null);
    const deps = makeDeps({ appContext: UNLICENSED, pcs, indexReconcile });
    expect(await onReconcile(deps)).toEqual({ unlicensed: true, written: 2 });
    expect(await onReconcile(deps)).toEqual({ unlicensed: true, written: 0 });
    expect([deps.written, indexReconcile.mock.calls.length]).toEqual([[{ id: 'a', error: ERR.unlicensed() }, { id: 'b', error: ERR.unlicensed() }], 0]);
  });
  it('rewrites every precomputation on the first licensed run after an unlicensed one', async () => {
    let context = UNLICENSED;
    const deps = makeDeps({ appContext: () => context() });
    await onEvent(deps, EVENT);
    context = LICENSED;
    await onEvent(deps, EVENT);
    await onEvent(deps, EVENT);
    expect((await deps.journal.read(10)).map((r) => r.value.kinds)).toEqual([[REWRITE_ALL_KIND], ['link'], ['link']]);
  });
  it('reads the precomputation list from Jira again once the licence is back', async () => {
    let context = UNLICENSED;
    const markDirty = vi.fn(async () => {});
    const deps = makeDeps({ appContext: () => context(), pcList: { list: async () => pcs, markDirty } });
    await onEvent(deps, EVENT);
    context = LICENSED;
    await onEvent(deps, EVENT);
    expect(markDirty).toHaveBeenCalledTimes(1);
  });
  it('keeps no error log of the searches of an unlicensed site', async () => {
    const deps = makeDeps({ appContext: UNLICENSED });
    const reply = await handleFunction(deps, 'parentsOf', { clause: { arguments: ['q'], operator: 'in' } }, {});
    expect([reply.error, await deps.state.errors()]).toEqual([ERR.unlicensed(), []]);
  });
});
