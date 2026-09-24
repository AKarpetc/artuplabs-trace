import * as repo from '../infra/repo';
import * as settings from '../infra/settings';
import { createJira, asAppRequest } from '../infra/jira';
import { enqueueJob } from '../infra/queue';
import { runSyncStep, activeJob, shouldReuse, incrementalWindowMinutes } from '../core/jobs';
import { isConfigured } from '../core/config';
import { runMigrations } from '../infra/schema';

const DEADLINE_MS = 700 * 1000;
const ACTIVE_JOB_MAX_AGE_MS = 30 * 60 * 1000;

function jqlFor(projectId, config, full, windowMinutes) {
  const types = config.requirementTypeIds.join(',');
  if (full || !windowMinutes) {
    return `project = ${projectId} AND issuetype in (${types}) ORDER BY id ASC`;
  }
  return `project = ${projectId} AND updated >= -${windowMinutes}m ORDER BY id ASC`;
}

/** Creates a sync job for a project and enqueues its first step; reuses an already-active job when it covers the request (R11, R14). */
export async function startSync(projectIdInput, { full, reanchor = false }) {
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
  await enqueueJob(id);
  return id;
}

/** Async consumer: runs one bounded step of a job and re-enqueues until done. */
export async function jobWorker(event) {
  await runMigrations();
  const job = await repo.getJob(event.body.jobId);
  if (!job || job.status === 'done' || job.status === 'failed') {
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
