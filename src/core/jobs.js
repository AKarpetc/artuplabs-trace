import { fingerprint, linksHash } from './fingerprint';
import { extractLinks, isCovered } from './links';
import { takePoints } from './budget';
import { RateLimited, SEARCH_PAGE } from '../infra/jira';

/** Jira fields requested for requirement issues. */
export function issueFields(config) {
  return [...new Set(['summary', 'status', 'issuetype', 'issuelinks', 'updated', ...config.fingerprintFieldIds])];
}

/** Maps one Jira requirement issue to a cache row and its link rows. */
export function toCacheRows(issue, config, syncId, projectId) {
  const links = extractLinks(issue);
  const extra = Object.fromEntries(config.fingerprintFieldIds
    .filter((id) => !['summary', 'description'].includes(id))
    .map((id) => [id, issue.fields?.[id] ?? null]));
  return {
    req: {
      issueId: String(issue.id),
      issueKey: issue.key,
      projectId: String(projectId),
      issueTypeId: String(issue.fields?.issuetype?.id ?? ''),
      summary: String(issue.fields?.summary ?? '').slice(0, 1024),
      statusName: issue.fields?.status?.name ?? '',
      fingerprint: fingerprint(issue, config.fingerprintFieldIds),
      linksHash: linksHash(links),
      covered: isCovered(links, config) ? 1 : 0,
      fieldsJson: JSON.stringify(extra),
      jiraUpdatedAt: issue.fields?.updated ?? null,
      seenSyncId: syncId,
    },
    links,
  };
}

async function applyPage(issues, job, deps) {
  const isRequirement = (i) => deps.config.requirementTypeIds.includes(String(i.fields?.issuetype?.id));
  const reqIssues = issues.filter(isRequirement);
  const dropped = issues.filter((i) => !isRequirement(i)).map((i) => String(i.id));
  const rows = reqIssues.map((i) => toCacheRows(i, deps.config, job.state.syncId, job.projectId));
  const reqIds = rows.map((r) => r.req.issueId);
  if (rows.length) {
    await deps.repo.upsertRequirements(rows.map((r) => r.req));
    const fingerprints = Object.fromEntries(rows.map((r) => [r.req.issueId, r.req.fingerprint]));
    await deps.repo.replaceLinks(reqIds, rows.flatMap((r) => r.links.map((l) => ({ ...l, projectId: job.projectId }))), fingerprints);
    if (job.state.reanchor) {
      await deps.repo.reanchor(reqIds);
    }
    await deps.repo.refreshSuspect(reqIds);
  }
  if (dropped.length) {
    await deps.repo.deleteRequirements(dropped);
  }
}

/** Runs sync pages until done, deadline, budget exhaustion or a 429; returns how to continue. */
export async function runSyncStep(job, deps) {
  const started = deps.now();
  let current = { ...job, state: { ...job.state } };
  while (deps.now() - started < deps.deadlineMs) {
    const reserve = takePoints(await deps.budget.get(), 1 + SEARCH_PAGE, deps.now());
    if (!reserve.ok) {
      return { status: 'waiting', job: current, delaySeconds: reserve.waitSeconds };
    }
    await deps.budget.save(reserve.state);
    let page;
    try {
      page = await deps.jira.searchPage({
        jql: current.state.jql,
        fields: issueFields(deps.config),
        nextPageToken: current.state.nextPageToken,
        maxResults: SEARCH_PAGE,
      });
    } catch (error) {
      if (error instanceof RateLimited) {
        return { status: 'waiting', job: current, delaySeconds: error.retryAfterSeconds };
      }
      throw error;
    }
    await applyPage(page.issues, current, deps);
    current = { ...current, state: { ...current.state, nextPageToken: page.nextPageToken, pages: current.state.pages + 1 } };
    if (!page.nextPageToken) {
      if (current.kind === 'full-sync') {
        await deps.repo.deleteRequirementsNotSeen(current.projectId, current.state.syncId);
      }
      return { status: 'done', job: current, delaySeconds: 0 };
    }
  }
  return { status: 'running', job: current, delaySeconds: 0 };
}
