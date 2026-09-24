import { sql } from '@forge/sql';
import { isJiraId } from '../core/access';

const CHUNK = 500;

function chunks(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function placeholders(count, width) {
  const row = `(${new Array(width).fill('?').join(',')})`;
  return new Array(count).fill(row).join(',');
}

async function run(query, params = []) {
  return sql.prepare(query).bindParams(...params).execute();
}

/** Inserts or updates requirement cache rows; seen_sync_id only ever grows, so an older overlapping sync cannot expose a row to a newer full sync's cleanup. */
export async function upsertRequirements(rows) {
  for (const part of chunks(rows)) {
    const params = part.flatMap((r) => [r.issueId, r.issueKey, r.projectId, r.issueTypeId, r.summary, r.statusName,
      r.fingerprint, r.linksHash, r.covered, r.fieldsJson, r.jiraUpdatedAt, r.seenSyncId]);
    await run(`INSERT INTO req_issue (issue_id, issue_key, project_id, issue_type_id, summary, status_name,
        fingerprint, links_hash, covered, fields_json, jira_updated_at, seen_sync_id)
      VALUES ${placeholders(part.length, 12)}
      ON DUPLICATE KEY UPDATE issue_key = VALUES(issue_key), project_id = VALUES(project_id),
        issue_type_id = VALUES(issue_type_id), summary = VALUES(summary), status_name = VALUES(status_name),
        fingerprint = VALUES(fingerprint), links_hash = VALUES(links_hash), covered = VALUES(covered),
        fields_json = VALUES(fields_json), jira_updated_at = VALUES(jira_updated_at), seen_sync_id = GREATEST(seen_sync_id, VALUES(seen_sync_id))`, params);
  }
}

/** Upserts observed links (confirmed_* only set on insert) and deletes vanished links of these requirements. */
export async function replaceLinks(reqIssueIds, links, fingerprintsByReq) {
  for (const part of chunks(links)) {
    const params = part.flatMap((l) => [l.linkId, l.projectId ?? null, l.reqIssueId, l.otherIssueId, l.otherKey, l.otherTypeId,
      l.otherStatus, l.linkTypeId, l.linkTypeName, l.direction, fingerprintsByReq[l.reqIssueId]]);
    await run(`INSERT INTO trace_link (link_id, project_id, req_issue_id, other_issue_id, other_key, other_type_id,
        other_status, link_type_id, link_type_name, direction, confirmed_fingerprint)
      VALUES ${placeholders(part.length, 11)}
      ON DUPLICATE KEY UPDATE req_issue_id = VALUES(req_issue_id), other_issue_id = VALUES(other_issue_id),
        other_key = VALUES(other_key), other_type_id = VALUES(other_type_id), other_status = VALUES(other_status),
        link_type_id = VALUES(link_type_id), link_type_name = VALUES(link_type_name), direction = VALUES(direction)`, params);
  }
  const keep = new Set(links.map((l) => l.linkId));
  for (const part of chunks(reqIssueIds)) {
    const existing = await run(`SELECT link_id FROM trace_link WHERE req_issue_id IN (${part.map(() => '?').join(',')})`, part);
    const gone = existing.rows.map((r) => r.link_id).filter((id) => !keep.has(id));
    for (const g of chunks(gone)) {
      await run(`DELETE FROM trace_link WHERE link_id IN (${g.map(() => '?').join(',')})`, g);
    }
  }
}

/** Recomputes the suspect flag of all links of these requirements. */
export async function refreshSuspect(reqIssueIds) {
  for (const part of chunks(reqIssueIds)) {
    await run(`UPDATE trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
      SET t.suspect = IF(t.confirmed_fingerprint = r.fingerprint, 0, 1), t.project_id = r.project_id
      WHERE t.req_issue_id IN (${part.map(() => '?').join(',')})`, part);
  }
}

/** Anchors links to the current requirement fingerprint and clears suspicion; leaves already-suspect links untouched. */
export async function reanchor(reqIssueIds) {
  for (const part of chunks(reqIssueIds)) {
    await run(`UPDATE trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
      SET t.confirmed_fingerprint = r.fingerprint, t.suspect = 0
      WHERE t.req_issue_id IN (${part.map(() => '?').join(',')}) AND t.suspect = 0`, part);
  }
}

/** Removes requirements (and their links) not seen by a sync at or after syncId, so a later overlapping sync's rows survive. */
export async function deleteRequirementsNotSeen(projectId, syncId) {
  await run('DELETE FROM trace_link WHERE req_issue_id IN (SELECT issue_id FROM req_issue WHERE project_id = ? AND seen_sync_id < ?)', [projectId, syncId]);
  await run('DELETE FROM req_issue WHERE project_id = ? AND seen_sync_id < ?', [projectId, syncId]);
}

/** Removes the given requirements and their links. */
export async function deleteRequirements(issueIds) {
  for (const part of chunks(issueIds)) {
    const marks = part.map(() => '?').join(',');
    await run(`DELETE FROM trace_link WHERE req_issue_id IN (${marks})`, part);
    await run(`DELETE FROM req_issue WHERE issue_id IN (${marks})`, part);
  }
}

/** Deletes links whose other side is this issue; returns the requirement and project of each deleted link. */
export async function deleteLinksToIssue(issueId) {
  const found = await run('SELECT req_issue_id, project_id FROM trace_link WHERE other_issue_id = ?', [String(issueId)]);
  if (!found.rows.length) {
    return [];
  }
  await run('DELETE FROM trace_link WHERE other_issue_id = ?', [String(issueId)]);
  return found.rows.map((r) => ({ reqIssueId: r.req_issue_id, projectId: r.project_id }));
}

/** Refreshes key, type and status of linked (non-requirement) issues on every link row pointing at them; returns the requirement and project of each touched link. */
export async function updateLinkedIssues(rows) {
  const affected = [];
  for (const part of chunks(rows)) {
    const found = await run(`SELECT DISTINCT other_issue_id FROM trace_link WHERE other_issue_id IN (${part.map(() => '?').join(',')})`, part.map((r) => r.otherIssueId));
    const present = new Set(found.rows.map((r) => r.other_issue_id));
    for (const row of part.filter((r) => present.has(r.otherIssueId))) {
      await run('UPDATE trace_link SET other_key = ?, other_type_id = ?, other_status = ? WHERE other_issue_id = ?',
        [row.otherKey, row.otherTypeId, row.otherStatus, row.otherIssueId]);
      const touched = await run('SELECT req_issue_id, project_id FROM trace_link WHERE other_issue_id = ?', [row.otherIssueId]);
      affected.push(...touched.rows.map((r) => ({ reqIssueId: r.req_issue_id, projectId: r.project_id })));
    }
  }
  return affected;
}

/** Recomputes req_issue.covered in SQL for these requirements of a project: covered when a link reaches a verification type through an allowed link type. */
export async function recomputeCovered(projectId, reqIssueIds, config) {
  const verificationTypeIds = config.verificationTypeIds.filter(isJiraId);
  const linkTypeIds = config.linkTypeIds.filter(isJiraId);
  const ids = reqIssueIds.filter(isJiraId);
  if (!verificationTypeIds.length || !ids.length) {
    return;
  }
  const typeMarks = verificationTypeIds.map(() => '?').join(',');
  const linkFilter = linkTypeIds.length ? `AND t.link_type_id IN (${linkTypeIds.map(() => '?').join(',')})` : '';
  for (const part of chunks(ids)) {
    await run(`UPDATE req_issue r SET r.covered = IF(EXISTS(SELECT 1 FROM trace_link t
        WHERE t.req_issue_id = r.issue_id AND t.other_type_id IN (${typeMarks}) ${linkFilter}), 1, 0)
      WHERE r.project_id = ? AND r.issue_id IN (${part.map(() => '?').join(',')})`,
    [...verificationTypeIds, ...linkTypeIds, projectId, ...part]);
  }
}

/** Distinct projects of the given issues that are cached requirements. */
export async function projectsOfIssues(issueIds) {
  const ids = issueIds.filter(isJiraId);
  if (!ids.length) {
    return [];
  }
  const res = await run(`SELECT DISTINCT project_id FROM req_issue WHERE issue_id IN (${ids.map(() => '?').join(',')})`, ids);
  return res.rows.map((r) => r.project_id);
}

/** Creates a job row and returns its id. */
export async function createJob(kind, projectId, state, nowIso) {
  const res = await run('INSERT INTO job (kind, project_id, status, state_json, updated_at) VALUES (?, ?, ?, ?, ?)',
    [kind, projectId, 'running', JSON.stringify(state), nowIso]);
  return Number(res.rows.insertId);
}

function toJob(row) {
  return row ? { id: Number(row.id), kind: row.kind, projectId: row.project_id, status: row.status, state: JSON.parse(row.state_json), error: row.error, updatedAt: row.updated_at } : undefined;
}

/** Loads a job by id. */
export async function getJob(id) {
  const res = await run('SELECT * FROM job WHERE id = ?', [id]);
  return toJob(res.rows[0]);
}

/** Saves job state and status. */
export async function saveJob(job, status, nowIso, error) {
  await run('UPDATE job SET status = ?, state_json = ?, error = ?, updated_at = ? WHERE id = ?',
    [status, JSON.stringify(job.state), error ?? null, nowIso, job.id]);
}

/** Most recent job of a kind for a project. */
export async function latestJob(projectId, kind) {
  const res = await run('SELECT * FROM job WHERE project_id = ? AND kind = ? ORDER BY id DESC LIMIT 1', [projectId, kind]);
  return toJob(res.rows[0]);
}

/** Deletes up to limit done/failed jobs last updated before olderThanIso (ISO UTC strings compare in time order); returns the number deleted. */
export async function pruneJobs(olderThanIso, limit = 1000) {
  const res = await run(`DELETE FROM job WHERE status IN ('done', 'failed') AND updated_at < ? LIMIT ${Math.max(1, Math.trunc(Number(limit)) || 1000)}`, [olderThanIso]);
  return Number(res.rows.affectedRows ?? 0);
}

/** Totals for coverage of a project. */
export async function coverageCounts(projectId) {
  const res = await run('SELECT COUNT(*) AS total, COALESCE(SUM(covered), 0) AS covered FROM req_issue WHERE project_id = ?', [projectId]);
  return { total: Number(res.rows[0].total), covered: Number(res.rows[0].covered) };
}

/** Uncovered requirements page ordered by issue id. */
export async function gapsPage(projectId, after, limit) {
  const res = await run(`SELECT issue_id, issue_key, summary, status_name FROM req_issue
    WHERE project_id = ? AND covered = 0 AND issue_id > ? ORDER BY issue_id LIMIT ${Number(limit)}`, [projectId, after ?? '']);
  return res.rows.map((r) => ({ issueId: r.issue_id, issueKey: r.issue_key, summary: r.summary, statusName: r.status_name }));
}

/** Suspect links page ordered by link id. */
export async function suspectsPage(projectId, after, limit) {
  const res = await run(`SELECT t.link_id, r.issue_key, r.summary, t.other_key, t.link_type_name, t.other_status
    FROM trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
    WHERE t.project_id = ? AND t.suspect = 1 AND t.link_id > ? ORDER BY t.link_id LIMIT ${Number(limit)}`, [projectId, after ?? '']);
  return res.rows.map((r) => ({ linkId: r.link_id, reqKey: r.issue_key, reqSummary: r.summary, otherKey: r.other_key, linkTypeName: r.link_type_name, otherStatus: r.other_status }));
}

/** Confirms a link owned by the project (both the link row and its requirement must belong to it): anchors it to the requirement's current fingerprint. Returns the number of rows changed so a no-op is visible to the caller. */
export async function confirmLink(projectId, linkId, accountId, nowIso) {
  const res = await run(`UPDATE trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
    SET t.confirmed_fingerprint = r.fingerprint, t.suspect = 0, t.confirmed_by = ?, t.confirmed_at = ?
    WHERE t.link_id = ? AND t.project_id = ? AND r.project_id = ?`, [accountId, nowIso, linkId, projectId, projectId]);
  return Number(res.rows.affectedRows ?? 0);
}

/** Cached trace info for one issue, scoped to the caller's guarded project so a user cannot see another project's data. */
export async function issueTrace(issueId, projectId) {
  const req = await run('SELECT covered FROM req_issue WHERE issue_id = ? AND project_id = ?', [issueId, projectId]);
  const links = await run('SELECT link_id, other_key, link_type_name, other_status, suspect FROM trace_link WHERE req_issue_id = ? AND project_id = ? ORDER BY link_id', [issueId, projectId]);
  return {
    isRequirement: req.rows.length > 0,
    covered: Number(req.rows[0]?.covered) === 1,
    links: links.rows.map((l) => ({ linkId: l.link_id, otherKey: l.other_key, linkTypeName: l.link_type_name, otherStatus: l.other_status, suspect: Number(l.suspect) === 1 })),
  };
}
