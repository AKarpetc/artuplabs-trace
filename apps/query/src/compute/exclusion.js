import { sortIds } from '../core/ids.js';
import { quote } from '../core/jql-build.js';
import { EXCLUDED_IDS_MAX, EXCLUSION_PROJECTS_TTL_MS, VALUE_LIMIT } from '../core/limits.js';

const chunks = (list) => Array.from({ length: Math.ceil(list.length / VALUE_LIMIT) }, (_, i) => list.slice(i * VALUE_LIMIT, (i + 1) * VALUE_LIMIT));

/**
 * Leaves the issues of excluded projects out of a set the app computes (from its index, its own searches or its field evaluation), with
 * searches the app runs; the JQL handed back to Jira never names a project, because Jira rejects a project the searching user cannot browse
 * or that no longer exists. An id result loses those ids; a parent result gets `id not in (…)` in its root filter, or becomes the matching
 * ids when more children are excluded than one clause may list. A native answer is Jira's own JQL and is returned unfiltered, so it stays
 * fresh and unbounded. Keys Jira no longer knows are ignored; the project list is read at most once a minute.
 */
export function createExclusion({ jira, state, now }) {
  let known = null;

  async function excludedKeys() {
    const stored = await state.excluded();
    if (!stored.length) return [];
    const list = stored.join(',');
    if (!known || known.list !== list || now() - known.at >= EXCLUSION_PROJECTS_TTL_MS) {
      const keys = new Set((await jira.projects()).map((p) => p.key));
      known = { list, at: now(), keys: stored.filter((k) => keys.has(k)) };
    }
    return known.keys;
  }

  async function searchAll(jqls) {
    const out = [];
    for (const jql of jqls) out.push(...(await jira.searchIds(jql)).map(String));
    return sortIds(out);
  }

  async function excludedChildren(bases, inExcluded) {
    const removed = [];
    for (const base of bases) {
      const page = await jira.searchPage(`${base} AND ${inExcluded}`, null);
      removed.push(...page.ids.map(String));
      if (page.nextPageToken || removed.length > EXCLUDED_IDS_MAX) return null;
    }
    return sortIds(removed);
  }

  return async function exclude(result) {
    if (result.error || result.native !== undefined) return result;
    const keys = await excludedKeys();
    if (!keys.length) return result;
    const list = keys.map(quote).join(', ');
    const inExcluded = `project in (${list})`;
    if (result.field === 'id') {
      const removed = new Set(await searchAll(chunks(result.ids).map((part) => `id in (${part.join(',')}) AND ${inExcluded}`)));
      return removed.size ? { ...result, ids: result.ids.filter((id) => !removed.has(String(id))) } : result;
    }
    const filter = result.rootFilter ? `(${result.rootFilter}) AND ` : '';
    const bases = chunks(result.ids).map((part) => `${filter}parent in (${part.join(',')})`);
    const removed = await excludedChildren(bases, inExcluded);
    if (removed && !removed.length) return result;
    if (removed) return { ...result, rootFilter: `${filter}id not in (${removed.join(',')})` };
    return { ids: await searchAll(bases.map((base) => `${base} AND project not in (${list})`)), field: 'id', watch: result.watch ?? null };
  };
}
