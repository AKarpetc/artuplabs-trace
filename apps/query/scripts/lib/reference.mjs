import { api, bulk, ids } from './http.mjs';

const byNum = (a, b) => Number(a) - Number(b);
const uniq = (list) => [...new Set(list.map(String))].sort(byNum);
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

async function must(jql) {
  const r = await ids(jql);
  if (r.error) throw new Error(`${jql}: ${r.error}`);
  return r.ids;
}

let me = null;

/** Account id of the user the tool runs as. */
export async function myAccountId() {
  me = me ?? (await api('GET', '/rest/api/3/myself')).accountId;
  return me;
}

async function children(parentIds) {
  const out = [];
  for (const part of chunk(parentIds, 500)) out.push(...(await must(`parent in (${part.join(',')})`)));
  return out;
}

function linkPasses(link, type) {
  if (!type) return true;
  const want = type.trim().toLowerCase();
  if (link.type.name === type.trim()) return true;
  if (link.outwardIssue && link.type.outward.toLowerCase() === want) return true;
  if (link.inwardIssue && link.type.inward.toLowerCase() === want) return true;
  const isDescription = [link.type.outward, link.type.inward].some((d) => d.toLowerCase() === want);
  return !isDescription && link.type.name.toLowerCase() === want;
}

/** Ids at the other end of an issue's links of the given type name or direction description, the direction read from issuelinks. */
export const linkedOthers = (issue, type) => (issue.fields.issuelinks ?? []).filter((l) => linkPasses(l, type)).map((l) => String((l.outwardIssue ?? l.inwardIssue).id));

async function closure(starts, depth, type) {
  const expanded = new Set();
  const reached = new Set();
  let frontier = uniq(starts);
  for (let level = 0; level < Math.min(depth, 10) && frontier.length; level += 1) {
    frontier.forEach((id) => expanded.add(id));
    const next = new Set();
    for (const x of await bulk(frontier, ['issuelinks'])) {
      for (const o of linkedOthers(x, type)) {
        reached.add(o);
        if (!expanded.has(o)) next.add(o);
      }
    }
    frontier = [...next];
  }
  return uniq([...reached]);
}

/** Board id from an id or an exact (case-insensitive) board name. */
export async function boardId(arg) {
  if (/^\d+$/.test(String(arg))) return Number(arg);
  const page = await api('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(arg)}`);
  const exact = page.values.filter((b) => b.name.toLowerCase() === String(arg).toLowerCase());
  if (exact.length !== 1) throw new Error(`board ${arg}: ${exact.length} matches`);
  return exact[0].id;
}

/** Sprints of a board in one state, every page. */
export async function sprintsOf(board, state) {
  const out = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await api('GET', `/rest/agile/1.0/board/${board}/sprint?state=${state}&startAt=${startAt}&maxResults=50`);
    out.push(...page.values);
    if (page.isLast || !page.values.length) return out;
  }
}

async function sprintIssues(sprintId) {
  const out = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await api('GET', `/rest/agile/1.0/sprint/${sprintId}/issue?fields=id&startAt=${startAt}&maxResults=100`);
    out.push(...page.issues.map((x) => String(x.id)));
    if (startAt + page.issues.length >= page.total || !page.issues.length) return uniq(out);
  }
}

