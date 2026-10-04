import { decideLicence } from '../access.js';
import { EXCLUDED_KIND } from '../core/affected.js';
import { CODE } from '../core/errors.js';
import { EXCLUDED_MAX } from '../core/limits.js';
import { backfillProjects, startBackfill } from './backfill.js';
import { pushRefresh } from './refresh.js';

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,99}$/;
const fail = (code) => {
  throw new Error(code);
};
const validKeys = (keys) => Array.isArray(keys) && keys.length <= EXCLUDED_MAX && keys.every((k) => typeof k === 'string' && PROJECT_KEY.test(k));

/**
 * Admin page actions: exclusion, project reindex and full reset; Jira administrators only. A change of the excluded projects deletes their
 * index rows, fills returning ones again and then, on every save so a retried one repairs a failed one, rewrites every stored root, which
 * carries the list.
 */
export function createAdminActions(deps) {
  const tablesOf = (part) => deps.indexParts[part].tables;

  async function guard(context) {
    if (!decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed) fail(CODE.unlicensed);
    if (!(await deps.isAdmin(context))) fail(CODE.forbidden);
  }

  async function fillRunning() {
    for (const part of deps.shippedParts()) {
      const p = await deps.state.progress.getPart(part);
      if (p && !p.finishedAt) return true;
    }
    return false;
  }

  async function rewriteRoots() {
    await deps.journal.append({ ids: [], kinds: [EXCLUDED_KIND] }, deps.now());
    await pushRefresh(deps, deps.now());
  }

  return {
    async adminStatus(payload, context) {
      await guard(context);
      return { excluded: await deps.state.excluded(), progress: await deps.state.progress.get(), parts: deps.shippedParts() };
    },
    async setExcluded({ projectKeys } = {}, context) {
      await guard(context);
      if (!validKeys(projectKeys)) fail(CODE.badRequest);
      const before = new Set(await deps.state.excluded());
      await deps.state.setExcluded(projectKeys);
      const after = await deps.state.excluded();
      const projects = await deps.jira.projects();
      for (const project of projects.filter((p) => after.includes(p.key) && !before.has(p.key))) {
        for (const part of deps.shippedParts()) await deps.repo.deleteProject(project.id, tablesOf(part));
      }
      const returned = projects.filter((p) => before.has(p.key) && !after.includes(p.key));
      if (returned.length) {
        for (const part of deps.shippedParts()) await backfillProjects(deps, part, returned);
      }
      await rewriteRoots();
      return { excluded: after };
    },
    async reindexProject({ projectKey } = {}, context) {
      await guard(context);
      if (!PROJECT_KEY.test(String(projectKey)) || (await deps.state.excluded()).includes(projectKey)) fail(CODE.badRequest);
      if (await fillRunning()) fail(CODE.busy);
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
