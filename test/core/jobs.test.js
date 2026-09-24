import { describe, it, expect } from 'vitest';
import {
  runSyncStep, toCacheRows, issueFields, activeJob, shouldReuse, needsFullSync, incrementalWindowMinutes,
} from '../../src/core/jobs';
import { RateLimited } from '../../src/infra/jira';
import { memoryRepo } from '../fakes/memoryRepo';

const config = { requirementTypeIds: ['10'], verificationTypeIds: ['20'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

function req(id, summary, linked = true, extraLinks = []) {
  return {
    id,
    key: `REQ-${id}`,
    fields: {
      summary,
      description: null,
      status: { name: 'To Do' },
      issuetype: { id: '10' },
      updated: '2026-09-24T10:00:00.000+0000',
      issuelinks: (linked ? [{ id: `L${id}`, type: { id: '1', name: 'Tests' }, inwardIssue: { id: `T${id}`, key: `QA-${id}`, fields: { issuetype: { id: '20' }, status: { name: 'Passed' } } } }] : []).concat(extraLinks),
    },
  };
}

function fakeJira(pages) {
  let call = 0;
  const argsReceived = [];
  return {
    calls: () => call,
    argsReceived,
    async searchPage(args) {
      argsReceived.push(args);
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

  it('stores extra fingerprint fields as bounded hashes that change with the value (R10)', () => {
    const bigConfig = { ...config, fingerprintFieldIds: ['summary', 'description', 'customfield_1'] };
    const bigValue = 'x'.repeat(10000);
    const issueA = req('1', 'A');
    issueA.fields.customfield_1 = bigValue;
    const { req: rowA } = toCacheRows(issueA, bigConfig, 7, '1');
    expect(rowA.fieldsJson.length).toBeLessThan(200);
    expect(rowA.fieldsJson).toMatch(/"customfield_1":"[0-9a-f]{64}"/);
    const issueB = req('1', 'A');
    issueB.fields.customfield_1 = `${bigValue}Z`;
    const { req: rowB } = toCacheRows(issueB, bigConfig, 7, '1');
    expect(rowB.fieldsJson).not.toBe(rowA.fieldsJson);
  });

  it('truncates summary by code points, never splitting a surrogate pair (R10)', () => {
    const longSummary = `${'a'.repeat(1023)}\u{1F600}${'b'.repeat(50)}`;
    const { req: row } = toCacheRows(req('1', longSummary), config, 7, '1');
    const lastCode = row.summary.charCodeAt(row.summary.length - 1);
    expect(lastCode < 0xD800 || lastCode > 0xDBFF).toBe(true);
    expect(Array.from(row.summary)).toHaveLength(1024);
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

    const resumeJira = fakeJira([{ issues: [req('2', 'B')] }]);
    const resumed = await runSyncStep(first.job, deps(resumeJira, repo));
    expect(resumed.status).toBe('done');
    expect([...repo.reqs.keys()].sort()).toEqual(['1', '2']);
    expect(resumeJira.argsReceived[0]).toMatchObject({ nextPageToken: 'p2' });
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

  it('drops requirement-to-requirement link rows; verification links are kept and stay clean (R8)', async () => {
    const repo = memoryRepo();
    const rr1to2 = { id: 'RR12', type: { id: '5', name: 'Relates' }, outwardIssue: { id: '2', key: 'REQ-2', fields: { issuetype: { id: '10' }, status: { name: 'To Do' } } } };
    const rr2to1 = { id: 'RR12', type: { id: '5', name: 'Relates' }, inwardIssue: { id: '1', key: 'REQ-1', fields: { issuetype: { id: '10' }, status: { name: 'To Do' } } } };
    const issue1 = req('1', 'A', true, [rr1to2]);
    const issue2 = req('2', 'B', true, [rr2to1]);
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [issue1, issue2] }]), repo));
    expect(repo.links.has('RR12')).toBe(false);
    expect(repo.links.get('L1')).toMatchObject({ suspect: 0, reqIssueId: '1' });
    expect(repo.links.get('L2')).toMatchObject({ suspect: 0, reqIssueId: '2' });
  });

  it('re-anchor only touches clean links; an already-suspect link stays suspect (R9)', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A'), req('2', 'B')] }]), repo));
    await runSyncStep(await newJob(repo, 'full-sync', { syncId: 8 }), deps(fakeJira([{ issues: [req('1', 'A changed'), req('2', 'B')] }]), repo));
    expect(repo.links.get('L1').suspect).toBe(1);
    expect(repo.links.get('L2').suspect).toBe(0);

    const summaryOnly = { ...config, fingerprintFieldIds: ['summary'] };
    const job = await newJob(repo, 'full-sync', { syncId: 9, reanchor: true });
    await runSyncStep(job, deps(fakeJira([{ issues: [req('1', 'A changed'), req('2', 'B')] }]), repo, { config: summaryOnly }));
    expect(repo.links.get('L1').suspect).toBe(1);
    expect(repo.links.get('L2').suspect).toBe(0);
    expect(repo.links.get('L2').confirmedFingerprint).toBe(repo.reqs.get('2').fingerprint);
  });

  it('an overlapping later sync is not undone when an earlier-started sync finishes its cleanup (R10)', async () => {
    const repo = memoryRepo();
    const jobA = await newJob(repo, 'full-sync', { syncId: 1 });
    const jobB = await newJob(repo, 'full-sync', { syncId: 2 });
    await runSyncStep(jobB, deps(fakeJira([{ issues: [req('1', 'A')] }]), repo));
    await runSyncStep(jobA, deps(fakeJira([{ issues: [req('2', 'B')] }]), repo));
    expect(repo.reqs.has('1')).toBe(true);
    expect(repo.reqs.has('2')).toBe(true);
  });
});