/** Reference results by REST traversal, written without the app's code. */
export const REFERENCES = {
  async subtasksOf([q]) {
    const inner = new Set(await must(q));
    return uniq((await bulk(await must('issuetype in subTaskIssueTypes()'), ['parent'])).filter((x) => inner.has(String(x.fields.parent?.id))).map((x) => x.id));
  },
  async parentsOf([q]) {
    return uniq((await bulk(await must(q), ['parent'])).map((x) => x.fields.parent?.id).filter(Boolean));
  },
  async epicsOf([q]) {
    let level = await bulk(await must(q), ['parent', 'issuetype']);
    const out = [];
    for (let step = 0; step < 3 && level.length; step += 1) {
      const up = [];
      for (const x of level) {
        const p = x.fields.parent;
        if (!p || x.fields.issuetype.hierarchyLevel >= 1) continue;
        if (p.fields?.issuetype?.hierarchyLevel === 1) out.push(p.id);
        else up.push(p.id);
      }
      level = up.length ? await bulk(uniq(up), ['parent', 'issuetype']) : [];
    }
    return uniq(out);
  },
  async issuesInEpics([q]) {
    const epics = (await bulk(await must(q), ['issuetype'])).filter((x) => x.fields.issuetype.hierarchyLevel === 1).map((x) => String(x.id));
    return uniq(await children(epics));
  },
  async childIssuesOf([q, depth]) {
    let frontier = await must(q);
    const seen = new Set(frontier);
    const out = new Set();
    for (let level = 0; level < Number(depth ?? 10) && frontier.length; level += 1) {
      const kids = await children(frontier);
      kids.forEach((k) => out.add(k));
      frontier = kids.filter((k) => !seen.has(k));
      frontier.forEach((k) => seen.add(k));
    }
    return uniq([...out]);
  },
  async linkedIssuesOf([q, type]) {
    return uniq((await bulk(await must(q), ['issuelinks'])).flatMap((x) => linkedOthers(x, type)));
  },
  linkedIssuesOfRecursive: async ([q, type]) => closure(await must(q), 10, type),
  linkedIssuesOfRecursiveLimited: async ([q, depth, type]) => closure(await must(q), Number(depth), type),
  async hasLinks([type]) {
    return uniq((await bulk(await must('project is not EMPTY'), ['issuelinks'])).filter((x) => linkedOthers(x, type).length).map((x) => x.id));
  },
  hasLinkType: async ([type]) => REFERENCES.hasLinks([type]),
  async hasSubtasks() {
    return uniq((await bulk(await must('issuetype in subTaskIssueTypes()'), ['parent'])).map((x) => x.fields.parent?.id).filter(Boolean));
  },
  async previousSprint([board]) {
    const closed = (await sprintsOf(await boardId(board), 'closed')).sort((a, b) => Date.parse(b.completeDate) - Date.parse(a.completeDate) || b.id - a.id);
    return closed.length ? sprintIssues(closed[0].id) : [];
  },
  async nextSprint([board]) {
    const future = (await sprintsOf(await boardId(board), 'future')).sort((a, b) => (Date.parse(a.startDate ?? '') || Infinity) - (Date.parse(b.startDate ?? '') || Infinity) || a.id - b.id);
    return future.length ? sprintIssues(future[0].id) : [];
  },
};

