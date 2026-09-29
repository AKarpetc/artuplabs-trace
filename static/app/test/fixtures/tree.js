/** Builds an ExportTree from [id, title, parentId, type] rows in sibling order; type 'folder' marks a Confluence folder. */
export function treeOf(rows) {
  const nodes = new Map(rows.map(([id, title, parentId, type]) => [id, { id, title, parentId: parentId ?? null, childIds: [], ...(type === 'folder' ? { type } : {}) }]));
  const rootIds = [];
  for (const [id, , parentId] of rows) {
    if (parentId && nodes.has(parentId)) nodes.get(parentId).childIds.push(id);
    else rootIds.push(id);
  }
  return { rootIds, nodes };
}
