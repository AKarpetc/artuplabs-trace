import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ enqueued: [] }));
vi.mock('@forge/sql', () => ({
  migrationRunner: {
    enqueue(name, statement) {
      h.enqueued.push({ name, statement });
      return this;
    },
    run: vi.fn(async () => h.enqueued.map((m) => m.name)),
  },
  sql: {},
}));
const { runMigrations } = await import('../../src/infra/schema.js');

describe('runMigrations', () => {
  it('creates the sprint, comment and attachment tables in order with idempotent keys', async () => {
    await runMigrations();
    expect(h.enqueued.map((m) => m.name)).toEqual(['v001_sprint', 'v002_sprint_event', 'v003_status_event', 'v004_comment_meta', 'v005_attachment_meta']);
    expect(h.enqueued[1].statement).toContain('PRIMARY KEY (change_id, issue_id, sprint_id, kind)');
    expect(h.enqueued[2].statement).toContain('PRIMARY KEY (change_id, issue_id)');
    expect(h.enqueued[3].statement).toContain('comment_id BIGINT PRIMARY KEY');
    expect(h.enqueued[4].statement).toContain('attachment_id BIGINT PRIMARY KEY');
    expect(h.enqueued[4].statement).toContain('ext VARCHAR(32) NOT NULL');
    expect(h.enqueued.every((m) => m.statement.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });
});
