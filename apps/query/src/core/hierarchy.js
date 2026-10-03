import { MAX_DEPTH } from './limits.js';
import { sortIds } from './ids.js';

/** Nodes from bulkfetched issues (fields parent, issuetype): each issue, and a stub of its parent if not loaded. */
export function nodesFrom(issues, nodes = new Map()) {
  for (const issue of issues) {
    const parent = issue.fields?.parent;
    nodes.set(String(issue.id), { id: String(issue.id), parentId: parent ? String(parent.id) : null, level: issue.fields?.issuetype?.hierarchyLevel ?? 0, loaded: true });
    if (parent && !nodes.get(String(parent.id))?.loaded) {
      nodes.set(String(parent.id), { id: String(parent.id), parentId: undefined, level: parent.fields?.issuetype?.hierarchyLevel ?? 0, loaded: false });
    }
  }
  return nodes;
}

/** Distinct direct parents of the issues. */
export function parentIds(ids, nodes) {
  return sortIds(ids.map((id) => nodes.get(String(id))?.parentId).filter(Boolean));
}

/** Epic (level 1) above an issue: its id, null when there is none, undefined when a parent must be loaded first. */
export function epicOf(id, nodes) {
  let node = nodes.get(String(id));
  if (!node || node.level >= 1) return null;
  for (let step = 0; step < MAX_DEPTH; step += 1) {
    if (node.parentId === undefined) return undefined;
    if (node.parentId === null) return null;
    const parent = nodes.get(node.parentId);
    if (!parent) return undefined;
    if (parent.level === 1) return parent.id;
    if (parent.level > 1) return null;
    node = parent;
  }
  return null;
}

/** Parent stubs that must be loaded before the epic of every given issue is known. */
export function unresolvedParents(ids, nodes) {
  const out = new Set();
  for (const id of ids) {
    if (epicOf(id, nodes) !== undefined) continue;
    let node = nodes.get(String(id));
    while (node?.loaded && node.parentId) node = nodes.get(node.parentId);
    if (node && !node.loaded) out.add(node.id);
  }
  return sortIds(out);
}

/** Parents whose children are the descendants of the starts within depth: `parent in (these)` returns levels 1..depth. */
export async function descendantParents(starts, depth, childrenOf) {
  const seen = new Set(starts.map(String));
  const parents = new Set();
  let frontier = [...seen];
  for (let level = 1; level <= Math.min(depth, MAX_DEPTH) && frontier.length; level += 1) {
    const children = await childrenOf(frontier);
    const next = [];
    for (const [parent, kids] of children) {
      if (!kids.length) continue;
      parents.add(String(parent));
      for (const kid of kids.map(String)) {
        if (seen.has(kid)) continue;
        seen.add(kid);
        next.push(kid);
      }
    }
    frontier = next;
  }
  return { parents: sortIds(parents), seen: sortIds(seen) };
}
