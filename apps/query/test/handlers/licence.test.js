import { describe, expect, it, vi } from 'vitest';
import { makeDeps, RECENT } from './makeDeps.js';
import { onEvent } from '../../src/handlers/trigger.js';
import { onRefresh } from '../../src/handlers/refresh.js';
import { onReconcile } from '../../src/handlers/reconcile.js';
import { onBackfill } from '../../src/handlers/backfill.js';
import { handleFunction } from '../../src/handlers/functions.js';
import { createResolverDefinitions } from '../../src/handlers/resolvers.js';
import { backgroundAllowed } from '../../src/handlers/licence.js';
import { licenceState } from '../../src/access.js';
import { REWRITE_ALL_KIND } from '../../src/core/affected.js';
import { ERR } from '../../src/core/errors.js';

const PROD = () => ({ environmentType: 'PRODUCTION' });
const INACTIVE = { license: { active: false } };
const ACTIVE = { license: { active: true } };
const EVENT = { eventType: 'avi:jira:created:issuelink', issueLink: { sourceIssueId: 1, destinationIssueId: 2 } };
const pcs = [
  { id: 'a', functionName: 'hasSubtasks', arguments: [], operator: 'in', value: 'id in (1)', used: RECENT },
  { id: 'b', functionName: 'parentsOf', arguments: ['q'], operator: 'not in', value: 'id in (2)', used: RECENT },
];
const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {});

describe('licence state', () => {
  it('is inactive only for an explicit false, the old field read when the new one is missing', () => {
    expect([licenceState({ active: false }), licenceState({ isActive: false }), licenceState({ active: true, isActive: false })]).toEqual(['inactive', 'inactive', 'active']);
  });
  it('is unknown without a licence', () => {
    expect([licenceState(undefined), licenceState({})]).toEqual(['unknown', 'unknown']);
  });
});