describe('activeJob', () => {
  const nowMs = 1_700_000_000_000;
  const maxAgeMs = 30 * 60 * 1000;
  const recentIso = new Date(nowMs - 1000).toISOString();
  const staleIso = new Date(nowMs - maxAgeMs - 1000).toISOString();

  it('returns a running job updated recently', () => {
    const job = { id: 1, status: 'running', updatedAt: recentIso };
    expect(activeJob([job], nowMs, maxAgeMs)).toBe(job);
  });

  it('returns a waiting job updated recently', () => {
    const job = { id: 2, status: 'waiting', updatedAt: recentIso };
    expect(activeJob([job], nowMs, maxAgeMs)).toBe(job);
  });

  it('ignores a running job older than the max age', () => {
    const job = { id: 3, status: 'running', updatedAt: staleIso };
    expect(activeJob([job], nowMs, maxAgeMs)).toBeNull();
  });

  it('ignores done and failed jobs regardless of age', () => {
    const done = { id: 4, status: 'done', updatedAt: recentIso };
    const failed = { id: 5, status: 'failed', updatedAt: recentIso };
    expect(activeJob([done, failed], nowMs, maxAgeMs)).toBeNull();
  });

  it('skips missing entries and returns the first active job found', () => {
    const job = { id: 6, status: 'waiting', updatedAt: recentIso };
    expect(activeJob([undefined, job], nowMs, maxAgeMs)).toBe(job);
  });

  it('returns null when no jobs are given', () => {
    expect(activeJob([], nowMs, maxAgeMs)).toBeNull();
  });
});

describe('shouldReuse', () => {
  it('an active full sync covers a plain incremental request', () => {
    const active = { kind: 'full-sync', state: { reanchor: false } };
    expect(shouldReuse(active, { full: false, reanchor: false })).toBe(true);
  });

  it('an active full sync without reanchor does not cover a reanchor request', () => {
    const active = { kind: 'full-sync', state: { reanchor: false } };
    expect(shouldReuse(active, { full: false, reanchor: true })).toBe(false);
  });

  it('an active full sync with reanchor covers a reanchor request', () => {
    const active = { kind: 'full-sync', state: { reanchor: true } };
    expect(shouldReuse(active, { full: false, reanchor: true })).toBe(true);
  });

  it('an active incremental sync does not cover a full request', () => {
    const active = { kind: 'incremental-sync', state: {} };
    expect(shouldReuse(active, { full: true, reanchor: false })).toBe(false);
  });

  it('an active incremental sync does not cover a reanchor request', () => {
    const active = { kind: 'incremental-sync', state: {} };
    expect(shouldReuse(active, { full: false, reanchor: true })).toBe(false);
  });

  it('an active incremental sync covers a plain incremental request', () => {
    const active = { kind: 'incremental-sync', state: {} };
    expect(shouldReuse(active, { full: false, reanchor: false })).toBe(true);
  });

  it('no active job is never reused', () => {
    expect(shouldReuse(null, { full: false, reanchor: false })).toBe(false);
  });
});

describe('needsFullSync', () => {
  const nowMs = 1_700_000_000_000;
  const dayMs = 24 * 3600 * 1000;

  it('is due when there is no sync meta yet', () => {
    expect(needsFullSync(undefined, nowMs)).toBe(true);
  });

  it('is due when the meta has a recent incremental sync but lastFullSyncAt is 8 days old', () => {
    const meta = { lastSyncedAt: new Date(nowMs - 1000).toISOString(), lastFullSyncAt: new Date(nowMs - 8 * dayMs).toISOString() };
    expect(needsFullSync(meta, nowMs)).toBe(true);
  });

  it('is not due when lastFullSyncAt is 1 day old', () => {
    const meta = { lastSyncedAt: new Date(nowMs - 1000).toISOString(), lastFullSyncAt: new Date(nowMs - dayMs).toISOString() };
    expect(needsFullSync(meta, nowMs)).toBe(false);
  });
});

describe('incrementalWindowMinutes', () => {
  const nowMs = 1_700_000_000_000;

  it('covers the elapsed time plus the 10-minute margin, exactly', () => {
    const lastSyncStartedAt = nowMs - 5 * 60 * 1000;
    expect(incrementalWindowMinutes(lastSyncStartedAt, nowMs)).toBe(15);
  });

  it('rounds up a partial minute', () => {
    const lastSyncStartedAt = nowMs - (5 * 60 * 1000 + 30 * 1000);
    expect(incrementalWindowMinutes(lastSyncStartedAt, nowMs)).toBe(16);
  });

  it('never returns less than 1 minute even when the sync just started', () => {
    expect(incrementalWindowMinutes(nowMs, nowMs)).toBe(10);
  });

  it('clamps to a minimum of 1 when the computed window would be zero or negative', () => {
    const lastSyncStartedAt = nowMs + 11 * 60 * 1000;
    expect(incrementalWindowMinutes(lastSyncStartedAt, nowMs)).toBe(1);
  });
});
