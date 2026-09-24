import { isJiraId } from './access';
import { isConfigured } from './config';

/** Keeps only values that are Jira ids, as strings, without duplicates. */
function jiraIds(values) {
  return [...new Set(values.filter(isJiraId).map(String))];
}

/** Reads what a Jira trigger event is about: issue events carry event.issue, link events top-level sourceIssueId/destinationIssueId (both seen on the dev site).
 * deleted:issue could not be observed there, so both event.issue.id and event.id are accepted. */
export function classifyEvent(event) {
  const type = String(event?.eventType ?? '');
  const projectId = event?.issue?.fields?.project?.id;
  const cleanProject = isJiraId(projectId) ? String(projectId) : null;
  if (type.endsWith(':issuelink') || event?.sourceIssueId !== undefined) {
    const link = event.issueLink ?? event;
    return { kind: 'link', projectId: null, issueIds: jiraIds([link.sourceIssueId, link.destinationIssueId]) };
  }
  if (type === 'avi:jira:deleted:issue') {
    return { kind: 'issue-deleted', projectId: cleanProject, issueIds: jiraIds([event.issue?.id ?? event.id]) };
  }
  return { kind: 'issue', projectId: cleanProject, issueIds: jiraIds([event?.issue?.id]) };
}

/** Recomputes coverage of the given requirements, grouped by project, for every project that is still configured. */
export async function recomputeAffected(affected, { repo, getConfig }) {
  const byProject = new Map();
  for (const { reqIssueId, projectId } of affected) {
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), reqIssueId]);
  }
  for (const [projectId, reqIssueIds] of byProject) {
    const config = await getConfig(projectId);
    if (isConfigured(config)) {
      await repo.recomputeCovered(projectId, [...new Set(reqIssueIds)], config);
    }
  }
}

/** Applies deleted issues to the cache at once: drops them as requirements, drops links pointing at them, recomputes coverage of the requirements that lost a link. */
export async function applyIssueDeletion(issueIds, deps) {
  await deps.repo.deleteRequirements(issueIds);
  const affected = [];
  for (const id of issueIds) {
    affected.push(...await deps.repo.deleteLinksToIssue(id));
  }
  await recomputeAffected(affected, deps);
}

/** Projects whose cached requirements are on either side of a link event; empty when neither issue is a cached requirement. */
export async function projectsForLinkEvent(info, repo) {
  if (!info.issueIds.length) {
    return [];
  }
  return repo.projectsOfIssues(info.issueIds);
}
