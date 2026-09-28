import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ enqueued: [] }));

vi.mock('@forge/sql', () => ({
  migrationRunner: {
    enqueue(name, statement) {
      h.enqueued.push({ name, statement });
      return this;
    },
    run: vi.fn(async () => h.enqueued.map((m) => m.name)),
  },
}));

const { runMigrations } = await import('../../src/infra/schema');

beforeEach(() => {
  h.enqueued.length = 0;
});

describe('runMigrations', () => {
  it('erases any previously stored confirmed_by account id, idempotently', async () => {
    await runMigrations();
    const migration = h.enqueued.find((m) => m.name === 'v008_erase_link_confirmed_by');
    expect(migration.statement).toBe('UPDATE trace_link SET confirmed_by = NULL WHERE confirmed_by IS NOT NULL');
  });

  it('erases any previously stored created_by account id, idempotently', async () => {
    await runMigrations();
    const migration = h.enqueued.find((m) => m.name === 'v009_erase_baseline_created_by');
    expect(migration.statement).toBe("UPDATE baseline SET created_by = '' WHERE created_by <> ''");
  });

  it('keeps the confirmed_by and created_by columns instead of dropping them', async () => {
    await runMigrations();
    const createLink = h.enqueued.find((m) => m.name === 'v002_trace_link');
    const createBaseline = h.enqueued.find((m) => m.name === 'v004_baseline');
    expect(createLink.statement).toContain('confirmed_by VARCHAR(128)');
    expect(createBaseline.statement).toContain('created_by VARCHAR(128) NOT NULL');
  });
});
