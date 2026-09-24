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
      rows.forEach((r) => reqs.set(r.issueId, { ...r }));
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
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId)).forEach((l) => {
        l.confirmedFingerprint = reqs.get(l.reqIssueId).fingerprint;
        l.suspect = 0;
      });
    },
    async deleteRequirementsNotSeen(projectId, syncId) {
      [...reqs.values()].filter((r) => r.projectId === projectId && r.seenSyncId !== syncId).forEach((r) => {
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
    async createJob(kind, projectId, state) {
      const id = nextJob++;
      jobs.set(id, { id, kind, projectId, state, status: 'running' });
      return id;
    },
    async getJob(id) {
      return jobs.get(id);
    },
    async saveJob(job, status, _nowIso, error) {
      jobs.set(job.id, { ...job, status, error: error ?? null });
    },
    async latestJob(projectId, kind) {
      return [...jobs.values()].filter((j) => j.projectId === projectId && j.kind === kind).pop();
    },
  };
}
