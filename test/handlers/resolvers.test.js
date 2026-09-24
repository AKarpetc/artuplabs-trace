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