const SPRINT_FIELD = 'customfield_10020';
const jiraMs = (v) => Date.parse(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const changelogCache = new Map();
const currentCache = new Map();

async function changelogOf(key) {
  if (changelogCache.has(key)) return changelogCache.get(key);
  const out = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await api('GET', `/rest/api/3/issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
    out.push(...page.values);
    if (page.isLast || !page.values.length) break;
  }
  changelogCache.set(key, out);
  return out;
}

/** Sprint field, status and creation time of today, fetched once per issue for every case of a run. */
async function currentOf(idList) {
  const missing = idList.filter((id) => !currentCache.has(String(id)));
  for (const x of await bulk(missing, [SPRINT_FIELD, 'status', 'created'])) currentCache.set(String(x.id), x.fields);
  return new Map(idList.map((id) => [String(id), currentCache.get(String(id)) ?? null]));
}

const sprintSet = (v) => new Set(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean));

async function sprintByName(board, name) {
  const all = await sprintsOf(await boardId(board), 'active,closed,future');
  return name === undefined ? all.find((s) => s.state === 'active') : all.find((s) => s.name === name || String(s.id) === String(name));
}

async function sprintChanges(candidates, sprintId) {
  const out = [];
  for (const id of candidates) {
    for (const h of await changelogOf(id)) {
      for (const item of h.items.filter((i) => i.field === 'Sprint')) {
        const had = sprintSet(item.from).has(String(sprintId));
        const has = sprintSet(item.to).has(String(sprintId));
        if (had !== has) out.push({ id, at: jiraMs(h.created), added: has });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Issues created inside the sprint (no Sprint change adds them): the first change removes them, or none touches it and the field holds it today. */
async function createdInside(candidates, sprintId, changes) {
  const first = new Map();
  for (const c of changes) if (!first.has(c.id)) first.set(c.id, c.added);
  const current = await currentOf(candidates);
  return candidates.filter((id) => (first.has(id) ? first.get(id) === false : (current.get(String(id))?.[SPRINT_FIELD] ?? []).some((x) => String(x.id) === String(sprintId))))
    .map((id) => ({ id, at: jiraMs(current.get(String(id))?.created), added: true }));
}

const windowOf = (s) => ({ start: jiraMs(s.activatedDate ?? s.startDate), end: s.completeDate ? jiraMs(s.completeDate) : Infinity });

Object.assign(REFERENCES, {
  async addedAfterSprintStart([board, sprint], { candidates }) {
    const s = await sprintByName(board, sprint);
    const { start, end } = windowOf(s);
    const all = await must(candidates);
    const changes = await sprintChanges(all, s.id);
    const added = [...changes, ...(await createdInside(all, s.id, changes))];
    return uniq(added.filter((c) => c.added && c.at > start && c.at <= end).map((c) => c.id));
  },
  async removedAfterSprintStart([board, sprint], { candidates }) {
    const s = await sprintByName(board, sprint);
    const { start, end } = windowOf(s);
    const changes = (await sprintChanges(await must(candidates), s.id)).filter((c) => c.at <= end);
    const last = new Map(changes.map((c) => [c.id, c]));
    return uniq([...new Set(changes.filter((c) => !c.added && c.at > start).map((c) => c.id))].filter((id) => !last.get(id).added));
  },
  async completeInSprint(args, options) {
    return (await outcomeRef(args, options)).complete;
  },
  async incompleteInSprint(args, options) {
    return (await outcomeRef(args, options)).incomplete;
  },
});

async function outcomeRef([board, sprint], { candidates }) {
  const s = await sprintByName(board, sprint);
  const t = s.completeDate ? jiraMs(s.completeDate) : Date.now();
  const statuses = new Map((await api('GET', '/rest/api/3/status')).map((x) => [String(x.id), x.statusCategory.key]));
  const all = await must(candidates);
  const current = await currentOf(all);
  const complete = [];
  const incomplete = [];
  for (const id of all) {
    const log = await changelogOf(id);
    const fields = current.get(String(id));
    const sprintItems = log.flatMap((h) => h.items.filter((i) => i.field === 'Sprint').map((i) => ({ at: jiraMs(h.created), from: i.from, to: i.to })));
    const before = sprintItems.filter((i) => i.at <= t).at(-1);
    const after = sprintItems.find((i) => i.at > t);
    const value = before ? sprintSet(before.to) : after ? sprintSet(after.from) : new Set((fields?.[SPRINT_FIELD] ?? []).map((x) => String(x.id)));
    if (!value.has(String(s.id))) continue;
    const statusItems = log.flatMap((h) => h.items.filter((i) => i.fieldId === 'status').map((i) => ({ at: jiraMs(h.created), from: i.from, to: i.to })));
    const sb = statusItems.filter((i) => i.at <= t).at(-1);
    const sa = statusItems.find((i) => i.at > t);
    const statusId = sb ? sb.to : sa ? sa.from : fields?.status?.id;
    (statuses.get(String(statusId)) === 'done' ? complete : incomplete).push(id);
  }
  return { complete: uniq(complete), incomplete: uniq(incomplete) };
}

const SCOPE = 'project in (JQLG, RPT)';
const DAY = 86400000;
const commentCache = new Map();

async function allComments(scopeJql) {
  if (commentCache.has(scopeJql)) return commentCache.get(scopeJql);
  const out = [];
  for (const x of await bulk(await must(scopeJql), ['comment', 'attachment', 'project'])) {
    let list = x.fields.comment?.comments ?? [];
    if ((x.fields.comment?.total ?? 0) > list.length) list = (await api('GET', `/rest/api/3/issue/${x.id}/comment?maxResults=5000`)).comments;
    out.push({ id: String(x.id), project: x.fields.project.key, comments: list.filter((c) => !c.visibility), attachments: x.fields.attachment ?? [] });
  }
  commentCache.set(scopeJql, out);
  return out;
}

const words = (text) => [...String(text ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const lower = (v) => String(v ?? '').toLowerCase();
const bareExt = (v) => lower(v).replace(/^\.+/, '');

function dateOf(text) {
  const rel = /^-(\d+)([dhm])$/.exec(text);
  if (rel) return Date.now() - Number(rel[1]) * { d: DAY, h: 3600000, m: 60000 }[rel[2]];
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00Z`);
  throw new Error(`reference: unsupported date ${text}`);
}

async function membersOfGroup(name) {
  const out = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await api('GET', `/rest/api/3/group/member?groupname=${encodeURIComponent(name)}&includeInactiveUsers=true&startAt=${startAt}&maxResults=50`);
    out.push(...page.values.map((u) => u.accountId));
    if (page.isLast || !page.values.length) return new Set(out);
  }
}

