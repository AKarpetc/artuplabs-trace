import * as repo from '../infra/repo';
import * as settings from '../infra/settings';
import { createJira, asAppRequest } from '../infra/jira';
import { enqueueJob } from '../infra/queue';
import { runSyncStep, activeJob } from '../core/jobs';
import { isConfigured } from '../core/config';
import { runMigrations } from '../infra/schema';

const DEADLINE_MS = 700 * 1000;
const ACTIVE_JOB_MAX_AGE_MS = 30 * 60 * 1000;

function jqlFor(projectId, config, full, watermark) {
  const types = config.requirementTypeIds.join(',');
  if (full || !watermark) {
    return `project = ${projectId} AND issuetype in (${types}) ORDER BY id ASC`;
  }
  return `project = ${projectId} AND updated >= "${watermark}" ORDER BY id ASC`;
}

/** Jira JQL date for a watermark 10 minutes before the given time (covers event delays). */
export function watermarkFor(nowMs) {
  const d = new Date(nowMs - 10 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Creates a sync job for a project and enqueues its first step; reuses an already-active job (R11). */
export async function startSync(projectIdInput, { full, reanchor = false }) {
  const projectId = String(projectIdInput);
  const [latestFull, latestIncremental] = await Promise.all([
    repo.latestJob(projectId, 'full-sync'),
    repo.latestJob(projectId, 'incremental-sync'),
  ]);
  const active = activeJob([latestFull, latestIncremental], Date.now(), ACTIVE_JOB_MAX_AGE_MS);
  if (active) {
    return active.id;
  }
  const config = await settings.getConfig(projectId);
  const meta = await settings.getSyncMeta(projectId);
  const syncId = Date.now();
  const kind = full || !meta ? 'full-sync' : 'incremental-sync';
  const state = { syncId, jql: jqlFor(projectId, config, kind === 'full-sync', meta?.watermark), nextPageToken: null, pages: 0, reanchor, startedAt: Date.now() };
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
      await settings.saveSyncMeta(job.projectId, { lastSyncId: job.state.syncId, lastSyncedAt: nowIso, watermark: watermarkFor(job.state.startedAt) });
      return;
    }
    await repo.saveJob(result.job, result.status, nowIso);
    await enqueueJob(job.id, result.delaySeconds);
  } catch (error) {
    await repo.saveJob(job, 'failed', new Date().toISOString(), String(error.message ?? error));
    throw error;
  }
}
