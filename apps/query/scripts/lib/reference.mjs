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
