import { MAX_DEPTH } from '../core/limits.js';
import { closure, linkQuery, linkedIds, matchLinkType } from '../core/links.js';
import { quote } from '../core/jql-build.js';
import { sortIds } from '../core/ids.js';

/** Value sources of the link functions; hasLinks/hasLinkType use Jira's own issueLinkType clause where it matches exactly. */
export function createLinkCompute({ jira }) {
  async function filterOf(linkType) {
    if (linkType === undefined) return { types: [], filter: null };
    const types = await jira.linkTypes();
    return { types, ...matchLinkType(types, linkType) };
  }

  async function linksOf(ids, reconcile) {
    const map = new Map();
    for (const x of await jira.bulkIssues(ids, ['issuelinks'])) map.set(String(x.id), x.fields?.issuelinks ?? []);
    const asked = new Set(ids.map(String));
    for (const id of reconcile.filter((r) => asked.has(String(r)))) {
      const fresh = await jira.issue(id, ['issuelinks']);
      if (fresh) map.set(String(id), fresh.fields?.issuelinks ?? []);
    }
    return map;
  }

  async function recursive({ subquery, linkType }, depth, reconcile) {
    const f = await filterOf(linkType);
    if (f.error) return { error: f.error, log: f.log };
    const ids = await jira.searchIds(subquery, { reconcile });
    const reached = await closure(ids, depth, async (frontier) => {
      const map = await linksOf(frontier, reconcile);
      return new Map(frontier.map((id) => [id, linkedIds(map.get(id), f.filter)]));
    });
    return { ids: reached, field: 'id', watch: sortIds([...ids, ...reached]) };
  }

  async function hasLinks({ linkType }, { reconcile = [] } = {}) {
    const f = await filterOf(linkType);
    if (f.error) return { error: f.error, log: f.log };
    const query = linkQuery(f.types, f.filter);
    if (query.native) return { native: query.native };
    const own = f.types.find((t) => String(t.id) === f.filter.typeId);
    const ids = await jira.searchIds(`issueLinkType = ${quote(own.name)}`, { reconcile });
    const map = await linksOf(ids, reconcile);
    return { ids: sortIds(ids.filter((id) => linkedIds(map.get(String(id)), f.filter).length)), field: 'id', watch: null };
  }

  return {
    async linkedIssuesOf({ subquery, linkType }, { reconcile }) {
      const f = await filterOf(linkType);
      if (f.error) return { error: f.error, log: f.log };
      const ids = await jira.searchIds(subquery, { reconcile });
      const map = await linksOf(ids, reconcile);
      return { ids: sortIds(ids.flatMap((id) => linkedIds(map.get(String(id)), f.filter))), field: 'id', watch: ids };
    },
    linkedIssuesOfRecursive: (args, { reconcile }) => recursive(args, MAX_DEPTH, reconcile),
    linkedIssuesOfRecursiveLimited: (args, { reconcile }) => recursive(args, args.depth, reconcile),
    hasLinks,
    hasLinkType: hasLinks,
  };
}
