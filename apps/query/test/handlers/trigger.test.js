import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { makeDeps } from './makeDeps.js';
import { changeId, onEvent } from '../../src/handlers/trigger.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/events/${name}.json`, import.meta.url), 'utf8'));

describe('onEvent', () => {
  it('journals the event and pushes one refresh when none is pending', async () => {
    const deps = makeDeps();
    await onEvent(deps, { eventType: 'avi:jira:created:issuelink', issueLink: { sourceIssueId: 1, destinationIssueId: 2 } });
    await onEvent(deps, { eventType: 'avi:jira:deleted:issuelink', issueLink: { sourceIssueId: 1, destinationIssueId: 3 } });
    expect((await deps.journal.read(10)).map((r) => r.value)).toEqual([{ ids: ['1', '2'], kinds: ['link'] }, { ids: ['1', '3'], kinds: ['link'] }]);
    expect(deps.pushed).toEqual([[{ kind: 'refresh', ts: 1000000 }, null]]);
  });
  it('pushes no refresh while a worker holds the lease', async () => {
    const deps = makeDeps();
    await deps.state.lease.set(999000);
    await onEvent(deps, fixture('issue-created'));
    expect(deps.pushed).toEqual([]);
  });
  it('pushes again once the pending mark is older than a lost job', async () => {
    const deps = makeDeps();
    await onEvent(deps, fixture('issue-created'));
    deps.advance(6 * 60 * 1000 + 1);
    await onEvent(deps, fixture('issue-deleted'));
    expect(deps.pushed).toHaveLength(2);
  });
  it('clears the pending mark when the push fails so the next event retries', async () => {
    const deps = makeDeps();
    deps.queue.push = async () => { throw new Error('rate'); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onEvent(deps, { eventType: 'avi:jira:created:issue', issue: { id: '5' } });
    error.mockRestore();
    expect(await deps.state.pending.get()).toBeNull();
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('writes index rows before the journal record', async () => {
    const order = [];
    const deps = makeDeps();
    deps.indexEvent = async () => { order.push('index'); };
    const append = deps.journal.append;
    deps.journal.append = async (...a) => { order.push('journal'); return append(...a); };
    await onEvent(deps, { eventType: 'avi:jira:created:issue', issue: { id: '5' } });
    expect(order).toEqual(['index', 'journal']);
  });
  it('hands the index the change id of the event', async () => {
    const seen = [];
    const deps = makeDeps({ indexEvent: async (event, meta) => { seen.push(meta); } });
    const event = fixture('issue-updated-status');
    await onEvent(deps, event);
    expect(seen).toEqual([{ changeId: changeId(event, deps.hash) }]);
  });
  it('journals a sprint event as a sprint change', async () => {
    const deps = makeDeps();
    await onEvent(deps, fixture('sprint-started'));
    await onEvent(deps, fixture('sprint-closed'));
    expect((await deps.journal.read(10)).map((r) => r.value)).toEqual([{ ids: [], kinds: ['sprint'] }, { ids: [], kinds: ['sprint'] }]);
  });
  it('journals an event of an unexpected shape as unknown', async () => {
    const deps = makeDeps();
    expect(await onEvent(deps, null)).toEqual({ ids: [], kinds: ['unknown'] });
    expect(await onEvent(deps, { eventType: 'avi:jira:updated:issue', issue: { id: 5 }, changelog: { items: 'x' } })).toEqual({ ids: ['5'], kinds: ['issue-updated'] });
  });
  it('prints field names and ids only when event debugging is on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await onEvent(makeDeps(), fixture('issue-updated-status'));
    await onEvent(makeDeps({ debugEvents: true }), fixture('issue-updated-status'));
    const lines = log.mock.calls.map(([line]) => line);
    log.mockRestore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'avi:jira:updated:issue', items: [['status', 'status']], record: { ids: ['10102'], kinds: ['issue-updated', 'status'] } });
    expect(lines[0]).not.toContain('JQLG-102');
  });
});

describe('changeId', () => {
  const hash = (s) => s;
  const updated = (changelogId, items, timestamp = 1790584137824) => ({ eventType: 'avi:jira:updated:issue', issue: { id: '10102' }, changelog: { id: changelogId, items }, timestamp });
  const items = [{ field: 'status', fieldId: 'status', from: '1', to: '3' }];
  it('does not depend on the changelog id', () => {
    expect(changeId(updated('20003', items), hash)).toBe(changeId(updated(undefined, items), hash));
  });
  it('tells apart changes of other items or another time', () => {
    const other = [{ field: 'status', fieldId: 'status', from: '3', to: '1' }];
    expect(new Set([changeId(updated('1', items), hash), changeId(updated('1', other), hash), changeId(updated('1', items, 1), hash)]).size).toBe(3);
  });
  it('reads an event without issue, time or items', () => {
    expect(changeId({}, hash)).toBe(changeId({ changelog: { items: 'x' } }, hash));
  });
});
