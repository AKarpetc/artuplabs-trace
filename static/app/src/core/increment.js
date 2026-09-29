/**
 * Decides what an update export fetches, downloads and deletes relative to the previous manifest; folder entries only keep names stable.
 * `labels` maps page id → current labels hash; a page whose hash differs from the manifest is refetched.
 */
export function planUpdate({ previous, versions, plan, attachments, attachmentPlan, labels = new Map() }) {
  const fetchIds = new Set();
  const downloadIds = new Set();
  const deletes = new Set();
  const gone = new Set();
  const stats = { added: 0, changed: 0, moved: 0, relinked: 0, missing: 0, unchanged: 0 };
  const previousPages = previous.pages.filter((p) => p.type !== 'folder');
  const byId = new Map(previousPages.map((p) => [p.id, p]));

  for (const [id, version] of versions) {
    const old = byId.get(id);
    const now = plan.get(id);
    if (!old) {
      fetchIds.add(id);
      stats.added += 1;
      continue;
    }
    if (old.path !== now.path) {
      fetchIds.add(id);
      gone.add(id);
      stats.moved += 1;
      deletes.add(old.path);
      old.attachments.forEach((a) => deletes.add(a.path));
    } else if (old.version !== version || old.weight !== now.weight || (labels.has(id) && old.labelsHash !== labels.get(id))) {
      fetchIds.add(id);
      stats.changed += 1;
    }
  }
  for (const old of previousPages) {
    if (versions.has(old.id)) continue;
    gone.add(old.id);
    stats.missing += 1;
    deletes.add(old.path);
    old.attachments.forEach((a) => deletes.add(a.path));
  }
  for (const old of previousPages) {
    if (versions.has(old.id) && !fetchIds.has(old.id) && old.links.some((id) => gone.has(id))) {
      fetchIds.add(old.id);
      stats.relinked += 1;
    }
  }
  if (attachments) {
    for (const [pageId, list] of attachments) {
      const planned = attachmentPlan.get(pageId) ?? new Map();
      const oldById = new Map((byId.get(pageId)?.attachments ?? []).map((a) => [a.id, a]));
      for (const attachment of list) {
        const old = oldById.get(attachment.id);
        if (fetchIds.has(pageId) || !old || old.version !== attachment.version || old.path !== planned.get(attachment.id)) downloadIds.add(attachment.id);
        if (old && old.path !== planned.get(attachment.id)) deletes.add(old.path);
      }
      for (const old of oldById.values()) {
        if (!planned.has(old.id)) deletes.add(old.path);
      }
    }
  }
  const written = new Set([...plan.values()].map((p) => p.path));
  attachmentPlan.forEach((map) => map.forEach((path) => written.add(path)));
  stats.unchanged = [...versions.keys()].filter((id) => !fetchIds.has(id)).length;
  return { fetchIds, downloadIds, deletePaths: [...deletes].filter((p) => !written.has(p)).sort(), stats };
}
