import { describe, expect, it } from 'vitest';
import { fakeJira } from '../fakeJira.js';
import { createBoardCompute } from '../../src/compute/boards.js';

const jira = fakeJira({
  boards: [{ id: 7, name: 'DEMO board' }],
  sprints: { 7: [{ id: 1, state: 'closed', completeDate: '2026-01-14T00:00:00Z' }, { id: 2, state: 'active' }, { id: 3, state: 'future' }] },
});

describe('board compute', () => {
  it('previousSprint and nextSprint compile to the native sprint clause', async () => {
    const compute = createBoardCompute({ jira });
    expect(await compute.previousSprint({ board: 'demo board' })).toEqual({ native: 'sprint = 1' });
    expect(await compute.nextSprint({ board: '7' })).toEqual({ native: 'sprint = 3' });
  });
  it('matches nothing when the board has no such sprint', async () => {
    const empty = createBoardCompute({ jira: fakeJira({ boards: [{ id: 8, name: 'B' }] }) });
    expect(await empty.previousSprint({ board: 'B' })).toEqual({ native: 'id = -1' });
  });
  it('names a missing board', async () => {
    expect(await createBoardCompute({ jira }).nextSprint({ board: 'Nope' })).toEqual({ error: 'Board "Nope" not found' });
  });
  it('asks for the id when two boards share the name', async () => {
    const twins = createBoardCompute({ jira: fakeJira({ boards: [{ id: 4, name: 'Team' }, { id: 5, name: 'team' }] }) });
    expect(await twins.nextSprint({ board: 'Team' })).toEqual({ error: 'Board "Team" matches 2 items; use its id' });
  });
  it('reads a numeric argument as the board id before a board named so', async () => {
    const numeric = createBoardCompute({ jira: fakeJira({ boards: [{ id: 9, name: '4' }, { id: 4, name: 'Four' }] }) });
    expect(await numeric.boardOf('4')).toEqual({ item: { id: 4, name: 'Four' } });
  });
  it('reads a numeric argument as a board name when no board has that id', async () => {
    const numeric = createBoardCompute({ jira: fakeJira({ boards: [{ id: 9, name: '42' }] }) });
    expect(await numeric.boardOf('42')).toEqual({ item: { id: 9, name: '42' } });
  });
});
