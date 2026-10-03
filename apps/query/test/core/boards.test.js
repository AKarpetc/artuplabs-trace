import { describe, expect, it } from 'vitest';
import { activeSprint, lastClosed, matchBoard, matchSprint, nextFuture, sprintWindow } from '../../src/core/boards.js';

const BOARDS = [{ id: 7, name: 'Team' }, { id: 8, name: 'team' }, { id: 9, name: '2024' }, { id: 2024, name: 'Ops' }];

describe('matchBoard', () => {
  it('prefers an id for a numeric argument', () => {
    expect(matchBoard(BOARDS, '2024')).toEqual({ item: BOARDS[3] });
  });
  it('falls back to the name when no board has that id', () => {
    expect(matchBoard([{ id: 9, name: '2024' }], '2024')).toEqual({ item: { id: 9, name: '2024' } });
  });
  it('refuses an ambiguous name and names a missing board', () => {
    expect(matchBoard(BOARDS, 'TEAM')).toEqual({ error: 'Board "TEAM" matches 2 items; use its id' });
    expect(matchBoard(BOARDS, 'Nope')).toEqual({ error: 'Board "Nope" not found' });
  });
});

describe('sprints', () => {
  const S = [
    { id: 1, name: 'S1', state: 'closed', startDate: '2026-01-01T00:00:00Z', completeDate: '2026-01-14T00:00:00Z' },
    { id: 2, name: 'S2', state: 'closed', startDate: '2026-01-15T00:00:00Z', activatedDate: '2026-01-15T09:00:00Z', completeDate: '2026-01-28T00:00:00Z' },
    { id: 3, name: 'S3', state: 'active', startDate: '2026-01-29T00:00:00Z' },
    { id: 5, name: 'S5', state: 'future' },
    { id: 4, name: 'S4', state: 'future', startDate: '2026-02-12T00:00:00Z' },
  ];
  it('finds a sprint by id or name', () => {
    expect(matchSprint(S, '2')).toEqual({ item: S[1] });
    expect(matchSprint(S, 's3')).toEqual({ item: S[2] });
  });
  it('uses the start date as the start', () => {
    expect(sprintWindow(S[1])).toEqual({ startAt: Date.parse('2026-01-15T00:00:00Z'), completeAt: Date.parse('2026-01-28T00:00:00Z') });
    expect(sprintWindow(S[2])).toEqual({ startAt: Date.parse('2026-01-29T00:00:00Z'), completeAt: null });
  });
  it('has no window for a sprint that never started', () => {
    expect(sprintWindow(S[3])).toEqual({ startAt: null, completeAt: null });
  });
  it('picks the active, last closed and next future sprint', () => {
    expect(activeSprint(S)).toEqual(S[2]);
    expect(lastClosed(S)).toEqual(S[1]);
    expect(nextFuture(S)).toEqual(S[4]);
    expect([activeSprint([]), lastClosed([]), nextFuture([])]).toEqual([null, null, null]);
  });
  it('picks the active sprint with the lowest id', () => {
    expect(activeSprint([{ id: 9, state: 'active' }, { id: 6, state: 'active' }])).toEqual({ id: 6, state: 'active' });
  });
  it('breaks ties between closed sprints by the higher id', () => {
    expect(lastClosed([{ id: 1, state: 'closed' }, { id: 3, state: 'closed' }, { id: 2, state: 'closed' }])).toEqual({ id: 3, state: 'closed' });
  });
  it('breaks ties between undated future sprints by the lower id', () => {
    expect(nextFuture([{ id: 8, state: 'future' }, { id: 7, state: 'future' }])).toEqual({ id: 7, state: 'future' });
  });
});
