import { kvs } from '@forge/kvs';
import { isConfigured } from '../core/config';
import { needsFullSync } from '../core/jobs';
import * as settings from '../infra/settings';
import { startSync } from './worker';

/** Hourly: incremental sync for every configured project; weekly full sync; one project's failure never stops the rest (R15). */
export async function reconcile() {
  const projects = (await kvs.get('projects')) ?? [];
  for (const projectId of projects) {
    try {
      const config = await settings.getConfig(projectId);
      if (!isConfigured(config)) {
        continue;
      }
      const meta = await settings.getSyncMeta(projectId);
      const full = needsFullSync(meta, Date.now());
      await startSync(projectId, { full });
    } catch (error) {
      console.error(`reconcile failed for project ${projectId}: ${error.message ?? error}`);
    }
  }
}
