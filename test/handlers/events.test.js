import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ repo: null }));

vi.mock('../../src/infra/schema', () => ({ runMigrations: vi.fn(async () => []) }));
vi.mock('../../src/infra/settings', () => ({ getConfig: vi.fn() }));
vi.mock('../../src/infra/repo', () => Object.fromEntries(['deleteRequirements', 'deleteLinksToIssue', 'recomputeCovered', 'projectsOfIssues']
  .map((name) => [name, (...args) => h.repo[name](...args)])));
vi.mock('../../src/handlers/worker', () => ({ startSync: vi.fn(async () => 1) }));

const { memoryRepo } = await import('../fakes/memoryRepo');
const { onIssueEvent } = await import('../../src/handlers/events');
const settings = await import('../../src/infra/settings');
const worker = await import('../../src/handlers/worker');

const config = { requirementTypeIds: ['10'], verificationTypeIds: ['20'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

beforeEach(async () => {
  vi.clearAllMocks();
  h.repo = memoryRepo();
  settings.getConfig.mockImplementation(async (projectId) => (projectId === '10001' ? config : { ...config, requirementTypeIds: [] }));
  await h.repo.upsertRequirements([{ issueId: '10015', projectId: '10001', covered: 1, fingerprint: 'f', seenSyncId: 1 }]);
  await h.repo.replaceLinks(['10015'], [{ linkId: '9', projectId: '10001', reqIssueId: '10015', otherIssueId: '10016', otherKey: 'TRC-7', otherTypeId: '20', otherStatus: 'Open', linkTypeId: '3' }], { 10015: 'f' });
});

describe('onIssueEvent', () => {
  it('an issue event syncs the configured project of the issue', async () => {
    await onIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { id: '10015', fields: { project: { id: '10001' } } } });
    expect(worker.startSync).toHaveBeenCalledWith('10001', expect.objectContaining({ full: false }));
  });

  it('an issue event of an unconfigured project does nothing', async () => {
    await onIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { id: '5', fields: { project: { id: '10002' } } } });
    expect(worker.startSync).not.toHaveBeenCalled();
  });

  it('a link event syncs the project of the cached requirement on either side', async () => {
    await onIssueEvent({ eventType: 'avi:jira:deleted:issuelink', id: '9', sourceIssueId: '10016', destinationIssueId: '10015' });
    expect(worker.startSync).toHaveBeenCalledWith('10001', expect.objectContaining({ full: false }));
  });

  it('a link event between issues that are not cached requirements is ignored', async () => {
    await onIssueEvent({ eventType: 'avi:jira:created:issuelink', id: '10', sourceIssueId: '1', destinationIssueId: '2' });
    expect(worker.startSync).not.toHaveBeenCalled();
  });

  it('a deleted verification issue uncovers the requirement at once, without a sync', async () => {
    await onIssueEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '10016', fields: { project: { id: '10001' } } } });
    expect(h.repo.links.has('9')).toBe(false);
    expect(h.repo.reqs.get('10015').covered).toBe(0);
    expect(worker.startSync).not.toHaveBeenCalled();
  });
});
