import { runMigrations } from '../infra/schema';
import * as settings from '../infra/settings';
import * as repo from '../infra/repo';
import { isConfigured } from '../core/config';
import { classifyEvent, applyIssueDeletion, projectsForLinkEvent } from '../core/events';
import { startSync } from './worker';

/** Runs SQL migrations when the app is installed or upgraded. */
export async function onLifecycle() {
  const applied = await runMigrations();
  console.log(`migrations applied: ${applied.length}`);
}

/** Schedules an incremental sync for a project when it is configured. */
async function syncIfConfigured(projectId) {
  const config = await settings.getConfig(projectId);
  if (isConfigured(config)) {
    await startSync(projectId, { full: false });
  }
}

/**
 * Issue deletions are applied to the cache immediately. Link events sync every project with a cached requirement on
 * either side (the payload has no issue project). Other issue events sync the issue's project when it is configured.
 */
export async function onIssueEvent(event) {
  const info = classifyEvent(event);
  if (info.kind === 'issue-deleted') {
    await applyIssueDeletion(info.issueIds, { repo, getConfig: settings.getConfig });
    return;
  }
  const projects = info.kind === 'link' ? await projectsForLinkEvent(info, repo) : [info.projectId].filter(Boolean);
  for (const projectId of projects) {
    await syncIfConfigured(String(projectId));
  }
}