async function membersOfRole(projectKey, roleName) {
  const roles = await api('GET', `/rest/api/3/project/${projectKey}/role`);
  const url = Object.entries(roles).find(([name]) => lower(name) === lower(roleName))?.[1];
  if (!url) return new Set();
  const role = await api('GET', `/rest/api/3/project/${projectKey}/role/${String(url).split('/').pop()}`);
  const out = (role.actors ?? []).filter((a) => a.actorUser).map((a) => a.actorUser.accountId);
  for (const a of (role.actors ?? []).filter((x) => x.actorGroup)) out.push(...(await membersOfGroup(a.actorGroup.name)));
  return new Set(out);
}

const DATE_TESTS = {
  after: (t) => (item) => jiraMs(item.created) > t,
  before: (t) => (item) => jiraMs(item.created) < t,
  on: (t) => {
    const day = Math.floor(t / DAY) * DAY;
    return (item) => jiraMs(item.created) >= day && jiraMs(item.created) < day + DAY;
  },
};

/** Whether a file name ends with the extension of a condition, leading dots of the condition ignored. */
export const hasExtension = (filename, ext) => Boolean(bareExt(ext)) && lower(filename).endsWith(`.${bareExt(ext)}`);

/** Clause text → test of one comment visible to everyone or one attachment of a project, written apart from the app's parser. */
async function clauseTest(text, projects) {
  const w = words(text);
  const tests = [];
  for (let i = 0; i < w.length; i += 2) {
    const key = lower(w[i]);
    const value = w[i + 1];
    if (value === undefined) throw new Error(`reference: clause ${w[i]} has no value`);
    if (DATE_TESTS[key]) tests.push(DATE_TESTS[key](dateOf(value)));
    else if (key === 'by') {
      const people = /^[0-9a-f]{24}$|^\d+:[0-9a-f-]{36}$/i.test(value) ? [value] : (await api('GET', `/rest/api/3/user/search?query=${encodeURIComponent(value)}`)).map((u) => u.accountId);
      tests.push((item) => people.includes(item.author?.accountId));
    } else if (key === 'ext') tests.push((item) => hasExtension(item.filename, value));
    else if (key === 'ingroup') {
      const members = await membersOfGroup(value);
      tests.push((item) => members.has(item.author?.accountId));
    } else if (key === 'inrole') {
      const byProject = new Map();
      for (const p of projects) byProject.set(p, await membersOfRole(p, value));
      tests.push((item, project) => byProject.get(project).has(item.author?.accountId));
    } else throw new Error(`reference: unsupported clause ${w[i]}`);
  }
  return (item, project) => tests.every((t) => t(item, project));
}

