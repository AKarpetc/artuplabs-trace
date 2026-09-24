import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  defs: {},
  hasPermission: vi.fn(),
  kvsStore: new Map(),
}));

vi.mock('@forge/resolver', () => ({
  default: class {
    define(key, fn) {
      h.defs[key] = fn;
    }

    getDefinitions() {
      return h.defs;
    }
  },
}));
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: vi.fn(async (key) => h.kvsStore.get(key)),
    set: vi.fn(async (key, value) => { h.kvsStore.set(key, value); }),
  },
}));
vi.mock('../../src/infra/jira', () => ({
  createJira: () => ({ hasPermission: h.hasPermission }),
  asUserRequest: vi.fn(),
}));
vi.mock('../../src/infra/repo', () => ({
  coverageCounts: vi.fn(async () => ({ total: 0, covered: 0 })),
  latestJob: vi.fn(async () => undefined),
  gapsPage: vi.fn(async () => []),
  suspectsPage: vi.fn(async () => []),
  confirmLink: vi.fn(async () => 1),
  issueTrace: vi.fn(async () => ({ isRequirement: false, covered: false, links: [] })),
}));
vi.mock('../../src/infra/baselineRepo', () => ({
  listBaselines: vi.fn(async () => []),
  baselineProject: vi.fn(async () => '10001'),
  diffCounts: vi.fn(async () => ({})),
  diffPage: vi.fn(async () => []),
}));
vi.mock('../../src/infra/settings', () => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(async () => {}),
  getSyncMeta: vi.fn(async () => undefined),
}));
vi.mock('../../src/infra/schema', () => ({ runMigrations: vi.fn(async () => []) }));
vi.mock('../../src/handlers/worker', () => ({
  startSync: vi.fn(async () => 1),
  startBaseline: vi.fn(async () => 1),
}));

const { resolverHandler } = await import('../../src/handlers/resolvers');
const settings = await import('../../src/infra/settings');
const worker = await import('../../src/handlers/worker');
const { normalizeConfig } = await import('../../src/core/config');

function call(key, payload = {}, context = {}) {
  return resolverHandler[key]({
    payload: { projectId: '10001', ...payload },
    context: { environmentType: 'DEVELOPMENT', accountId: 'acc-1', ...context },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.kvsStore.clear();
  h.hasPermission.mockResolvedValue(true);
});

describe('define() guard', () => {
  it('rejects a non-numeric project id with bad-request before asking Jira for permissions', async () => {
    await expect(call('getOverview', { projectId: '10001 OR 1=1' })).rejects.toThrow('bad-request');
    await expect(call('getOverview', { projectId: undefined })).rejects.toThrow('bad-request');
    expect(h.hasPermission).not.toHaveBeenCalled();
  });
});

describe('saveSettings', () => {
  const stored = normalizeConfig({ requirementTypeIds: ['10006'], verificationTypeIds: ['10007'], fingerprintFieldIds: ['summary', 'description'] });

  it('first save starts a full sync without re-anchoring and registers the project', async () => {
    settings.getConfig.mockResolvedValue(normalizeConfig(undefined));
    const res = await call('saveSettings', { config: { requirementTypeIds: ['10006'], verificationTypeIds: ['10007'] } });
    expect(res).toEqual({ errors: [] });
    expect(worker.startSync).toHaveBeenCalledWith('10001', { full: true, reanchor: false });
    expect(h.kvsStore.get('projects')).toEqual(['10001']);
  });

  it('changed requirement types start a full sync', async () => {
    settings.getConfig.mockResolvedValue(stored);
    await call('saveSettings', { config: { ...stored, requirementTypeIds: ['10006', '10008'] } });
    expect(worker.startSync).toHaveBeenCalledWith('10001', { full: true, reanchor: false });
  });

  it('ignores incoming fingerprint fields: keeps the stored ones and never re-anchors (R26)', async () => {
    settings.getConfig.mockResolvedValue(stored);
    const res = await call('saveSettings', { config: { ...stored, fingerprintFieldIds: ['summary', 'customfield_1'] } });
    expect(res).toEqual({ errors: [] });
    expect(settings.saveConfig).toHaveBeenCalledWith('10001', expect.objectContaining({ fingerprintFieldIds: ['summary', 'description'] }));
    expect(worker.startSync).not.toHaveBeenCalled();
  });

  it('invalid ids return errors and save nothing', async () => {
    settings.getConfig.mockResolvedValue(stored);
    const res = await call('saveSettings', { config: { requirementTypeIds: ['1) OR project = 99 OR issuetype in (1'], verificationTypeIds: ['10007'] } });
    expect(res.errors).toContain('Issue type and link type ids must be numeric Jira ids.');
    expect(settings.saveConfig).not.toHaveBeenCalled();
    expect(worker.startSync).not.toHaveBeenCalled();
    expect(h.kvsStore.has('projects')).toBe(false);
  });
});
