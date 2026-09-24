import { runMigrations } from '../infra/schema';
import * as settings from '../infra/settings';
import { isConfigured } from '../core/config';
import { startSync } from './worker';

/** Runs SQL migrations when the app is installed or upgraded. */
export async function onLifecycle() {
  const applied = await runMigrations();
  console.log(`migrations applied: ${applied.length}`);
}

/** Any issue or link change in a configured project schedules an incremental sync for it. */
export async function onIssueEvent(event) {
  const projectId = event.issue?.fields?.project?.id ?? event.sourceProjectId ?? event.projectId;
  if (!projectId) {
    return;
  }
  const config = await settings.getConfig(String(projectId));
  if (!isConfigured(config)) {
    return;
  }
  await startSync(String(projectId), { full: false });
}
