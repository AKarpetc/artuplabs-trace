import { isCovered } from '../../src/core/links';

/** In-memory repo mirroring src/infra/repo.js semantics for job tests. */
export function memoryRepo() {
  const reqs = new Map();
  const links = new Map();
  const jobs = new Map();
  let nextJob = 1;
  return {
    reqs,
    links,
    jobs,
    async upsertRequirements(rows) {
      rows.forEach((r) => reqs.set(r.issueId, { ...r, seenSyncId: Math.max(r.seenSyncId ?? 0, reqs.get(r.issueId)?.seenSyncId ?? 0) }));
    },
    async replaceLinks(reqIssueIds, rows, fingerprintsByReq) {
      const keep = new Set(rows.map((l) => l.linkId));
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId) && !keep.has(l.linkId)).forEach((l) => links.delete(l.linkId));
      rows.forEach((l) => {
        const existing = links.get(l.linkId);
        links.set(l.linkId, existing
          ? { ...existing, ...l }
          : { ...l, confirmedFingerprint: fingerprintsByReq[l.reqIssueId], confirmedBy: null, suspect: 0 });
      });
    },
    async refreshSuspect(reqIssueIds) {
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId)).forEach((l) => {
        l.suspect = l.confirmedFingerprint !== reqs.get(l.reqIssueId)?.fingerprint ? 1 : 0;
      });
    },
    async reanchor(reqIssueIds) {
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId) && l.suspect === 0).forEach((l) => {
        l.confirmedFingerprint = reqs.get(l.reqIssueId).fingerprint;
        l.suspect = 0;
      });
    },
    async deleteRequirementsNotSeen(projectId, syncId) {
      [...reqs.values()].filter((r) => r.projectId === projectId && r.seenSyncId < syncId).forEach((r) => {
        reqs.delete(r.issueId);
        [...links.values()].filter((l) => l.reqIssueId === r.issueId).forEach((l) => links.delete(l.linkId));
      });
    },
    async deleteRequirements(issueIds) {
      issueIds.forEach((id) => {
        reqs.delete(id);
        [...links.values()].filter((l) => l.reqIssueId === id).forEach((l) => links.delete(l.linkId));
      });
    },
    async deleteLinksToIssue(issueId) {
      const gone = [...links.values()].filter((l) => l.otherIssueId === String(issueId));
      gone.forEach((l) => links.delete(l.linkId));
      return gone.map((l) => ({ reqIssueId: l.reqIssueId, projectId: l.projectId }));
    },
    async updateLinkedIssues(rows) {
      const affected = [];
      rows.forEach((row) => {
        [...links.values()].filter((l) => l.otherIssueId === row.otherIssueId).forEach((l) => {
          Object.assign(l, { otherKey: row.otherKey, otherTypeId: row.otherTypeId, otherStatus: row.otherStatus });
          affected.push({ reqIssueId: l.reqIssueId, projectId: l.projectId });
        });
      });
      return affected;
    },
    async recomputeCovered(projectId, reqIssueIds, config) {
      reqIssueIds.map((id) => reqs.get(id)).filter((r) => r && r.projectId === projectId).forEach((r) => {
        r.covered = isCovered([...links.values()].filter((l) => l.reqIssueId === r.issueId), config) ? 1 : 0;
      });
    },
    async projectsOfIssues(issueIds) {
      return [...new Set(issueIds.map((id) => reqs.get(id)?.projectId).filter(Boolean))];
    },
    async createJob(kind, projectId, state, nowIso) {
      const id = nextJob++;
      jobs.set(id, { id, kind, projectId, state, status: 'running', updatedAt: nowIso });
      return id;
    },
    async getJob(id) {
      return jobs.get(id);
    },
    async saveJob(job, status, nowIso, error) {
      jobs.set(job.id, { ...job, status, error: error ?? null, updatedAt: nowIso });
    },
    async pruneJobs(olderThanIso, limit = 1000) {
      const old = [...jobs.values()].filter((j) => ['done', 'failed'].includes(j.status) && j.updatedAt < olderThanIso).slice(0, limit);
      old.forEach((j) => jobs.delete(j.id));
      return old.length;
    },
    async latestJob(projectId, kind) {
      return [...jobs.values()].filter((j) => j.projectId === projectId && j.kind === kind).pop();
    },
  };
}
