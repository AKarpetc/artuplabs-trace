import { describe, expect, it, vi } from 'vitest';
import { createResolverDefinitions } from '../src/handlers/resolvers.js';
import { createFakeKvs } from './fakeKvs.js';
import { createState } from '../src/infra/state.js';
import { shippedFunctions } from '../src/core/catalog.js';

const run = (defs, key, context, payload) => defs[key]({ context, payload });

describe('getAccess', () => {
  const defs = createResolverDefinitions({});
  it('is unlicensed in production without an active licence', async () => {
    expect(await run(defs, 'getAccess', { environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ licensed: false, environmentType: 'PRODUCTION' });
  });
  it('is unlicensed when the context names no environment and no licence', async () => {
    expect(await run(defs, 'getAccess', {})).toEqual({ licensed: false, environmentType: '' });
  });
  it('is licensed in development', async () => {
    expect(await run(defs, 'getAccess', { environmentType: 'DEVELOPMENT' })).toEqual({ licensed: true, environmentType: 'DEVELOPMENT' });
  });
});

describe('getStatus', () => {
  it('lists the shipped functions with usage and reports the refresh state', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.lease.set(990000);
    await state.recordError({ at: 5, functionName: 'subtasksOf', message: 'Usage: subtasksOf(subquery)' });
    const defs = createResolverDefinitions({ state, now: () => 1000000 });
    const status = await run(defs, 'getStatus', { environmentType: 'DEVELOPMENT' });
    expect(status.functions[0]).toEqual({ name: 'subtasksOf', group: 'query', usage: 'subtasksOf(subquery)', examples: ['issue in subtasksOf("project = DEMO AND status = \\"In Progress\\"")'] });
    expect(status.functions.map((f) => f.name)).toEqual(shippedFunctions().map((f) => f.name));
    expect([status.queue, status.errors.length, status.progress, status.excluded]).toEqual([{ pending: false, running: true }, 1, null, []]);
  });
  it('refuses without a licence', async () => {
    const defs = createResolverDefinitions({ state: createState({ kvs: createFakeKvs() }), now: () => 0 });
    await expect(run(defs, 'getStatus', { environmentType: 'PRODUCTION', license: { active: false } })).rejects.toThrow('unlicensed');
  });
});

describe('admin resolvers', () => {
  const ADMIN = ['adminStatus', 'setExcluded', 'reindexProject', 'resetIndex'];
  const adminDeps = (overrides = {}) => ({
    state: createState({ kvs: createFakeKvs() }),
    now: () => 0,
    isAdmin: async () => false,
    shippedParts: () => [],
    ...overrides,
  });
  it('defines every admin action', () => {
    expect(ADMIN.every((key) => typeof createResolverDefinitions(adminDeps())[key] === 'function')).toBe(true);
  });
  it('passes the known error codes through', async () => {
    const defs = createResolverDefinitions(adminDeps());
    for (const key of ADMIN) await expect(run(defs, key, { environmentType: 'DEVELOPMENT' })).rejects.toThrow('forbidden');
    await expect(run(defs, 'adminStatus', { environmentType: 'PRODUCTION', license: { active: false } })).rejects.toThrow('unlicensed');
  });
  it('answers internal for anything else and logs the action without values', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const defs = createResolverDefinitions(adminDeps({ isAdmin: async () => { throw Object.assign(new Error('JQLG secret'), { name: 'JiraError' }); } }));
    await expect(run(defs, 'setExcluded', { environmentType: 'DEVELOPMENT' }, { projectKeys: ['JQLG'] })).rejects.toThrow(/^internal$/);
    const lines = error.mock.calls.map((c) => c.join(' '));
    error.mockRestore();
    expect(lines).toEqual(['setExcluded failed: JiraError']);
  });
  it('passes the platform\'s consent request through unchanged, so Jira can ask the user to allow access', async () => {
    const consent = Object.assign(new Error('Authentication required'), { name: 'NEEDS_AUTHENTICATION_ERR' });
    const defs = createResolverDefinitions(adminDeps({ isAdmin: async () => { throw consent; } }));
    await expect(run(defs, 'adminStatus', { environmentType: 'DEVELOPMENT' })).rejects.toBe(consent);
  });
  it('treats a missing payload as empty', async () => {
    const defs = createResolverDefinitions(adminDeps({ isAdmin: async () => true }));
    expect(await run(defs, 'adminStatus', { environmentType: 'DEVELOPMENT' }, undefined)).toEqual({ excluded: [], progress: null, parts: [], rows: {} });
  });
});
