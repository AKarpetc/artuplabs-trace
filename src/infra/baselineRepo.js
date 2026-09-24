import { sql } from '@forge/sql';
import { baselineChecksum, classifyDiffRow } from '../core/baselineDiff';

async function run(query, params = []) {
  return sql.prepare(query).bindParams(...params).execute();
}

/** Creates a baseline row in status "capturing". */
export async function createBaseline({ projectId, name, createdBy, nowIso }) {
  const res = await run('INSERT INTO baseline (project_id, name, created_by, created_at, status) VALUES (?, ?, ?, ?, ?)',
    [projectId, name, createdBy, nowIso, 'capturing']);
  return Number(res.rows.insertId);
}

/** Copies the next batch of cached requirements into the baseline (idempotent). */
export async function snapshotBatch(baselineId, projectId, afterIssueId, limit) {
  const page = await run(`SELECT issue_id FROM req_issue WHERE project_id = ? AND issue_id > ? ORDER BY issue_id LIMIT ${Number(limit)}`,
    [projectId, afterIssueId ?? '']);
  const ids = page.rows.map((r) => r.issue_id);
  if (!ids.length) {
    return { lastIssueId: null, copied: 0 };
  }
  const marks = ids.map(() => '?').join(',');
  await run(`INSERT IGNORE INTO issue_version (issue_id, fingerprint, issue_key, summary, status_name, fields_json)
    SELECT issue_id, fingerprint, issue_key, summary, status_name, fields_json FROM req_issue WHERE issue_id IN (${marks})`, ids);
  await run(`INSERT IGNORE INTO baseline_member (baseline_id, issue_id, version_id, links_hash)
    SELECT ?, r.issue_id, v.id, r.links_hash FROM req_issue r
    JOIN issue_version v ON v.issue_id = r.issue_id AND v.fingerprint = r.fingerprint
    WHERE r.issue_id IN (${marks})`, [baselineId, ...ids]);
  return { lastIssueId: ids[ids.length - 1], copied: ids.length };
}

/** Computes checksum over all members and marks the baseline complete. */
export async function completeBaseline(baselineId) {
  const members = [];
  let after = '';
  for (;;) {
    const page = await run(`SELECT m.issue_id, v.fingerprint, m.links_hash FROM baseline_member m
      JOIN issue_version v ON v.id = m.version_id
      WHERE m.baseline_id = ? AND m.issue_id > ? ORDER BY m.issue_id LIMIT 1000`, [baselineId, after]);
    if (!page.rows.length) {
      break;
    }
    page.rows.forEach((r) => members.push({ issueId: r.issue_id, fingerprint: r.fingerprint, linksHash: r.links_hash }));
    after = page.rows[page.rows.length - 1].issue_id;
  }
  const checksum = baselineChecksum(members);
  await run('UPDATE baseline SET status = ?, member_count = ?, checksum = ? WHERE id = ? AND status = ?',
    ['complete', members.length, checksum, baselineId, 'capturing']);
  return { memberCount: members.length, checksum };
}

/** Marks a baseline as failed. */
export async function failBaseline(baselineId, message) {
  await run('UPDATE baseline SET status = ?, name = CONCAT(name, ?) WHERE id = ? AND status = ?',
    ['failed', ` (failed: ${String(message).slice(0, 100)})`, baselineId, 'capturing']);
}

/** Baselines of a project, newest first. */
export async function listBaselines(projectId) {
  const res = await run('SELECT * FROM baseline WHERE project_id = ? ORDER BY id DESC LIMIT 100', [projectId]);
  return res.rows.map((r) => ({ id: Number(r.id), name: r.name, createdBy: r.created_by, createdAt: r.created_at, status: r.status, memberCount: Number(r.member_count), checksum: r.checksum }));
}

/** Counts of added, removed, changed and link-changed issues between two baselines. */
export async function diffCounts(leftId, rightId) {
  const both = await run(`SELECT
      SUM(CASE WHEN l.version_id <> r.version_id THEN 1 ELSE 0 END) AS changed,
      SUM(CASE WHEN l.version_id = r.version_id AND l.links_hash <> r.links_hash THEN 1 ELSE 0 END) AS links_changed
    FROM baseline_member l JOIN baseline_member r ON r.issue_id = l.issue_id AND r.baseline_id = ?
    WHERE l.baseline_id = ?`, [rightId, leftId]);
  const removed = await run(`SELECT COUNT(*) AS n FROM baseline_member l
    LEFT JOIN baseline_member r ON r.issue_id = l.issue_id AND r.baseline_id = ?
    WHERE l.baseline_id = ? AND r.issue_id IS NULL`, [rightId, leftId]);
  const added = await run(`SELECT COUNT(*) AS n FROM baseline_member r
    LEFT JOIN baseline_member l ON l.issue_id = r.issue_id AND l.baseline_id = ?
    WHERE r.baseline_id = ? AND l.issue_id IS NULL`, [leftId, rightId]);
  return {
    added: Number(added.rows[0].n),
    removed: Number(removed.rows[0].n),
    changed: Number(both.rows[0].changed ?? 0),
    linksChanged: Number(both.rows[0].links_changed ?? 0),
  };
}

/** One page of differing issues between two baselines, ordered by issue id. */
export async function diffPage(leftId, rightId, afterIssueId, limit) {
  const lim = Number(limit);
  const leftSide = await run(`SELECT l.issue_id, l.version_id AS lv, r.version_id AS rv, l.links_hash AS lh, r.links_hash AS rh
    FROM baseline_member l LEFT JOIN baseline_member r ON r.issue_id = l.issue_id AND r.baseline_id = ?
    WHERE l.baseline_id = ? AND l.issue_id > ? AND (r.issue_id IS NULL OR l.version_id <> r.version_id OR l.links_hash <> r.links_hash)
    ORDER BY l.issue_id LIMIT ${lim}`, [rightId, leftId, afterIssueId ?? '']);
  const addedSide = await run(`SELECT r.issue_id, NULL AS lv, r.version_id AS rv, NULL AS lh, r.links_hash AS rh
    FROM baseline_member r LEFT JOIN baseline_member l ON l.issue_id = r.issue_id AND l.baseline_id = ?
    WHERE r.baseline_id = ? AND r.issue_id > ? AND l.issue_id IS NULL
    ORDER BY r.issue_id LIMIT ${lim}`, [leftId, rightId, afterIssueId ?? '']);
  const rows = [...leftSide.rows, ...addedSide.rows]
    .sort((a, b) => (a.issue_id < b.issue_id ? -1 : 1))
    .slice(0, lim);
  if (!rows.length) {
    return [];
  }
  const versionIds = [...new Set(rows.flatMap((r) => [r.lv, r.rv]).filter((v) => v != null))];
  const versions = await run(`SELECT id, issue_key, summary, status_name FROM issue_version WHERE id IN (${versionIds.map(() => '?').join(',')})`, versionIds);
  const byId = new Map(versions.rows.map((v) => [String(v.id), v]));
  return rows.map((r) => {
    const left = r.lv != null ? byId.get(String(r.lv)) : null;
    const right = r.rv != null ? byId.get(String(r.rv)) : null;
    const shown = right ?? left;
    return {
      issueId: r.issue_id,
      issueKey: shown.issue_key,
      summary: shown.summary,
      change: classifyDiffRow({ leftVersionId: r.lv, rightVersionId: r.rv, leftLinksHash: r.lh, rightLinksHash: r.rh }),
      leftStatus: left?.status_name ?? '',
      rightStatus: right?.status_name ?? '',
    };
  });
}
