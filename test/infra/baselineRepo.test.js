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

const baselineRepo = await import('../../src/infra/baselineRepo');

beforeEach(() => {
  h.calls.length = 0;
  h.answers.length = 0;
});

describe('createBaseline', () => {
  it('writes created_by as an empty string, never an account id', async () => {
    h.answers.push({ rows: { insertId: 7 } });
    expect(await baselineRepo.createBaseline({ projectId: '10001', name: 'B1', nowIso: '2026-09-28T00:00:00.000Z' })).toBe(7);
    expect(h.calls[0].params).toEqual(['10001', 'B1', '', '2026-09-28T00:00:00.000Z', 'capturing']);
  });
});

describe('listBaselines', () => {
  it('does not surface created_by on the returned rows', async () => {
    h.answers.push({ rows: [{ id: 1, name: 'B1', created_by: '', created_at: 'now', status: 'complete', member_count: 3, checksum: 'abc' }] });
    const [row] = await baselineRepo.listBaselines('10001');
    expect(row).not.toHaveProperty('createdBy');
    expect(row).toEqual({ id: 1, name: 'B1', createdAt: 'now', status: 'complete', memberCount: 3, checksum: 'abc' });
  });
});

describe('diffCounts', () => {
  it('reads added, removed, changed, linksChanged and statusChanged from the three queries', async () => {
    h.answers.push(
      { rows: [{ changed: 2, links_changed: 1, status_changed: 3 }] },
      { rows: [{ n: 4 }] },
      { rows: [{ n: 5 }] },
    );
    expect(await baselineRepo.diffCounts(10, 20)).toEqual({
      added: 5, removed: 4, changed: 2, linksChanged: 1, statusChanged: 3,
    });
  });

  it('defaults every sum to zero when the aggregate query has no matching rows', async () => {
    h.answers.push(
      { rows: [{ changed: null, links_changed: null, status_changed: null }] },
      { rows: [{ n: 0 }] },
      { rows: [{ n: 0 }] },
    );
    expect(await baselineRepo.diffCounts(10, 20)).toEqual({
      added: 0, removed: 0, changed: 0, linksChanged: 0, statusChanged: 0,
    });
  });

  it('counts status-changed only when version and links both match but status differs', async () => {
    h.answers.push({ rows: [{}] }, { rows: [{ n: 0 }] }, { rows: [{ n: 0 }] });
    await baselineRepo.diffCounts(10, 20);
    expect(h.calls[0].query).toContain(
      "l.version_id = r.version_id AND l.links_hash = r.links_hash AND l.status_name <> '' AND r.status_name <> '' AND l.status_name <> r.status_name",
    );
    expect(h.calls[0].params).toEqual([20, 10]);
  });

  it('excludes an empty status_name (pre-v007 default) from status_changed on either side', async () => {
    h.answers.push({ rows: [{}] }, { rows: [{ n: 0 }] }, { rows: [{ n: 0 }] });
    await baselineRepo.diffCounts(10, 20);
    expect(h.calls[0].query).toContain("l.status_name <> ''");
    expect(h.calls[0].query).toContain("r.status_name <> ''");
  });
});

describe('diffPage', () => {
  it('classifies a same-version, same-links, different-status row as status-changed', async () => {
    h.answers.push(
      { rows: [{ issue_id: '1', lv: 100, rv: 100, lh: 'h1', rh: 'h1', ls: 'To Do', rs: 'Done' }] },
      { rows: [] },
      { rows: [{ id: 100, issue_key: 'REQ-1', summary: 'Sum 1' }] },
    );
    expect(await baselineRepo.diffPage(10, 20, '', 50)).toEqual([{
      issueId: '1', issueKey: 'REQ-1', summary: 'Sum 1', change: 'status-changed', leftStatus: 'To Do', rightStatus: 'Done',
    }]);
  });

  it('widens the left-side WHERE clause to surface a status-only change, excluding an empty status_name on either side', async () => {
    h.answers.push({ rows: [] }, { rows: [] });
    await baselineRepo.diffPage(10, 20, '', 50);
    expect(h.calls[0].query).toContain("(l.status_name <> '' AND r.status_name <> '' AND l.status_name <> r.status_name)");
  });

  it('treats a row with an empty status_name on one or both sides as unchanged, not status-changed', async () => {
    h.answers.push(
      { rows: [
        { issue_id: '1', lv: 100, rv: 100, lh: 'h1', rh: 'h1', ls: '', rs: 'Done' },
        { issue_id: '2', lv: 100, rv: 100, lh: 'h1', rh: 'h1', ls: '', rs: '' },
      ] },
      { rows: [] },
      { rows: [{ id: 100, issue_key: 'REQ-1', summary: 'Sum 1' }] },
    );
    const page = await baselineRepo.diffPage(10, 20, '', 50);
    expect(page.map((r) => r.change)).toEqual(['unchanged', 'unchanged']);
  });

  it('keeps issue-id ordering and the limit across left-side and added-side rows', async () => {
    h.answers.push(
      { rows: [{ issue_id: '3', lv: 1, rv: 2, lh: 'a', rh: 'a', ls: 'To Do', rs: 'To Do' }] },
      { rows: [{ issue_id: '1', lv: null, rv: 9, lh: null, rh: 'x', ls: null, rs: 'To Do' }] },
      { rows: [{ id: 1, issue_key: 'REQ-A', summary: 'A' }, { id: 2, issue_key: 'REQ-B', summary: 'B' }, { id: 9, issue_key: 'REQ-C', summary: 'C' }] },
    );
    const page = await baselineRepo.diffPage(10, 20, '', 50);
    expect(page.map((r) => r.issueId)).toEqual(['1', '3']);
    expect(page[0].change).toBe('added');
    expect(page[1].change).toBe('changed');
  });

  it('returns an empty page without querying issue_version when nothing differs', async () => {
    h.answers.push({ rows: [] }, { rows: [] });
    expect(await baselineRepo.diffPage(10, 20, '', 50)).toEqual([]);
    expect(h.calls).toHaveLength(2);
  });
});