const latest = (comments) => [...comments].sort((a, b) => jiraMs(a.created) - jiraMs(b.created) || Number(a.id) - Number(b.id)).slice(-1);

/** Comment count test of a hasComments argument: none = any, "n" = exactly n, "+n" = more than n, "-n" = fewer than n (no comments included). */
export function commentCountTest(arg) {
  if (arg === undefined) return (count) => count >= 1;
  const m = /^\s*([+-]?)(\d+)\s*$/.exec(String(arg));
  if (!m) throw new Error(`reference: unsupported comment count ${arg}`);
  const n = Number(m[2]);
  return { '': (count) => count === n, '+': (count) => count > n, '-': (count) => count < n }[m[1]];
}

async function matching(text, scope, itemsOf) {
  const issues = await allComments(scope);
  const test = await clauseTest(text, [...new Set(issues.map((x) => x.project))]);
  return uniq(issues.filter((x) => itemsOf(x).some((item) => test(item, x.project))).map((x) => x.id));
}

Object.assign(REFERENCES, {
  commented: ([text = ''], { scope = SCOPE } = {}) => matching(text, scope, (x) => x.comments),
  lastComment: ([text = ''], { scope = SCOPE } = {}) => matching(text, scope, (x) => latest(x.comments)),
  fileAttached: ([text = ''], { scope = SCOPE } = {}) => matching(text, scope, (x) => x.attachments),
  async hasComments([n], { scope = SCOPE } = {}) {
    const passes = commentCountTest(n);
    return uniq((await allComments(scope)).filter((x) => passes(x.comments.length)).map((x) => x.id));
  },
  async hasAttachments([ext], { scope = SCOPE } = {}) {
    return uniq((await allComments(scope)).filter((x) => x.attachments.some((a) => ext === undefined || hasExtension(a.filename, ext))).map((x) => x.id));
  },
});

const DURATION_REF = { date: { m: 60000, h: 3600000, d: 86400000, w: 604800000 }, number: { m: 60, h: 3600, d: 28800, w: 144000 } };
const FIELD_ALIAS = { originalestimate: 'timeoriginalestimate', remainingestimate: 'timeestimate', due: 'duedate', resolved: 'resolutiondate' };
const COMMENT_BOUNDS = new Set(['firstcommented', 'lastcommented']);
const CMP_REF = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };

