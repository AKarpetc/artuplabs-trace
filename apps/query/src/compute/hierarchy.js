import { MAX_DEPTH, VALUE_LIMIT } from '../core/limits.js';
import { descendantParents, epicOf, nodesFrom, parentIds, unresolvedParents } from '../core/hierarchy.js';
import { sortIds } from '../core/ids.js';

/** Root filter of subtasksOf. */
export const SUBTASK_FILTER = 'issuetype in subTaskIssueTypes()';

/**
 * Value sources of the hierarchy functions and hasSubtasks; watched ids are kept in id order, so a new issue changes only the last cache chunk.
 * A function that needs fields of the issues its search finds reads them within that search (a point per issue and per page), not by a second
 * bulkfetch of every id.
 */
export function createHierarchyCompute({ jira }) {
  const inner = (subquery, reconcile) => jira.searchIds(subquery, { reconcile });
  const innerWith = (subquery, reconcile, fields) => jira.searchIssues(subquery, fields, { reconcile });
  const idsOf = (issues) => issues.map((x) => String(x.id));

  async function loadNodes(issues) {
    const ids = idsOf(issues);
    const nodes = nodesFrom(issues);
    for (let round = 0; round < MAX_DEPTH; round += 1) {
      const missing = unresolvedParents(ids, nodes);
      if (!missing.length) break;
      nodesFrom(await jira.bulkIssues(missing, ['parent', 'issuetype']), nodes);
    }
    return nodes;
  }

  async function childrenOf(parents) {
    const map = new Map(parents.map((p) => [String(p), []]));
    for (let i = 0; i < parents.length; i += VALUE_LIMIT) {
      const kids = await jira.searchIssues(`parent in (${parents.slice(i, i + VALUE_LIMIT).join(',')})`, ['parent']);
      for (const kid of kids) map.get(String(kid.fields?.parent?.id))?.push(String(kid.id));
    }
    return map;
  }

  return {
    async subtasksOf({ subquery }, { reconcile }) {
      const issues = await innerWith(subquery, reconcile, ['subtasks']);
      const ids = idsOf(issues);
      const parents = ids.length > VALUE_LIMIT ? idsOf(issues.filter((x) => x.fields?.subtasks?.length)) : ids;
      return { ids: sortIds(parents), field: 'parent', rootFilter: SUBTASK_FILTER, watch: sortIds(ids) };
    },
    async parentsOf({ subquery }, { reconcile }) {
      const issues = await innerWith(subquery, reconcile, ['parent', 'issuetype']);
      const ids = idsOf(issues);
      return { ids: parentIds(ids, nodesFrom(issues)), field: 'id', watch: sortIds(ids) };
    },
    async epicsOf({ subquery }, { reconcile }) {
      const issues = await innerWith(subquery, reconcile, ['parent', 'issuetype']);
      const ids = idsOf(issues);
      const nodes = await loadNodes(issues);
      return { ids: sortIds(ids.map((id) => epicOf(id, nodes)).filter(Boolean)), field: 'id', watch: sortIds([...ids, ...nodes.keys()]) };
    },
    async issuesInEpics({ subquery }, { reconcile }) {
      const issues = await innerWith(subquery, reconcile, ['issuetype']);
      return { ids: sortIds(idsOf(issues.filter((x) => x.fields?.issuetype?.hierarchyLevel === 1))), field: 'parent', watch: sortIds(idsOf(issues)) };
    },
    async childIssuesOf({ subquery, depth }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const { parents, seen } = await descendantParents(ids, depth ?? MAX_DEPTH, childrenOf);
      return { ids: parents, field: 'parent', watch: seen };
    },
    async hasSubtasks() {
      const subtasks = await jira.searchIssues(SUBTASK_FILTER, ['parent']);
      return { ids: sortIds(subtasks.map((x) => x.fields?.parent?.id).filter(Boolean)), field: 'id', watch: null };
    },
  };
}