describe('licence of the background work', () => {
  it('works in development without a licence', async () => {
    expect(await backgroundAllowed(makeDeps({ appContext: () => ({ environmentType: 'DEVELOPMENT' }) }))).toBe(true);
  });
  it('works when neither the app context nor the handler context names an environment or a licence', async () => {
    expect(await backgroundAllowed(makeDeps({ appContext: () => ({}) }), {})).toBe(true);
  });
  it('works in production when no licence comes and none was seen, and logs that none came', async () => {
    const log = quiet();
    const deps = makeDeps({ appContext: PROD });
    expect(await backgroundAllowed(deps, {})).toBe(true);
    expect(log.mock.calls).toEqual([['licence: none in the background context']]);
    log.mockRestore();
  });
  it('takes the licence of the handler context over the app context', async () => {
    const deps = makeDeps({ appContext: () => ({ environmentType: 'PRODUCTION', license: { active: true } }) });
    expect(await backgroundAllowed(deps, INACTIVE)).toBe(false);
  });
  it('works without a licence in the background while functions last saw it active', async () => {
    const log = quiet();
    const deps = makeDeps({ appContext: PROD, compute: { parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) } });
    await handleFunction(deps, 'parentsOf', { clause: { arguments: ['q'], operator: 'in' } }, ACTIVE);
    expect(await backgroundAllowed(deps, {})).toBe(true);
    log.mockRestore();
  });
  it('stops without a licence in the background once a resolver saw it inactive', async () => {
    const log = quiet();
    const deps = makeDeps({ appContext: PROD });
    await createResolverDefinitions(deps).getStatus({ context: { environmentType: 'PRODUCTION', ...INACTIVE } }).catch(() => null);
    expect(await backgroundAllowed(deps, {})).toBe(false);
    log.mockRestore();
  });
  it('neither indexes, journals nor queues an event with an inactive licence', async () => {
    const indexEvent = vi.fn(async () => null);
    const deps = makeDeps({ appContext: PROD, indexEvent });
    expect(await onEvent(deps, EVENT, INACTIVE)).toEqual({ unlicensed: true });
    expect([indexEvent.mock.calls.length, await deps.journal.read(10), deps.pushed]).toEqual([0, [], []]);
  });
  it('runs no refresh pass with an inactive licence', async () => {
    const searchIds = vi.fn(async () => []);
    const deps = makeDeps({ appContext: PROD, pcs });
    deps.jira.searchIds = searchIds;
    await deps.journal.append({ ids: ['1'], kinds: ['link'] }, deps.now());
    expect(await onRefresh(deps, { body: { kind: 'refresh' } }, INACTIVE)).toEqual({ unlicensed: true });
    expect([searchIds.mock.calls.length, deps.written]).toEqual([0, []]);
  });
  it('fills no index part with an inactive licence', async () => {
    const push = vi.fn(async () => {});
    const deps = makeDeps({ appContext: PROD, backfillQueue: { push }, indexParts: { sprint: {} } });
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1 } }, INACTIVE)).toEqual({ unlicensed: true });
    expect(push).not.toHaveBeenCalled();
  });
  it('stores the licence error in every precomputation once, and checks no index', async () => {
    const indexReconcile = vi.fn(async () => null);
    const deps = makeDeps({ appContext: () => ({ environmentType: 'PRODUCTION', ...INACTIVE }), pcs, indexReconcile });
    expect(await onReconcile(deps)).toEqual({ unlicensed: true, written: 2 });
    expect(await onReconcile(deps)).toEqual({ unlicensed: true, written: 0 });
    expect([deps.written, indexReconcile.mock.calls.length]).toEqual([[{ id: 'a', error: ERR.unlicensed() }, { id: 'b', error: ERR.unlicensed() }], 0]);
  });
  it('stores no licence error when no licence comes and none was seen', async () => {
    const log = quiet();
    const deps = makeDeps({ appContext: PROD, pcs: [] });
    expect(await onReconcile(deps)).toEqual({ groups: 0, changed: 0, index: null });
    expect(deps.written).toEqual([]);
    log.mockRestore();
  });
  it('rewrites every precomputation on the first licensed run after an unlicensed one', async () => {
    const deps = makeDeps({ appContext: PROD });
    await onEvent(deps, EVENT, INACTIVE);
    await onEvent(deps, EVENT, ACTIVE);
    await onEvent(deps, EVENT, ACTIVE);
    expect((await deps.journal.read(10)).map((r) => r.value.kinds)).toEqual([[REWRITE_ALL_KIND], ['link'], ['link']]);
  });
  it('follows the licence events last saw when the queue gets none', async () => {
    const log = quiet();
    const deps = makeDeps({ appContext: PROD });
    await onEvent(deps, EVENT, INACTIVE);
    const stopped = await onRefresh(deps, { body: { kind: 'refresh' } }, undefined);
    await onEvent(deps, EVENT, ACTIVE);
    const ran = await onRefresh(deps, { body: { kind: 'refresh' } }, undefined);
    expect([stopped, ran.unlicensed, await deps.state.licence.get()]).toEqual([{ unlicensed: true }, undefined, null]);
    log.mockRestore();
  });
  it('reads the precomputation list from Jira again once the licence is back', async () => {
    const markDirty = vi.fn(async () => {});
    const deps = makeDeps({ appContext: PROD, pcList: { list: async () => pcs, markDirty } });
    await onEvent(deps, EVENT, INACTIVE);
    await onEvent(deps, EVENT, ACTIVE);
    expect(markDirty).toHaveBeenCalledTimes(1);
  });
  it('writes the seen licence only when it changes', async () => {
    const deps = makeDeps({ appContext: PROD, compute: { parentsOf: async () => ({ ids: ['3'], field: 'id', watch: [] }) } });
    const call = () => handleFunction(deps, 'parentsOf', { clause: { arguments: ['q'], operator: 'in' } }, ACTIVE);
    await call();
    await call();
    expect(deps.kvs.calls.ops.filter((op) => op === 'set q:licence:seen')).toHaveLength(1);
  });
  it('keeps no error log of the searches of an unlicensed site', async () => {
    const deps = makeDeps({ appContext: PROD });
    const reply = await handleFunction(deps, 'parentsOf', { clause: { arguments: ['q'], operator: 'in' } }, {});
    expect([reply.error, await deps.state.errors()]).toEqual([ERR.unlicensed(), []]);
  });
});
