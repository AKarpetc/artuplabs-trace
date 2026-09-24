import { describe, it, expect } from 'vitest';
import { runSyncStep, toCacheRows, issueFields } from '../../src/core/jobs';
import { RateLimited } from '../../src/infra/jira';
import { memoryRepo } from '../fakes/memoryRepo';

const config = { requirementTypeIds: ['10'], verificationTypeIds: ['20'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

function req(id, summary, linked = true) {
  return {
    id,
    key: `REQ-${id}`,
    fields: {
      summary,
      description: null,
      status: { name: 'To Do' },
      issuetype: { id: '10' },
      updated: '2026-09-24T10:00:00.000+0000',
      issuelinks: linked ? [{ id: `L${id}`, type: { id: '1', name: 'Tests' }, inwardIssue: { id: `T${id}`, key: `QA-${id}`, fields: { issuetype: { id: '20' }, status: { name: 'Passed' } } } }] : [],
    },
  };
}

function fakeJira(pages) {
  let call = 0;
  return {
    calls: () => call,
    async searchPage() {
      const page = pages[call++];
      if (page instanceof Error) {
        throw page;
      }
      return { issues: page.issues, nextPageToken: page.next ?? null, points: 1 + page.issues.length };
    },
  };
}

function budgetStore() {
  let state;
  return { get: async () => state, save: async (s) => { state = s; } };
}

function deps(jira, repo, overrides = {}) {
  let t = 1_000_000;
  return { jira, repo, config, now: () => (t += 10), budget: budgetStore(), deadlineMs: 10_000_000, ...overrides };
}

async function newJob(repo, kind = 'full-sync', extra = {}) {
  const state = { syncId: 7, jql: 'project = 1', nextPageToken: null, pages: 0, reanchor: false, ...extra };
  const id = await repo.createJob(kind, '1', state);
  return repo.getJob(id);
}

describe('issueFields', () => {
  it('always includes structural fields and dedupes', () => {
    expect(issueFields(config)).toEqual(['summary', 'status', 'issuetype', 'issuelinks', 'updated', 'description']);
  });
});

describe('toCacheRows', () => {
  it('marks covered requirement and hashes links', () => {
    const { req: row, links } = toCacheRows(req('1', 'A'), config, 7, '1');
    expect(row).toMatchObject({ issueId: '1', issueKey: 'REQ-1', projectId: '1', covered: 1, seenSyncId: 7, statusName: 'To Do' });
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(links).toHaveLength(1);
  });
});

describe('runSyncStep', () => {
  it('syncs all pages then deletes unseen requirements', async () => {
    const repo = memoryRepo();
    await repo.upsertRequirements([{ issueId: 'old', projectId: '1', seenSyncId: 1, fingerprint: 'x' }]);
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, { issues: [req('2', 'B', false)] }]);
    const job = await newJob(repo);
    const result = await runSyncStep(job, deps(jira, repo));
    expect(result.status).toBe('done');
    expect([...repo.reqs.keys()].sort()).toEqual(['1', '2']);
    expect(repo.reqs.get('2').covered).toBe(0);
    expect(repo.links.get('L1')).toMatchObject({ suspect: 0 });
  });

  it('a changed summary makes existing links suspect; unchanged links stay clean', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A'), req('2', 'B')] }]), repo));
    await runSyncStep(await newJob(repo, 'full-sync', { syncId: 8 }), deps(fakeJira([{ issues: [req('1', 'A changed'), req('2', 'B')] }]), repo));
    expect(repo.links.get('L1').suspect).toBe(1);
    expect(repo.links.get('L2').suspect).toBe(0);
  });

  it('re-anchor on config change clears suspicion instead of flagging everything', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A')] }]), repo));
    const summaryOnly = { ...config, fingerprintFieldIds: ['summary'] };
    const job = await newJob(repo, 'full-sync', { syncId: 8, reanchor: true });
    await runSyncStep(job, deps(fakeJira([{ issues: [req('1', 'A')] }]), repo, { config: summaryOnly }));
    expect(repo.links.get('L1').suspect).toBe(0);
    expect(repo.links.get('L1').confirmedFingerprint).toBe(repo.reqs.get('1').fingerprint);
  });

  it('429 mid-sync re-enqueues from checkpoint', async () => {
    const repo = memoryRepo();
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, new RateLimited(30)]);
    const job = await newJob(repo);
    const first = await runSyncStep(job, deps(jira, repo));
    expect(first).toMatchObject({ status: 'waiting', delaySeconds: 30 });
    expect(first.job.state.nextPageToken).toBe('p2');
    expect(repo.reqs.has('1')).toBe(true);

    const resumed = await runSyncStep(first.job, deps(fakeJira([{ issues: [req('2', 'B')] }]), repo));
    expect(resumed.status).toBe('done');
    expect([...repo.reqs.keys()].sort()).toEqual(['1', '2']);
  });

  it('does not delete unseen rows when a full sync stops early', async () => {
    const repo = memoryRepo();
    await repo.upsertRequirements([{ issueId: 'old', projectId: '1', seenSyncId: 1, fingerprint: 'x' }]);
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, new RateLimited(30)]);
    await runSyncStep(await newJob(repo), deps(jira, repo));
    expect(repo.reqs.has('old')).toBe(true);
  });

  it('waits when the points budget is exhausted without calling Jira', async () => {
    const repo = memoryRepo();
    const jira = fakeJira([{ issues: [req('1', 'A')] }]);
    const budget = { get: async () => ({ windowStart: 1_000_000, used: 5000 }), save: async () => {} };
    const result = await runSyncStep(await newJob(repo), deps(jira, repo, { budget, now: () => 1_000_100 }));
    expect(result.status).toBe('waiting');
    expect(result.delaySeconds).toBeGreaterThan(0);
    expect(jira.calls()).toBe(0);
  });

  it('stops at the deadline and continues later', async () => {
    const repo = memoryRepo();
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, { issues: [req('2', 'B')] }]);
    let t = 0;
    const result = await runSyncStep(await newJob(repo), deps(jira, repo, { now: () => (t += 1000), deadlineMs: 1500 }));
    expect(result).toMatchObject({ status: 'running', delaySeconds: 0 });
    expect(result.job.state.nextPageToken).toBe('p2');
  });

  it('incremental sync removes issues that stopped being requirements and never deletes unseen', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A'), req('2', 'B')] }]), repo));
    const retyped = req('2', 'B');
    retyped.fields.issuetype.id = '99';
    await runSyncStep(await newJob(repo, 'incremental-sync', { syncId: 9 }), deps(fakeJira([{ issues: [retyped] }]), repo));
    expect([...repo.reqs.keys()]).toEqual(['1']);
  });
});
