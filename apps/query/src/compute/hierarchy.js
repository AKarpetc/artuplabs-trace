import { MAX_DEPTH, VALUE_LIMIT } from '../core/limits.js';
import { descendantParents, epicOf, nodesFrom, parentIds, unresolvedParents } from '../core/hierarchy.js';
import { sortIds } from '../core/ids.js';

/** Root filter of subtasksOf. */
export const SUBTASK_FILTER = 'issuetype in subTaskIssueTypes()';

/** Value sources of the hierarchy functions and hasSubtasks; watched ids are kept in id order, so a new issue changes only the last cache chunk. */
export function createHierarchyCompute({ jira }) {
  const inner = (subquery, reconcile) => jira.searchIds(subquery, { reconcile });

  async function loadNodes(ids) {
    const nodes = nodesFrom(await jira.bulkIssues(ids, ['parent', 'issuetype']));
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
      const kids = await jira.searchIds(`parent in (${parents.slice(i, i + VALUE_LIMIT).join(',')})`);
      for (const kid of await jira.bulkIssues(kids, ['parent'])) map.get(String(kid.fields?.parent?.id))?.push(String(kid.id));
    }
    return map;
  }

  return {
    async subtasksOf({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      let parents = ids;
      if (ids.length > VALUE_LIMIT) parents = (await jira.bulkIssues(ids, ['subtasks'])).filter((x) => x.fields?.subtasks?.length).map((x) => x.id);
      return { ids: sortIds(parents), field: 'parent', rootFilter: SUBTASK_FILTER, watch: sortIds(ids) };
    },
    async parentsOf({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      return { ids: parentIds(ids, nodesFrom(await jira.bulkIssues(ids, ['parent', 'issuetype']))), field: 'id', watch: sortIds(ids) };
    },
    async epicsOf({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const nodes = await loadNodes(ids);
      return { ids: sortIds(ids.map((id) => epicOf(id, nodes)).filter(Boolean)), field: 'id', watch: sortIds([...ids, ...nodes.keys()]) };
    },
    async issuesInEpics({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const epics = (await jira.bulkIssues(ids, ['issuetype'])).filter((x) => x.fields?.issuetype?.hierarchyLevel === 1).map((x) => x.id);
      return { ids: sortIds(epics), field: 'parent', watch: sortIds(ids) };
    },
    async childIssuesOf({ subquery, depth }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const { parents, seen } = await descendantParents(ids, depth ?? MAX_DEPTH, childrenOf);
      return { ids: parents, field: 'parent', watch: seen };
    },
    async hasSubtasks() {
      const subtasks = await jira.searchIds(SUBTASK_FILTER);
      const parents = (await jira.bulkIssues(subtasks, ['parent'])).map((x) => x.fields?.parent?.id).filter(Boolean);
      return { ids: sortIds(parents), field: 'id', watch: null };
    },
  };
}
