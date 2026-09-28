/** Builds an ExportTree from [id, title, parentId] rows in sibling order. */
export function treeOf(rows) {
  const nodes = new Map(rows.map(([id, title, parentId]) => [id, { id, title, parentId: parentId ?? null, childIds: [] }]));
  const rootIds = [];
  for (const [id, , parentId] of rows) {
    if (parentId && nodes.has(parentId)) nodes.get(parentId).childIds.push(id);
    else rootIds.push(id);
  }
  return { rootIds, nodes };
}
