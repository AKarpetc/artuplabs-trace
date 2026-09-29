/** Issue tags and the Jira field each one reads; null means computed. */
export const ISSUE_TAGS = {
  key: null, url: null, summary: 'summary', status: 'status', assignee: 'assignee', reporter: 'reporter',
  priority: 'priority', type: 'issuetype', due: 'duedate', created: 'created', updated: 'updated',
  resolved: 'resolutiondate', resolution: 'resolution', labels: 'labels', components: 'components',
  fixVersions: 'fixVersions', project: 'project', parent: 'parent', description: 'description',
  environment: 'environment', timeSpent: 'timespent', estimate: 'timeoriginalestimate',
};

/** Tags available inside each loop, besides the issue and document tags of outer scopes. */
export const ITEM_TAGS = {
  comments: ['author', 'created', 'body'],
  worklogs: ['author', 'started', 'timeSpent', 'hours', 'comment'],
  subtasks: ['key', 'summary', 'status', 'type', 'url'],
  links: ['type', 'direction', 'key', 'summary', 'status', 'url'],
};

/** Tags that may be used rich ({{@tag}}) per scope. */
export const RICH_TAGS = {
  root: ['description', 'environment'],
  issues: ['description', 'environment'],
  comments: ['body', 'description', 'environment'],
  worklogs: ['comment', 'description', 'environment'],
  subtasks: ['description', 'environment'],
  links: ['description', 'environment'],
};

/** Tags describing the export itself. */
export const DOC_TAGS = ['jql', 'exportedBy', 'exportedAt', 'count', 'title', 'siteUrl'];

/** Loops allowed in each scope. */
export const LOOPS = {
  root: ['issues', 'comments', 'worklogs', 'subtasks', 'links'],
  issues: ['comments', 'worklogs', 'subtasks', 'links'],
};

/** A custom-field tag: field "Name". */
export const FIELD_TAG = /^field\s+"([^"]+)"$/;

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** Nearest candidate within two edits, ignoring case; null when none is close. */
export function suggest(name, candidates) {
  let best = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = distance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

const own = (table, scope) => (Object.hasOwn(table, scope) ? table[scope] : []);

const allowedIn = (scope) => [...own(ITEM_TAGS, scope), ...Object.keys(ISSUE_TAGS), ...DOC_TAGS];

/** Checks template tags against the vocabulary of their scope; returns the errors found. */
export function checkTemplateTags(tags, { fieldNames = [] } = {}) {
  const errors = [];
  const known = new Set(fieldNames.map((n) => n.toLowerCase()));
  const walk = (list, scope) => list.forEach((tag) => visit(tag, scope));
  const visit = (tag, scope) => {
    const field = FIELD_TAG.exec(tag.name);
    if (field) {
      if (!known.has(field[1].toLowerCase())) {
        errors.push({ kind: 'unknown-field', tag: tag.name, suggestion: suggest(field[1], fieldNames) });
      }
      if (tag.kind === 'loop') walk(tag.children, scope);
      return;
    }
    if (tag.kind === 'loop' && own(LOOPS, scope).includes(tag.name)) {
      walk(tag.children, tag.name);
      return;
    }
    const allowed = allowedIn(scope);
    if (!allowed.includes(tag.name)) {
      errors.push({ kind: 'unknown-tag', tag: tag.name, suggestion: suggest(tag.name, allowed) });
      return;
    }
    if (tag.kind === 'raw' && !own(RICH_TAGS, scope).includes(tag.name)) {
      errors.push({ kind: 'not-rich', tag: tag.name });
      return;
    }
    if (tag.kind === 'loop') walk(tag.children, scope);
  };
  walk(tags, 'root');
  return errors;
}

/** Every tag name at any depth, in document order. */
export function flattenTags(tags) {
  return tags.flatMap((tag) => [tag.name, ...flattenTags(tag.children ?? [])]);
}
