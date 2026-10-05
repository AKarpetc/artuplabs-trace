import { decideLicence } from '../access.js';
import { REWRITE_ALL_KIND } from '../core/affected.js';
import { CODE } from '../core/errors.js';
import { EXCLUDED_MAX, PROJECT_KEY_MAX_LENGTH } from '../core/limits.js';
import { fillWaiting, startBackfill } from './backfill.js';
import { pushRefresh } from './refresh.js';

const PROJECT_KEY = new RegExp(`^[A-Z][A-Z0-9_]{0,${PROJECT_KEY_MAX_LENGTH - 1}}$`);
const fail = (code) => {
  throw new Error(code);
};
const validKeys = (keys) => Array.isArray(keys) && keys.length <= EXCLUDED_MAX && keys.every((k) => typeof k === 'string' && PROJECT_KEY.test(k));

/**
 * Admin page actions: status (with the index rows of each table), exclusion, project reindex and full reset; Jira administrators only. A save of the excluded projects accepts only
 * keys Jira knows; right after storing the list it journals the rewrite of every stored root, then hands the deletion of the excluded
 * projects' index rows to a queue job and keeps returning projects for a fill. Every step after the save is idempotent, so a retried save
 * repairs a failed one, and the hourly gap filler starts kept fills too.
 */
export function createAdminActions(deps) {
  const tablesOf = (part) => deps.indexParts[part].tables;

  async function guard(context) {
    if (!decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed) fail(CODE.unlicensed);
    if (!(await deps.isAdmin(context))) fail(CODE.forbidden);
  }

  /** Rows and distinct issues of each index table, or null when Forge SQL cannot count them (logged without values). */
  async function indexRows(tables) {
    if (!tables.length) return {};
    try {
      return await deps.repo.counts(tables);
    } catch (error) {
      console.error(`index row count failed: ${error?.name}`);
      return null;
    }
  }

  async function notReady() {
    for (const part of deps.shippedParts()) {
      const p = await deps.state.progress.getPart(part);
      if (!p || !p.finishedAt) return true;
    }
    return false;
  }

  return {
    async adminStatus(payload, context) {
      await guard(context);
      const parts = deps.shippedParts();
      return { excluded: await deps.state.excluded(), progress: await deps.state.progress.get(), parts, rows: await indexRows(parts.flatMap(tablesOf)) };
    },
    async setExcluded({ projectKeys } = {}, context) {
      await guard(context);
      if (!validKeys(projectKeys)) fail(CODE.badRequest);
      const projects = await deps.jira.projects();
      const known = new Set(projects.map((p) => p.key));
      if (!projectKeys.every((k) => known.has(k))) fail(CODE.notFound);
      const before = new Set(await deps.state.excluded());
      await deps.state.setExcluded(projectKeys);
      const after = await deps.state.excluded();
      await deps.journal.append({ ids: [], kinds: [REWRITE_ALL_KIND] }, deps.now());
      await pushRefresh(deps, deps.now());
      const returned = projects.filter((p) => before.has(p.key) && !after.includes(p.key));
      if (returned.length) {
        for (const part of deps.shippedParts()) await deps.state.waiting.add(part, returned);
      }
      await deps.backfillQueue.push({ kind: 'purge' });
      for (const part of deps.shippedParts()) await fillWaiting(deps, part);
      return { excluded: after };
    },
    async reindexProject({ projectKey } = {}, context) {
      await guard(context);
      if (!PROJECT_KEY.test(String(projectKey)) || (await deps.state.excluded()).includes(projectKey)) fail(CODE.badRequest);
      if (await notReady()) fail(CODE.busy);
      const project = (await deps.jira.projects()).find((p) => p.key === projectKey) ?? fail(CODE.notFound);
      for (const part of deps.shippedParts()) {
        await deps.repo.deleteProject(project.id, tablesOf(part));
        await startBackfill(deps, part, { projects: [project] });
      }
      return { started: deps.shippedParts() };
    },
    async resetIndex(payload, context) {
      await guard(context);
      for (const part of deps.shippedParts()) {
        await deps.repo.clear(tablesOf(part));
        await deps.state.progress.clearPart(part);
        await deps.state.waiting.clear(part);
        await startBackfill(deps, part);
      }
      return { started: deps.shippedParts() };
    },
  };
}
