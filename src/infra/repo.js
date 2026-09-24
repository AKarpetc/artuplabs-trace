import { sql } from '@forge/sql';

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

/** Inserts or updates requirement cache rows. */
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
        fields_json = VALUES(fields_json), jira_updated_at = VALUES(jira_updated_at), seen_sync_id = VALUES(seen_sync_id)`, params);
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
