import { sortIds } from './ids.js';

const PARENT_FIELDS = new Set(['IssueParentAssociation', 'parent', 'Parent', 'Epic Link']);
const NUMERIC = /^\d+$/;
const SPRINT_EVENT = /^avi:jira-software:(created|started|updated|closed|deleted):sprint$/;

function changeKind(item) {
  if (PARENT_FIELDS.has(item.field) || item.fieldId === 'parent') return 'parent';
  if (item.field === 'Sprint') return 'sprint-field';
  if (item.fieldId === 'status' || item.field === 'status') return 'status';
  return null;
}

/** Issue ids an event touches and the kinds of change it carries; an unrecognised event is `unknown`. */
export function eventRecord(event) {
  const type = String(event?.eventType ?? '');
  const ids = new Set();
  const kinds = new Set();
  const add = (value) => {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (NUMERIC.test(s)) ids.add(s);
  };
  add(event?.issue?.id);
  add(event?.issue?.fields?.parent?.id);
  if (type === 'avi:jira:created:issue') kinds.add('issue-created');
  else if (type === 'avi:jira:deleted:issue') kinds.add('issue-deleted');
  else if (type === 'avi:jira:updated:issue') {
    kinds.add('issue-updated');
    const items = Array.isArray(event?.changelog?.items) ? event.changelog.items : [];
    for (const item of items.filter((i) => i && typeof i === 'object')) {
      const kind = changeKind(item);
      if (kind) kinds.add(kind);
      if (kind === 'parent') {
        add(item.from);
        add(item.to);
      }
    }
  } else if (type === 'avi:jira:created:issuelink' || type === 'avi:jira:deleted:issuelink') {
    kinds.add('link');
    add(event?.sourceIssueId);
    add(event?.destinationIssueId);
    add(event?.issueLink?.sourceIssueId);
    add(event?.issueLink?.destinationIssueId);
  } else if (SPRINT_EVENT.test(type)) kinds.add('sprint');
  else if (type === 'avi:jira:commented:issue' || type === 'avi:jira:deleted:comment') kinds.add('comment');
  else if (type === 'avi:jira:created:attachment' || type === 'avi:jira:deleted:attachment') {
    kinds.add('attachment');
    add(event?.attachment?.issueId);
  } else kinds.add('unknown');
  return { ids: sortIds(ids), kinds: [...kinds].sort() };
}
