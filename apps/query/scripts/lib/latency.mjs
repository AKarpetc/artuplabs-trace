import { api, bulk, ids, sleep, write } from './http.mjs';
import { summary } from './report.mjs';

const POLL_MS = 2000;
const TIMEOUT_MS = 10 * 60 * 1000;
const round = (ms) => Math.round(ms / 100) / 10;

async function search(jql) {
  try {
    return await api('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: 1 }, { raw: true });
  } catch (error) {
    return { status: 0, text: String(error?.message ?? error) };
  }
}

/** Polls `(clause) AND id = X` until present (or absent): seconds from `since`, or null after 10 minutes (a lost change). */
export async function waitFor(clause, id, present, since) {
  for (;;) {
    const r = await search(`(${clause}) AND id = ${id}`);
    const found = r.status === 200 && JSON.parse(r.text).issues.length > 0;
    if (r.status === 200 && found === present) return round(Date.now() - since);
    if (Date.now() - since > TIMEOUT_MS) return null;
    await sleep(POLL_MS);
  }
}

/** Id of the link between two issues, or null. */
export async function linkId(fromId, toId) {
  const x = await api('GET', `/rest/api/3/issue/${fromId}?fields=issuelinks`);
  return x.fields.issuelinks.find((l) => (l.outwardIssue ?? l.inwardIssue)?.id === String(toId))?.id ?? null;
}

/** Seconds per kind of change and overall; null (not visible within 10 minutes) counts as a timeout. */
export function latencyResult(rows, startedAt) {
  const seen = (list) => list.filter((x) => x !== null);
  const lost = (list) => list.filter((x) => x === null).length;
  const all = Object.values(rows).flat();
  return {
    seconds: round(Date.now() - startedAt),
    summary: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { ...summary(seen(v)), timeouts: lost(v) }])),
    overall: { ...summary(seen(all)), timeouts: lost(all) },
    raw: rows,
  };
}

async function subtaskNamed(parentId, name) {
  const parent = await api('GET', `/rest/api/3/issue/${parentId}?fields=subtasks`);
  const found = parent.fields.subtasks.find((s) => s.fields?.summary === name);
  return found ? { id: String(found.id) } : null;
}

/** M1 freshness: n changes of five kinds on JQLG, each awaited in subtasksOf or linkedIssuesOf of the app. */
export async function latency({ n, log }) {
  const run = Date.now().toString(36);
  const project = await api('GET', '/rest/api/3/project/JQLG');
  const subType = (await api('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`)).find((t) => t.subtask);
  const C_SUB = 'issue in subtasksOf("project = JQLG AND labels = jg-mid")';
  const C_LNK = 'issue in linkedIssuesOf("project = JQLG AND labels = jg-lnk")';
  const C_IN = 'issue in subtasksOf("project = JQLG AND labels = jg-in")';
  for (const c of [C_SUB, C_LNK, C_IN]) log(`warm ${c}: ${(await ids(c)).ids?.length}`);
  const mid = (await ids('project = JQLG AND labels = jg-mid ORDER BY key')).ids;
  const lnk = (await ids('project = JQLG AND labels = jg-lnk ORDER BY key')).ids;
  const small = await bulk((await ids('project = JQLG AND labels = jg-small ORDER BY key')).ids.slice(0, n + 5), ['subtasks', 'labels']);
  const targets = (await ids('project = JQLG AND labels = jg-task AND issueLinkType is EMPTY AND labels not in (jg-big, jg-mid, jg-small, jg-lnk, jg-sprint, jg-sprint-big) ORDER BY key DESC')).ids;
  const rows = { newSubtask: [], newLink: [], deletedLink: [], enterQuery: [], leaveQuery: [] };
  const subStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const parent = mid[(i * 7) % mid.length];
      const name = `aq measure sub ${run} ${i}`;
      const created = await write('POST', '/rest/api/3/issue', { fields: { project: { id: project.id }, issuetype: { id: subType.id }, summary: name, labels: ['jg', 'jg-measure'], parent: { id: parent } } }, () => subtaskNamed(parent, name));
      rows.newSubtask.push(await waitFor(C_SUB, created.id, true, Date.now()));
      log(`newSubtask ${i}: ${rows.newSubtask.at(-1)} s`);
    }
  };
  const linkStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const from = lnk[(i * 11) % lnk.length];
      const to = targets[i];
      await write('POST', '/rest/api/3/issueLink', { type: { name: 'Relates' }, outwardIssue: { id: from }, inwardIssue: { id: to } }, () => linkId(from, to));
      rows.newLink.push(await waitFor(C_LNK, to, true, Date.now()));
      const link = await linkId(from, to);
      if (link) await api('DELETE', `/rest/api/3/issueLink/${link}`, undefined, { raw: true });
      rows.deletedLink.push(await waitFor(C_LNK, to, false, Date.now()));
      log(`link ${i}: +${rows.newLink.at(-1)} s −${rows.deletedLink.at(-1)} s`);
    }
  };
  const fieldStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const x = small[i];
      const sub = x.fields.subtasks[0].id;
      await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ add: 'jg-in' }] } });
      rows.enterQuery.push(await waitFor(C_IN, sub, true, Date.now()));
      await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ remove: 'jg-in' }] } });
      rows.leaveQuery.push(await waitFor(C_IN, sub, false, Date.now()));
      log(`field ${i}: in ${rows.enterQuery.at(-1)} s out ${rows.leaveQuery.at(-1)} s`);
    }
  };
  const t0 = Date.now();
  await Promise.all([subStream(), linkStream(), fieldStream()]);
  return latencyResult(rows, t0);
}
