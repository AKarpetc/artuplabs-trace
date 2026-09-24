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

describe('jobWorker', () => {
  function job(kind) {
    return { id: 42, kind, projectId: '10001', status: 'running', state: { syncId: 5, startedAt: 1000, pages: 0 } };
  }

  it('a finished full sync records lastSyncedAt and lastFullSyncAt', async () => {
    repo.getJob.mockResolvedValue(job('full-sync'));
    settings.getSyncMeta.mockResolvedValue({ lastFullSyncAt: 'old' });
    jobs.runSyncStep.mockResolvedValue({ status: 'done', job: job('full-sync'), delaySeconds: 0 });
    await jobWorker({ body: { jobId: 42 } });
    expect(repo.saveJob).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), 'done', expect.any(String));
    const meta = settings.saveSyncMeta.mock.calls[0][1];
    expect(meta).toMatchObject({ lastSyncId: 5, lastSyncStartedAt: 1000 });
    expect(meta.lastFullSyncAt).toBe(meta.lastSyncedAt);
  });

  it('a finished incremental sync keeps the previous lastFullSyncAt', async () => {
    repo.getJob.mockResolvedValue(job('incremental-sync'));
    settings.getSyncMeta.mockResolvedValue({ lastFullSyncAt: 'old' });
    jobs.runSyncStep.mockResolvedValue({ status: 'done', job: job('incremental-sync'), delaySeconds: 0 });
    await jobWorker({ body: { jobId: 42 } });
    expect(settings.saveSyncMeta.mock.calls[0][1]).toMatchObject({ lastFullSyncAt: 'old', lastSyncId: 5 });
  });

  it('a waiting step is saved and re-enqueued with its delay', async () => {
    repo.getJob.mockResolvedValue(job('full-sync'));
    jobs.runSyncStep.mockResolvedValue({ status: 'waiting', job: job('full-sync'), delaySeconds: 60 });
    await jobWorker({ body: { jobId: 42 } });
    expect(repo.saveJob).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), 'waiting', expect.any(String));
    expect(queue.enqueueJob).toHaveBeenCalledWith(42, 60);
    expect(settings.saveSyncMeta).not.toHaveBeenCalled();
  });

  it('a thrown non-retryable error marks the job failed with the message', async () => {
    repo.getJob.mockResolvedValue(job('full-sync'));
    jobs.runSyncStep.mockRejectedValue(new Error('Jira search failed (400): bad jql'));
    await expect(jobWorker({ body: { jobId: 42 } })).rejects.toThrow('bad jql');
    expect(repo.saveJob).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), 'failed', expect.any(String), 'Jira search failed (400): bad jql');
    expect(queue.enqueueJob).not.toHaveBeenCalled();
  });

  it('a job that is already done or failed is ignored', async () => {
    repo.getJob.mockResolvedValue({ ...job('full-sync'), status: 'failed' });
    await jobWorker({ body: { jobId: 42 } });
    expect(jobs.runSyncStep).not.toHaveBeenCalled();
  });
});
