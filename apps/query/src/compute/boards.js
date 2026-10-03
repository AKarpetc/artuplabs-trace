import { lastClosed, matchBoard, nextFuture } from '../core/boards.js';
import { EMPTY } from '../core/jql-build.js';

/** Value sources of previousSprint/nextSprint: Jira's own `sprint = <id>` clause of the chosen sprint. */
export function createBoardCompute({ jira }) {
  const boardOf = async (arg) => matchBoard(await jira.boards(arg), arg);
  const sprintOf = (pick) => async ({ board }) => {
    const b = await boardOf(board);
    if (b.error) return b;
    const sprint = pick(await jira.sprints(b.item.id));
    return { native: sprint ? `sprint = ${sprint.id}` : EMPTY };
  };
  return { boardOf, previousSprint: sprintOf(lastClosed), nextSprint: sprintOf(nextFuture) };
}
