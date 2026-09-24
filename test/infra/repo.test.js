import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], answers: [] }));

vi.mock('@forge/sql', () => ({
  sql: {
    prepare: (query) => ({
      bindParams: (...params) => ({
        execute: async () => {
          h.calls.push({ query: query.replace(/\s+/g, ' ').trim(), params });
          return h.answers.shift() ?? { rows: [] };
        },
      }),
    }),
  },
}));

const repo = await import('../../src/infra/repo');

beforeEach(() => {
  h.calls.length = 0;
  h.answers.length = 0;
});

describe('issueTrace', () => {
  it('reads covered as a number, so a driver returning "1" still means covered', async () => {
    h.answers.push({ rows: [{ covered: '1' }] }, { rows: [] });
    expect((await repo.issueTrace('7', '10001')).covered).toBe(true);
  });
});

describe('upsertRequirements', () => {
  it('never lowers seen_sync_id', async () => {
    await repo.upsertRequirements([{ issueId: '1', seenSyncId: 5 }]);
    expect(h.calls[0].query).toContain('seen_sync_id = GREATEST(seen_sync_id, VALUES(seen_sync_id))');
  });
});

describe('recomputeCovered', () => {
  it('binds verification types, link types, project and requirement ids in placeholder order and skips non-Jira ids', async () => {
    await repo.recomputeCovered('10001', ['1', 'x', '2'], { verificationTypeIds: ['20', 'bad'], linkTypeIds: ['3'] });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].query).toContain('t.other_type_id IN (?) AND t.link_type_id IN (?)');
    expect(h.calls[0].query).toContain('WHERE r.project_id = ? AND r.issue_id IN (?,?)');
    expect(h.calls[0].params).toEqual(['20', '3', '10001', '1', '2']);
  });

  it('with no link types counts any link type', async () => {
    await repo.recomputeCovered('10001', ['1'], { verificationTypeIds: ['20'], linkTypeIds: [] });
    expect(h.calls[0].query).not.toContain('link_type_id');
    expect(h.calls[0].params).toEqual(['20', '10001', '1']);
  });
});

describe('pruneJobs', () => {
  it('deletes only finished jobs older than the cut-off, bounded by the limit', async () => {
    h.answers.push({ rows: { affectedRows: 3 } });
    expect(await repo.pruneJobs('2026-09-18T00:00:00.000Z', 1000)).toBe(3);
    expect(h.calls[0].query).toBe("DELETE FROM job WHERE status IN ('done', 'failed') AND updated_at < ? LIMIT 1000");
    expect(h.calls[0].params).toEqual(['2026-09-18T00:00:00.000Z']);
  });
});
