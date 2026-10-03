import { COUNT_MAX, MAX_DEPTH } from './limits.js';

const SUBQUERY = { name: 'subquery', type: 'jql', required: true };
const LINK_TYPE = { name: 'linkType', type: 'text', required: false };
const BOARD = { name: 'board', type: 'text', required: true };
const SPRINT = { name: 'sprint', type: 'text', required: true };
const SPRINT_OPTIONAL = { ...SPRINT, required: false };
const DEPTH = { name: 'depth', type: 'int', required: false, min: 1, max: MAX_DEPTH };
const CLAUSES = { name: 'clauses', type: 'clauses', required: false };
const EXPRESSION = { name: 'expression', type: 'text', required: true };
const COMMENT_COUNT = { name: 'count', type: 'count', required: false, min: 1, max: COUNT_MAX };

const fn = (name, key, group, family, args, examples) => ({ name, key, group, family, args, examples });

/** Every function of ArtUp Query: group = unit of build and of the v1.1 rule, family = what makes a result stale. */
export const FUNCTIONS = [
  fn('subtasksOf', 'subtasks-of', 'query', 'query', [SUBQUERY], ['issue in subtasksOf("project = DEMO AND status = \\"In Progress\\"")']),
  fn('parentsOf', 'parents-of', 'query', 'query', [SUBQUERY], ['issue in parentsOf("project = DEMO AND type = Sub-task AND status = Done")']),
  fn('epicsOf', 'epics-of', 'query', 'query', [SUBQUERY], ['issue in epicsOf("fixVersion = 2.0")']),
  fn('issuesInEpics', 'issues-in-epics', 'query', 'query', [SUBQUERY], ['issue in issuesInEpics("project = DEMO AND status = Done")']),
  fn('childIssuesOf', 'child-issues-of', 'query', 'query', [SUBQUERY, DEPTH], ['issue in childIssuesOf("key = DEMO-1")', 'issue in childIssuesOf("project = DEMO AND type = Epic", "1")']),
  fn('linkedIssuesOf', 'linked-issues-of', 'query', 'query', [SUBQUERY, LINK_TYPE], ['issue in linkedIssuesOf("project = DEMO AND status = Open", "blocks")']),
  fn('linkedIssuesOfRecursive', 'linked-issues-of-recursive', 'query', 'query', [SUBQUERY, LINK_TYPE], ['issue in linkedIssuesOfRecursive("key = DEMO-1", "is blocked by")']),
  fn('linkedIssuesOfRecursiveLimited', 'linked-issues-of-recursive-limited', 'query', 'query', [SUBQUERY, { ...DEPTH, required: true }, LINK_TYPE], ['issue in linkedIssuesOfRecursiveLimited("key = DEMO-1", "3", "blocks")']),
  fn('hasLinks', 'has-links', 'site', 'links', [LINK_TYPE], ['issue in hasLinks("blocks")']),
  fn('hasLinkType', 'has-link-type', 'site', 'links', [{ ...LINK_TYPE, required: true }], ['issue in hasLinkType("Duplicate")']),
  fn('hasSubtasks', 'has-subtasks', 'site', 'subtasks', [], ['project = DEMO AND issue in hasSubtasks()']),
  fn('previousSprint', 'previous-sprint', 'board', 'board', [BOARD], ['issue in previousSprint("DEMO board")']),
  fn('nextSprint', 'next-sprint', 'board', 'board', [BOARD], ['issue in nextSprint("DEMO board")']),
  fn('addedAfterSprintStart', 'added-after-sprint-start', 'sprint', 'sprint', [BOARD, SPRINT_OPTIONAL], ['issue in addedAfterSprintStart("DEMO board")', 'issue in addedAfterSprintStart("DEMO board", "DEMO Sprint 7")']),
  fn('removedAfterSprintStart', 'removed-after-sprint-start', 'sprint', 'sprint', [BOARD, SPRINT_OPTIONAL], ['issue in removedAfterSprintStart("DEMO board")']),
  fn('incompleteInSprint', 'incomplete-in-sprint', 'sprint', 'sprint', [BOARD, SPRINT], ['issue in incompleteInSprint("DEMO board", "DEMO Sprint 6")']),
  fn('completeInSprint', 'complete-in-sprint', 'sprint', 'sprint', [BOARD, SPRINT], ['issue in completeInSprint("DEMO board", "DEMO Sprint 6")']),
  fn('commented', 'commented', 'comment', 'comment', [CLAUSES], ['issue in commented("after -7d inRole Developers")']),
  fn('lastComment', 'last-comment', 'comment', 'comment', [CLAUSES], ['issue in lastComment("before -14d")']),
  fn('hasComments', 'has-comments', 'comment', 'comment', [COMMENT_COUNT], ['issue in hasComments("5")', 'issue in hasComments("+5")', 'issue in hasComments("-3")']),
  fn('fileAttached', 'file-attached', 'attachment', 'attachment', [CLAUSES], ['issue in fileAttached("after startOfWeek() ext pdf")']),
  fn('hasAttachments', 'has-attachments', 'attachment', 'attachment', [{ name: 'extension', type: 'ext', required: false }], ['issue in hasAttachments("xlsx")']),
  fn('dateCompare', 'date-compare', 'fields', 'query', [SUBQUERY, EXPRESSION], ['issue in dateCompare("project = DEMO", "resolutiondate > duedate")']),
  fn('expression', 'expression', 'fields', 'query', [SUBQUERY, EXPRESSION], ['issue in expression("project = DEMO", "timespent > originalestimate * 1.2")']),
];

/** Functions by name. */
export const FUNCTION_BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));

/** Groups whose code is built and declared in the manifest. */
export const SHIPPED_GROUPS = ['query', 'site', 'board'];

/** Functions of the shipped groups, in catalog order. */
export function shippedFunctions() {
  return FUNCTIONS.filter((f) => SHIPPED_GROUPS.includes(f.group));
}

/** `name(required, [optional])`. */
export function usage(f) {
  return `${f.name}(${f.args.map((a) => (a.required ? a.name : `[${a.name}]`)).join(', ')})`;
}
