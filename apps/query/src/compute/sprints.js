import { activeSprint, matchBoard, matchSprint, sprintWindow } from '../core/boards.js';
import { FAIL } from '../core/errors.js';
import { addedAfterStart, createdInSprint, removedAfterStart, sprintOutcome, toMs } from '../core/sprint-history.js';

const result = (ids) => ({ ids, field: 'id', watch: null });

/**
 * Value sources of the sprint history functions over the SQL index and live sprint membership. Without a sprint argument the board's
 * active sprint is read; an issue created inside the sprint has no sprint change and counts as added at its creation time.
 */
export function createSprintCompute({ jira, repo, state, now }) {
  async function resolve({ board, sprint }) {
    const b = matchBoard(await jira.boards(board), board);
    if (b.error) return b;
    const projectKey = b.item.location?.projectKey;
    if (projectKey && (await state.excluded()).includes(projectKey)) return FAIL.excluded(projectKey);
    const sprints = await jira.sprints(b.item.id);
    if (sprint === undefined) {
      const active = activeSprint(sprints);
      return active ? { sprint: active } : FAIL.notFound('Active sprint of board', board);
    }
    const s = matchSprint(sprints, sprint);
    return s.error ? s : { sprint: s.item };
  }

  async function creations(sprintId, events) {
    const ids = createdInSprint(await jira.searchIds(`sprint = ${sprintId}`), events, sprintId);
    if (!ids.length) return [];
    return (await jira.bulkIssues(ids, ['created']))
      .map((x) => ({ issueId: String(x.id), sprintId, kind: 'added', at: toMs(x.fields?.created), changeId: '0' }))
      .filter((e) => e.at !== null);
  }

  async function addedAfterSprintStart(args) {
    const r = await resolve(args);
    if (r.error) return r;
    const sprintId = String(r.sprint.id);
    const events = await repo.sprintEventsOf(sprintId);
    return result(addedAfterStart([...events, ...(await creations(sprintId, events))], sprintId, sprintWindow(r.sprint)));
  }

  async function removedAfterSprintStart(args) {
    const r = await resolve(args);
    if (r.error) return r;
    const sprintId = String(r.sprint.id);
    return result(removedAfterStart(await repo.sprintEventsOf(sprintId), sprintId, sprintWindow(r.sprint)));
  }

  const outcome = (which) => async (args) => {
    const r = await resolve(args);
    if (r.error) return r;
    const sprintId = String(r.sprint.id);
    const currentIds = await jira.searchIds(`sprint = ${sprintId}`);
    const events = await repo.sprintEventsOf(sprintId);
    const members = [...new Set([...currentIds.map(String), ...events.map((e) => e.issueId)])];
    const currentCategory = new Map((await jira.bulkIssues(members, ['status'])).map((x) => [String(x.id), x.fields?.status?.statusCategory?.key ?? 'new']));
    const split = sprintOutcome({ sprintId, window: sprintWindow(r.sprint), now: now(), currentIds, events, statusByIssue: await repo.statusEventsOf(members), currentCategory });
    return result(split[which]);
  };

  return {
    addedAfterSprintStart,
    removedAfterSprintStart,
    completeInSprint: outcome('complete'),
    incompleteInSprint: outcome('incomplete'),
  };
}
