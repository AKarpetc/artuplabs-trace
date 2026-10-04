import { sortIds } from '../core/ids.js';
import { quote } from '../core/jql-build.js';
import { EXCLUDED_IDS_MAX, VALUE_LIMIT } from '../core/limits.js';

const chunks = (list) => Array.from({ length: Math.ceil(list.length / VALUE_LIMIT) }, (_, i) => list.slice(i * VALUE_LIMIT, (i + 1) * VALUE_LIMIT));

/**
 * Leaves the issues of excluded projects out of a computed result, with searches the app runs (the app sees every project); the JQL
 * handed back to Jira never names a project, because Jira rejects a project the searching user cannot browse or that no longer exists.
 * An id result loses those ids; a parent result and a native answer get `id not in (…)`, or become the matching ids when too many
 * issues would be listed. Keys Jira no longer knows are ignored.
 */
export function createExclusion({ jira, state }) {
  async function excludedKeys() {
    const stored = await state.excluded();
    if (!stored.length) return [];
    const known = new Set((await jira.projects()).map((p) => p.key));
    return stored.filter((k) => known.has(k));
  }

  async function searchAll(jqls) {
    const out = [];
    for (const jql of jqls) out.push(...(await jira.searchIds(jql)).map(String));
    return sortIds(out);
  }

  async function narrowed(base, inExcluded, notInExcluded) {
    const removed = await searchAll(base.map((jql) => `${jql} AND ${inExcluded}`));
    if (!removed.length) return null;
    if (removed.length <= EXCLUDED_IDS_MAX) return { removed };
    return { ids: await searchAll(base.map((jql) => `${jql} AND ${notInExcluded}`)) };
  }

  return async function exclude(result) {
    if (result.error) return result;
    const keys = await excludedKeys();
    if (!keys.length) return result;
    const list = keys.map(quote).join(', ');
    const inExcluded = `project in (${list})`;
    const notInExcluded = `project not in (${list})`;
    if (result.native !== undefined) {
      const out = await narrowed([`(${result.native})`], inExcluded, notInExcluded);
      if (!out) return result;
      if (out.removed) return { ...result, native: `(${result.native}) AND id not in (${out.removed.join(',')})` };
      return { ids: out.ids, field: 'id', watch: result.watch ?? null };
    }
    if (result.field === 'id') {
      const removed = new Set(await searchAll(chunks(result.ids).map((part) => `id in (${part.join(',')}) AND ${inExcluded}`)));
      return removed.size ? { ...result, ids: result.ids.filter((id) => !removed.has(String(id))) } : result;
    }
    const filter = result.rootFilter ? `(${result.rootFilter}) AND ` : '';
    const out = await narrowed(chunks(result.ids).map((part) => `${filter}parent in (${part.join(',')})`), inExcluded, notInExcluded);
    if (!out) return result;
    if (out.removed) return { ...result, rootFilter: `${filter}id not in (${out.removed.join(',')})` };
    return { ids: out.ids, field: 'id', watch: result.watch ?? null };
  };
}
