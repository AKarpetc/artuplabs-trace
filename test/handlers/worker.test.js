import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/infra/repo', () => ({
  latestJob: vi.fn(async () => undefined),
  createJob: vi.fn(async () => 42),
  getJob: vi.fn(),
  saveJob: vi.fn(async () => {}),
}));
vi.mock('../../src/infra/settings', () => ({
  getConfig: vi.fn(),
  getSyncMeta: vi.fn(),
  saveSyncMeta: vi.fn(async () => {}),
  getBudget: vi.fn(),
  saveBudget: vi.fn(),
}));
vi.mock('../../src/infra/baselineRepo', () => ({}));
vi.mock('../../src/infra/queue', () => ({ enqueueJob: vi.fn(async () => {}) }));
vi.mock('../../src/infra/schema', () => ({ runMigrations: vi.fn(async () => []) }));
vi.mock('../../src/infra/jira', async (importOriginal) => ({ ...(await importOriginal()), createJira: vi.fn(() => ({})), asAppRequest: vi.fn() }));
vi.mock('@forge/api', () => ({ default: {}, assumeTrustedRoute: (p) => p }));
vi.mock('../../src/core/jobs', async (importOriginal) => ({ ...(await importOriginal()), runSyncStep: vi.fn() }));

const { startSync, jobWorker } = await import('../../src/handlers/worker');
const repo = await import('../../src/infra/repo');
const settings = await import('../../src/infra/settings');
const queue = await import('../../src/infra/queue');
const jobs = await import('../../src/core/jobs');

const config = { requirementTypeIds: ['10006'], verificationTypeIds: ['10007'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

beforeEach(() => {
  vi.clearAllMocks();
  settings.getConfig.mockResolvedValue(config);
  settings.getSyncMeta.mockResolvedValue({ lastSyncStartedAt: Date.now() - 60_000, lastFullSyncAt: '2026-09-20T00:00:00.000Z' });
});

describe('startSync', () => {
  it('enqueues the first step after the requested delay', async () => {
    await startSync('10001', { full: false, delaySeconds: 60 });
    expect(queue.enqueueJob).toHaveBeenCalledWith(42, 60);
    expect(repo.createJob).toHaveBeenCalledWith('incremental-sync', '10001', expect.objectContaining({ pages: 0 }), expect.any(String));
  });

  it('enqueues at once when no delay is requested', async () => {
    await startSync('10001', { full: true });
    expect(queue.enqueueJob).toHaveBeenCalledWith(42, 0);
  });
});
