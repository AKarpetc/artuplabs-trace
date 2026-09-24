import * as repo from '../infra/repo';
import * as settings from '../infra/settings';
import * as baselineRepo from '../infra/baselineRepo';
import { createJira, asAppRequest } from '../infra/jira';
import { enqueueJob } from '../infra/queue';
import {
  runSyncStep, activeJob, shouldReuse, incrementalWindowMinutes, shouldKeepWaiting, jqlFor,
} from '../core/jobs';
import { isConfigured } from '../core/config';
import { runMigrations } from '../infra/schema';

const DEADLINE_MS = 700 * 1000;
const ACTIVE_JOB_MAX_AGE_MS = 30 * 60 * 1000;

/** Creates a sync job for a project and enqueues its first step after delaySeconds; reuses an already-active job when it covers the request (R11, R14). */
export async function startSync(projectIdInput, { full, reanchor = false, delaySeconds = 0 }) {
  const projectId = String(projectIdInput);
  const [latestFull, latestIncremental] = await Promise.all([
    repo.latestJob(projectId, 'full-sync'),
    repo.latestJob(projectId, 'incremental-sync'),
  ]);
  const active = activeJob([latestFull, latestIncremental], Date.now(), ACTIVE_JOB_MAX_AGE_MS);
  if (shouldReuse(active, { full, reanchor })) {
    return active.id;
  }
  const config = await settings.getConfig(projectId);
  const meta = await settings.getSyncMeta(projectId);
  const isFull = full || !meta?.lastSyncStartedAt;
  const kind = isFull ? 'full-sync' : 'incremental-sync';
  const windowMinutes = isFull ? null : incrementalWindowMinutes(meta.lastSyncStartedAt, Date.now());
  const state = { syncId: Date.now(), jql: jqlFor(projectId, config, isFull, windowMinutes), nextPageToken: null, pages: 0, reanchor, startedAt: Date.now() };
  const id = await repo.createJob(kind, projectId, state, new Date().toISOString());
  await enqueueJob(id, delaySeconds);
  return id;
}

/** Creates a baseline after an incremental sync and enqueues its capture; starts the sync first so a failure there leaves no orphaned capturing baseline (R19). */
export async function startBaseline(projectId, name, accountId) {
  const syncJobId = await startSync(String(projectId), { full: false });
  const baselineId = await baselineRepo.createBaseline({ projectId: String(projectId), name, createdBy: accountId, nowIso: new Date().toISOString() });
  const id = await repo.createJob('baseline', String(projectId), { baselineId, afterIssueId: '', waitForJobId: syncJobId }, new Date().toISOString());
  await enqueueJob(id, 30);
  return baselineId;
}

async function runBaselineStep(job) {
  const sync = await repo.getJob(job.state.waitForJobId);
  const nowMs = Date.now();
  const waitStartedAt = job.state.waitStartedAt ?? nowMs;
  if (shouldKeepWaiting(sync, waitStartedAt, nowMs)) {
    await repo.saveJob({ ...job, state: { ...job.state, waitStartedAt } }, 'waiting', new Date().toISOString());
    await enqueueJob(job.id, 60);
    return;
  }
  const started = Date.now();
  let state = { ...job.state };
  while (Date.now() - started < DEADLINE_MS) {
    const batch = await baselineRepo.snapshotBatch(state.baselineId, job.projectId, state.afterIssueId, 500);
    if (!batch.lastIssueId) {
      await baselineRepo.completeBaseline(state.baselineId);
      await repo.saveJob({ ...job, state }, 'done', new Date().toISOString());
      return;
    }
    state = { ...state, afterIssueId: batch.lastIssueId };
  }
  await repo.saveJob({ ...job, state }, 'running', new Date().toISOString());
  await enqueueJob(job.id);
}

/** Async consumer: runs one bounded step of a job and re-enqueues until done. */
export async function jobWorker(event) {
  await runMigrations();
  const job = await repo.getJob(event.body.jobId);
  if (!job || job.status === 'done' || job.status === 'failed') {
    return;
  }
  if (job.kind === 'baseline') {
    try {
      await runBaselineStep(job);
    } catch (error) {
      await baselineRepo.failBaseline(job.state.baselineId, error.message ?? error);
      await repo.saveJob(job, 'failed', new Date().toISOString(), String(error.message ?? error));
    }
    return;
  }
  const config = await settings.getConfig(job.projectId);
  if (!isConfigured(config)) {
    await repo.saveJob(job, 'failed', new Date().toISOString(), 'Project is not configured.');
    return;
  }
  const deps = {
    jira: createJira(asAppRequest),
    repo,
    config,
    now: () => Date.now(),
    budget: { get: settings.getBudget, save: settings.saveBudget },
    deadlineMs: DEADLINE_MS,
  };
  try {
    const result = await runSyncStep(job, deps);
    const nowIso = new Date().toISOString();
    if (result.status === 'done') {
      await repo.saveJob(result.job, 'done', nowIso);
      const previousMeta = await settings.getSyncMeta(job.projectId);
      const meta = {
        ...previousMeta,
        lastSyncId: job.state.syncId,
        lastSyncedAt: nowIso,
        lastSyncStartedAt: job.state.startedAt,
      };
      if (job.kind === 'full-sync') {
        meta.lastFullSyncAt = nowIso;
      }
      await settings.saveSyncMeta(job.projectId, meta);
      return;
    }
    await repo.saveJob(result.job, result.status, nowIso);
    await enqueueJob(job.id, result.delaySeconds);
  } catch (error) {
    await repo.saveJob(job, 'failed', new Date().toISOString(), String(error.message ?? error));
    throw error;
  }
}
