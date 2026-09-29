import { kvs } from '@forge/kvs';
import { normalizeConfig } from '../core/config';

/** Project config with defaults applied. */
export async function getConfig(projectId) {
  return normalizeConfig(await kvs.get(`config:${projectId}`));
}

/** Persists a normalized project config. */
export async function saveConfig(projectId, config) {
  await kvs.set(`config:${projectId}`, config);
}

/** Installation-wide Jira points budget state. */
export async function getBudget() {
  return kvs.get('budget');
}

/** Saves the Jira points budget state. */
export async function saveBudget(state) {
  await kvs.set('budget', state);
}

/** Last successful sync info for a project. */
export async function getSyncMeta(projectId) {
  return kvs.get(`sync:${projectId}`);
}

/** Saves last successful sync info for a project. */
export async function saveSyncMeta(projectId, meta) {
  await kvs.set(`sync:${projectId}`, meta);
}