/** Expression text → { test(get), fields }, written apart from the app's parser. */
export function compileExpression(text, mode) {
  const tokens = [...String(text).matchAll(/(\d+(?:\.\d+)?)([wdhm])?(?![\w])|([A-Za-z_][\w.]*)|"([^"]*)"|(<=|>=|!=|==|&&|\|\||[=<>+\-*/()])|(\S)/g)];
  const fields = new Set();
  let i = 0;
  const op = () => tokens[i]?.[5] ?? (['and', 'or'].includes(String(tokens[i]?.[3]).toLowerCase()) ? String(tokens[i][3]).toLowerCase() : undefined);
  const fail = () => {
    throw new Error(`reference: cannot read ${text}`);
  };
  const arith = (l, r, o) => (get) => {
    const a = l(get);
    const b = r(get);
    if (a === null || b === null) return null;
    if (o === '+') return a + b;
    if (o === '-') return a - b;
    if (o === '*') return a * b;
    return b === 0 ? null : a / b;
  };
  function atom() {
    const t = tokens[i];
    i += 1;
    if (!t || t[6] !== undefined) return fail();
    if (t[1] !== undefined) {
      const v = Number(t[1]) * (t[2] ? DURATION_REF[mode][t[2]] : 1);
      return () => v;
    }
    if (t[5] === '(') {
      const start = i;
      let inner = sum();
      if (op() !== ')') {
        i = start;
        inner = or();
      }
      if (op() !== ')') return fail();
      i += 1;
      return inner;
    }
    if (t[5] === '-') {
      const e = atom();
      return (get) => (e(get) === null ? null : -e(get));
    }
    if (t[5] !== undefined) return fail();
    const quoted = t[4] !== undefined && COMMENT_BOUNDS.has(t[4].toLowerCase()) ? t[4].toLowerCase() : t[4];
    const name = quoted ?? FIELD_ALIAS[t[3].toLowerCase()] ?? t[3].toLowerCase();
    fields.add(name);
    return (get) => get(name);
  }
  function term() {
    let e = atom();
    while (op() === '*' || op() === '/') {
      const o = op();
      i += 1;
      e = arith(e, atom(), o);
    }
    return e;
  }
  function sum() {
    let e = term();
    while (op() === '+' || op() === '-') {
      const o = op();
      i += 1;
      e = arith(e, term(), o);
    }
    return e;
  }
  function cmp() {
    const l = sum();
    const o = op();
    if (!CMP_REF[o]) return fail();
    i += 1;
    const r = sum();
    return (get) => {
      const a = l(get);
      const b = r(get);
      return a !== null && b !== null && CMP_REF[o](a, b);
    };
  }
  function and() {
    let e = cmp();
    while (op() === 'and' || op() === '&&') {
      i += 1;
      const l = e;
      const r = cmp();
      e = (get) => l(get) && r(get);
    }
    return e;
  }
  function or() {
    let e = and();
    while (op() === 'or' || op() === '||') {
      i += 1;
      const l = e;
      const r = and();
      e = (get) => l(get) || r(get);
    }
    return e;
  }
  const test = or();
  if (i < tokens.length) fail();
  return { test, fields: [...fields] };
}

/** A REST field value as a number for the reference: numbers, numeric strings, dates (ms), votes and watch counts. */
export function valueOfField(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object') return ['votes', 'watchCount', 'value'].map((k) => raw[k]).find((v) => typeof v === 'number') ?? null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00:00Z`) : jiraMs(raw);
  return Number.isFinite(t) ? t : null;
}

/** Field id for a name the reference reads: the id first, else the one field with that display name. */
export function fieldIdOf(all, name) {
  const byId = all.find((x) => x.id.toLowerCase() === name.toLowerCase());
  const byName = byId ? [byId] : all.filter((x) => x.name.toLowerCase() === name.toLowerCase());
  if (byName.length !== 1) throw new Error(`reference: field ${name} matches ${byName.length} fields`);
  return byName[0].id;
}

async function fieldExpression([q, expr], mode) {
  const { test, fields } = compileExpression(expr, mode);
  const all = await api('GET', '/rest/api/3/field');
  const idOf = new Map(fields.filter((f) => !COMMENT_BOUNDS.has(f)).map((f) => [f, fieldIdOf(all, f)]));
  const inner = await must(q);
  const issues = idOf.size ? await bulk(inner, [...new Set(idOf.values())]) : inner.map((id) => ({ id, fields: {} }));
  const bounds = new Map();
  if (fields.some((f) => COMMENT_BOUNDS.has(f))) {
    for (const x of await allComments(q)) {
      const times = x.comments.map((c) => jiraMs(c.created));
      if (times.length) bounds.set(x.id, { firstcommented: Math.min(...times), lastcommented: Math.max(...times) });
    }
  }
  return uniq(issues.filter((x) => test((name) => (COMMENT_BOUNDS.has(name) ? bounds.get(String(x.id))?.[name] ?? null : valueOfField(x.fields[idOf.get(name)])))).map((x) => x.id));
}

Object.assign(REFERENCES, {
  dateCompare: (userArgs) => fieldExpression(userArgs, 'date'),
  expression: (userArgs) => fieldExpression(userArgs, 'number'),
});
