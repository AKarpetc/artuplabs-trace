import { ConfluenceError } from '../infra/confluence.js';

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function rootsOf(client, target, signal) {
  if (target.kind === 'space') {
    const space = await client.getSpace(target.spaceKey);
    throwIfAborted(signal);
    return (await client.listRootPages(space.id)).map((r) => ({ id: r.id, title: r.title, parentId: null }));
  }
  const [page] = await client.getPages([target.pageId], { withBody: false });
  if (!page) throw new ConfluenceError(404, `page ${target.pageId}`);
  return [{ id: page.id, title: page.title, parentId: page.parentId ?? null }];
}

/** Scans the export target breadth-first, level by level; nodes in discovery order, children in Confluence order. */
export async function scanTree(client, target, onProgress, signal) {
  throwIfAborted(signal);
  const nodes = new Map();
  const add = ({ id, title, parentId }) => nodes.set(id, { id, title, parentId, childIds: [] });
  const roots = [...new Map((await rootsOf(client, target, signal)).map((r) => [r.id, r])).values()];
  throwIfAborted(signal);
  roots.forEach(add);
  onProgress({ stage: 'scan', done: nodes.size, total: 0 });
  let level = target.kind === 'page' ? [] : roots.map((r) => r.id);
  while (level.length > 0) {
    const children = await Promise.all(level.map((id) => client.listChildren(id)));
    throwIfAborted(signal);
    const next = [];
    level.forEach((parentId, index) => {
      for (const child of children[index]) {
        if (nodes.has(child.id)) continue;
        add({ id: child.id, title: child.title, parentId });
        nodes.get(parentId).childIds.push(child.id);
        next.push(child.id);
      }
    });
    onProgress({ stage: 'scan', done: nodes.size, total: 0 });
    level = next;
  }
  return { rootIds: roots.map((r) => r.id), nodes };
}
