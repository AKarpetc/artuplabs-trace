import { describe, it, expect } from 'vitest';
import { classifyEvent, applyIssueDeletion, projectsForLinkEvent } from '../../src/core/events';
import { memoryRepo } from '../fakes/memoryRepo';

const config = { requirementTypeIds: ['10'], verificationTypeIds: ['20'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

describe('classifyEvent', () => {
  it('reads project and issue id from an issue event (payload observed on the dev site)', () => {
    const event = { eventType: 'avi:jira:updated:issue', issue: { id: '10015', key: 'TRC-6', fields: { project: { id: '10001' } } } };
    expect(classifyEvent(event)).toEqual({ kind: 'issue', projectId: '10001', issueIds: ['10015'] });
  });

  it('reads both issue ids from a link event (top-level sourceIssueId/destinationIssueId, observed on the dev site)', () => {
    const event = { eventType: 'avi:jira:created:issuelink', id: '10001', sourceIssueId: '10015', destinationIssueId: '10016', sourceProjectId: '10001' };
    expect(classifyEvent(event)).toEqual({ kind: 'link', projectId: null, issueIds: ['10015', '10016'] });
  });

  it('classifies a deleted issue from event.issue.id or, failing that, event.id', () => {
    expect(classifyEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '7', fields: { project: { id: '1' } } } })).toEqual({ kind: 'issue-deleted', projectId: '1', issueIds: ['7'] });
    expect(classifyEvent({ eventType: 'avi:jira:deleted:issue', id: '8' })).toEqual({ kind: 'issue-deleted', projectId: null, issueIds: ['8'] });
  });

  it('drops ids that are not Jira ids', () => {
    expect(classifyEvent({ eventType: 'avi:jira:deleted:issuelink', sourceIssueId: 'x', destinationIssueId: '5' }).issueIds).toEqual(['5']);
    expect(classifyEvent({ eventType: 'avi:jira:updated:issue', issue: { id: '1', fields: { project: { id: 'p' } } } }).projectId).toBeNull();
  });
});

async function seed(repo) {
  await repo.upsertRequirements([{ issueId: '1', projectId: 'P', covered: 1, fingerprint: 'f1', seenSyncId: 1 }, { issueId: '2', projectId: 'P', covered: 1, fingerprint: 'f2', seenSyncId: 1 }]);
  await repo.replaceLinks(['1', '2'], [
    { linkId: 'L1', projectId: 'P', reqIssueId: '1', otherIssueId: '100', otherKey: 'QA-1', otherTypeId: '20', otherStatus: 'Open', linkTypeId: '3' },
    { linkId: 'L2', projectId: 'P', reqIssueId: '2', otherIssueId: '100', otherKey: 'QA-1', otherTypeId: '20', otherStatus: 'Open', linkTypeId: '3' },
    { linkId: 'L3', projectId: 'P', reqIssueId: '2', otherIssueId: '101', otherKey: 'QA-2', otherTypeId: '20', otherStatus: 'Open', linkTypeId: '3' },
  ], { 1: 'f1', 2: 'f2' });
}

describe('applyIssueDeletion', () => {
  it('a deleted verification issue removes its links and uncovers a requirement left without verification', async () => {
    const repo = memoryRepo();
    await seed(repo);
    await applyIssueDeletion(['100'], { repo, getConfig: async () => config });
    expect(repo.links.has('L1')).toBe(false);
    expect(repo.links.has('L2')).toBe(false);
    expect(repo.reqs.get('1').covered).toBe(0);
    expect(repo.reqs.get('2').covered).toBe(1);
  });

  it('a deleted requirement is removed with its links', async () => {
    const repo = memoryRepo();
    await seed(repo);
    await applyIssueDeletion(['2'], { repo, getConfig: async () => config });
    expect(repo.reqs.has('2')).toBe(false);
    expect(repo.links.has('L3')).toBe(false);
    expect(repo.reqs.get('1').covered).toBe(1);
  });

  it('does not recompute coverage of a project that is no longer configured', async () => {
    const repo = memoryRepo();
    await seed(repo);
    await applyIssueDeletion(['100'], { repo, getConfig: async () => ({ ...config, requirementTypeIds: [] }) });
    expect(repo.reqs.get('1').covered).toBe(1);
  });
});

describe('projectsForLinkEvent', () => {
  it('resolves projects by cached requirement ids on either side and ignores unknown issues', async () => {
    const repo = memoryRepo();
    await seed(repo);
    expect(await projectsForLinkEvent({ kind: 'link', issueIds: ['100', '2'] }, repo)).toEqual(['P']);
    expect(await projectsForLinkEvent({ kind: 'link', issueIds: ['100', '999'] }, repo)).toEqual([]);
  });
});
