const isAbort = (error) => error?.name === 'AbortError';
const truncated = (page, key) => (page?.total ?? 0) > (page?.[key]?.length ?? 0);

async function fullList(needed, load, what, issue, warnings) {
  if (!needed) return null;
  try {
    return await load(issue.id);
  } catch (error) {
    if (isAbort(error)) throw error;
    warnings.push({ kind: 'issue-incomplete', detail: what, issueKey: issue.key });
    return null;
  }
}

/** Reads one bulkfetch batch: issues in id order, truncated comments and worklogs read in full, each issue consumed; a failing issue is skipped with a warning, not the batch. */
export function createBatchReader({ client, plan, fetchOptions, consumer }) {
  const complete = async (issue, warnings) => {
    const f = issue.fields ?? {};
    const [comments, worklogs] = await Promise.all([
      fullList(plan.comments && truncated(f.comment, 'comments'), client.listComments, 'comments', issue, warnings),
      fullList(plan.worklogs && truncated(f.worklog, 'worklogs'), client.listWorklogs, 'worklogs', issue, warnings),
    ]);
    if (!comments && !worklogs) return issue;
    const fields = { ...f };
    if (comments) fields.comment = { ...f.comment, comments, total: comments.length };
    if (worklogs) fields.worklog = { ...f.worklog, worklogs, total: worklogs.length };
    return { ...issue, fields };
  };
  return async (ids) => {
    const { issues, errors } = await client.bulkFetch(ids, fetchOptions);
    const position = new Map(ids.map((id, i) => [id, i]));
    const ordered = [...issues].sort((a, b) => (position.get(String(a.id)) ?? 0) - (position.get(String(b.id)) ?? 0));
    const notes = ordered.map(() => []);
    const completed = await Promise.all(ordered.map((issue, i) => complete(issue, notes[i])));
    const items = [];
    const warnings = [];
    let skipped = errors.length;
    completed.forEach((issue, i) => {
      warnings.push(...notes[i]);
      try {
        items.push(consumer.consume(issue));
      } catch (error) {
        skipped += 1;
        warnings.push({ kind: 'issue-failed', detail: String(error?.message ?? error), issueKey: issue.key });
      }
    });
    return { items, skipped, warnings, project: completed[0]?.fields?.project?.key ?? '' };
  };
}
