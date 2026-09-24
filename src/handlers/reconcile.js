import { kvs } from '@forge/kvs';
import { isConfigured } from '../core/config';
import * as settings from '../infra/settings';
import { startSync } from './worker';

/** Hourly: incremental sync for every configured project; weekly full sync. */
export async function reconcile() {
  const projects = (await kvs.get('projects')) ?? [];
  const weekMs = 7 * 24 * 3600 * 1000;
  for (const projectId of projects) {
    const config = await settings.getConfig(projectId);
    if (!isConfigured(config)) {
      continue;
    }
    const meta = await settings.getSyncMeta(projectId);
    const full = !meta || Date.now() - Date.parse(meta.lastSyncedAt) > weekMs;
    await startSync(projectId, { full });
  }
}
