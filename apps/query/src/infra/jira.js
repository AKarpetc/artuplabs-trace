import { AsyncLocalStorage } from 'node:async_hooks';
import api, { assumeTrustedRoute } from '@forge/api';
import {
  BULK_BATCH, BULK_CONCURRENCY, BULK_CONCURRENCY_NEAR, CHANGELOG_BATCH, FIELD_RANGES, FIELDS_PAGE, CHANGELOG_PAGE, ID_PAGE, JQL_CHECK_MS, LIST_PAGE, NEAR_LIMIT_MS, PCS_RECENT_PAGES, PRECOMPUTATION_BATCH, PRECOMPUTATION_PAGE,
  POINTS_PAGE_MIN, RECONCILE_MAX, REQUEST_ATTEMPTS, RETRY_BASE_MS, RETRY_MAX_MS, USER_SEARCH_MAX,
} from '../core/limits.js';
import { DEFAULT_LANE, pointsOf } from '../core/points.js';
import { withoutOrder } from '../core/jql-build.js';
import { endpointOf, rateHeaderText, rateLimitOf } from '../core/rate.js';
import { pool } from './pool.js';

/** Jira answered with an error that a retry will not fix. */
export class JiraError extends Error {
  constructor(status, messages) {
    super(messages.length ? messages.join('; ') : `Jira answered ${status}`);
    this.name = 'JiraError';
    this.status = status;
  }
}

/** Jira rate-limited the app; `retryAt` (epoch ms, or null when Jira named none) is when the limit it hit resets. */
export class RateLimitError extends JiraError {
  constructor(facts, messages) {
    super(429, messages);
    this.name = 'RateLimitError';
    this.retryAt = facts.retryAt;
    this.reason = facts.reason;
  }
}

/** A request was refused because the computation it belongs to ran past its deadline. */
export class DeadlineError extends Error {
  constructor() {
    super('Computation deadline passed');
    this.name = 'DeadlineError';
  }
}

/** A request was refused because it would take a points scope past its limit; `scope` names that scope ('group', 'pass', …). */
export class PointsError extends Error {
  constructor(scope, spent, limit) {
    super('Jira points limit reached');
    this.name = 'PointsError';
    this.scope = scope;
    this.spent = spent;
    this.limit = limit;
  }
}

const deadlines = new AsyncLocalStorage();
const scopes = new AsyncLocalStorage();

/**
 * Runs task in a points scope inside the current one: its Jira requests count toward it and every scope around it, and a request that would
 * take it past `limit`, with the forecasts of its requests still in flight, is refused (PointsError); the lane is inherited unless given. A request is judged by 1 point (a bulkfetch by 1 per issue
 * too), so a search page of at least POINTS_PAGE_MIN issues and one parallel bulkfetch round may pass the limit by what they return.
 */
export function withPoints(limit, task, { scope = 'group', lane } = {}) {
  const parent = scopes.getStore() ?? null;
  return scopes.run({ scope, limit, spent: 0, flying: 0, lane: lane ?? parent?.lane ?? DEFAULT_LANE, parent }, task);
}

/** The lane, name, spent points and limit of the innermost points scope, or null outside any. */
export function currentPoints() {
  const s = scopes.getStore();
  return s ? { lane: s.lane, scope: s.scope, spent: s.spent, limit: s.limit } : null;
}

function chainOf(scope) {
  const out = [];
  for (let s = scope; s; s = s.parent) out.push(s);
  return out;
}

function admitRequest(cost) {
  const chain = chainOf(scopes.getStore());
  const over = chain.find((s) => s.spent + s.flying + cost > s.limit);
  if (over) throw new PointsError(over.scope, over.spent, over.limit);
  for (const s of chain) s.flying += cost;
  return () => {
    for (const s of chain) s.flying -= cost;
  };
}

function pageSize() {
  const left = Math.min(...chainOf(scopes.getStore()).map((s) => s.limit - s.spent - s.flying));
  return Number.isFinite(left) ? Math.min(ID_PAGE, Math.max(POINTS_PAGE_MIN, left)) : ID_PAGE;
}

const forecastOf = (endpoint, body) => 1 + (endpoint.endsWith('/issue/bulkfetch') ? (body?.issueIdsOrKeys?.length ?? 0) : 0);

/** Runs task in a scope whose Jira requests are refused (DeadlineError) from `deadline` (epoch ms) on; parallel scopes stay apart. */
export function withDeadline(deadline, task) {
  return deadlines.run(deadline, task);
}

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const enc = encodeURIComponent;
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const RETRIED = new Set([500, 502, 503, 504]);
const NOT_JSON = Symbol('not JSON');

function jsonOf(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return NOT_JSON;
  }
}

function messagesOf(raw) {
  try {
    const body = JSON.parse(raw);
    return [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].map(String);
  } catch {
    return [];
  }
}

/** Jira REST client over `request(path, init)`; 500, 502, 503, 504 and a 429 whose wait fits `retryMaxMs` are retried (Retry-After or exponential backoff, each sleep capped); a longer 429 throws RateLimitError at once, a success whose body is not JSON a JiraError; bulkfetch narrows after a near-limit warning; no request starts after the deadline of the current scope or past the limit of its points scope; the points of each answer go to its scopes and to `ledger.add(lane, points)`; the first near-limit warning of each window calls `onNear(at)`. */
export function createJira(request, { sleep = wait, attempts = REQUEST_ATTEMPTS, retryMaxMs = RETRY_MAX_MS, clock = Date.now, ledger = null, onNear = null } = {}) {
  let counts = {};
  let nearUntil = 0;
  function count(endpoint, res, facts, at, rate) {
    const c = counts[endpoint] ?? { requests: 0, limited: 0, rate: null };
    const limited = res.status === 429;
    counts[endpoint] = { requests: c.requests + 1, limited: c.limited + (limited ? 1 : 0), rate: !limited && rate ? rate : c.rate };
    if (!facts.near) return;
    if (at >= nearUntil) onNear?.(at);
    nearUntil = Math.max(nearUntil, facts.retryAt ?? at + NEAR_LIMIT_MS);
  }

  async function charge(points) {
    const scope = scopes.getStore();
    for (const s of chainOf(scope)) s.spent += points;
    if (ledger) await ledger.add(scope?.lane ?? DEFAULT_LANE, points);
  }

  async function call(method, path, body, { tries = attempts } = {}) {
    const endpoint = endpointOf(path);
    for (let attempt = 1; ; attempt += 1) {
      const deadline = deadlines.getStore();
      if (deadline !== undefined && clock() >= deadline) throw new DeadlineError();
      const landed = admitRequest(forecastOf(endpoint, body));
      const headers = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
      let res;
      let facts;
      let retry = false;
      let wait = 0;
      let raw = '';
      let answer = null;
      try {
        res = await request(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
        const header = (name) => res.headers?.get?.(name) ?? null;
        const at = clock();
        facts = rateLimitOf(header, at);
        const rate = rateHeaderText(header);
        count(`${method} ${endpoint}`, res, facts, at, rate);
        if (res.status === 429) console.warn(`rate limited ${method} ${endpoint} attempt ${attempt}: ${rate}`);
        wait = facts.retryAt === null ? RETRY_BASE_MS * 2 ** attempt : facts.retryAt - at;
        retry = (res.status === 429 || RETRIED.has(res.status)) && attempt < tries && (res.status !== 429 || wait <= retryMaxMs);
        if (retry) await charge(1);
        else {
          raw = await res.text();
          answer = res.status < 400 && raw ? jsonOf(raw) : null;
          await charge(pointsOf(method, endpoint, answer === NOT_JSON ? null : answer));
        }
      } finally {
        landed();
      }
      if (retry) {
        await sleep(Math.min(wait, retryMaxMs));
        continue;
      }
      if (res.status === 429) throw new RateLimitError(facts, messagesOf(raw));
      if (res.status >= 400 || answer === NOT_JSON) throw new JiraError(res.status, messagesOf(raw));
      return answer;
    }
  }

  async function paged(path, size = LIST_PAGE) {
    const out = [];
    let startAt = 0;
    for (;;) {
      const page = await call('GET', `${path}${path.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=${size}`);
      const items = page?.values ?? [];
      out.push(...items);
      startAt += items.length;
      if (page?.isLast === true || !items.length || (Number.isFinite(page?.total) && startAt >= page.total)) return out;
    }
  }

  async function searchIds(jql, { reconcile = [] } = {}) {
    const out = [];
    let nextPageToken;
    do {
      const page = await call('POST', '/rest/api/3/search/jql', {
        jql,
        fields: ['id'],
        maxResults: pageSize(),
        ...(reconcile.length ? { reconcileIssues: reconcile.slice(0, RECONCILE_MAX).map(Number) } : {}),
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      out.push(...(page.issues ?? []).map((x) => String(x.id)));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return out;
  }

  async function fieldPage(jql, fields, reconcile, nextPageToken) {
    const page = await call('POST', '/rest/api/3/search/jql', {
      jql,
      fields,
      maxResults: Math.min(pageSize(), FIELDS_PAGE),
      ...(reconcile.length ? { reconcileIssues: reconcile.slice(0, RECONCILE_MAX).map(Number) } : {}),
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    return { issues: (page?.issues ?? []).map((x) => ({ ...x, id: String(x.id) })), nextPageToken: page?.nextPageToken ?? null };
  }

  /**
   * The issues of a query with their fields, in id order. Jira returns at most FIELDS_PAGE issues a page with fields, so a result past one
   * page is read in FIELD_RANGES id ranges side by side (from after the first page; the last range has no upper bound), fewer at once after a
   * near-limit warning; while a range still has pages and a reader is free, the rest of it is halved between them, at most FIELD_RANGES times.
   */
  async function searchIssues(query, fields, { reconcile = [] } = {}) {
    const where = withoutOrder(query).trim();
    const within = (a, b) => [where && `(${where})`, a === null ? '' : `id > ${a}`, b === null ? '' : `id <= ${b}`].filter(Boolean).join(' AND ');
    const ordered = (jql, order) => `${jql} ORDER BY id ${order}`.trim();
    const first = await fieldPage(ordered(within(null, null), 'ASC'), fields, reconcile, null);
    if (!first.nextPageToken || !first.issues.length) return first.issues;
    const top = await call('POST', '/rest/api/3/search/jql', {
      jql: ordered(within(null, null), 'DESC'),
      fields: ['id'],
      maxResults: 1,
      ...(reconcile.length ? { reconcileIssues: reconcile.slice(0, RECONCILE_MAX).map(Number) } : {}),
    });
    const low = Number(first.issues[first.issues.length - 1].id);
    const high = Math.max(low, Number(top?.issues?.[0]?.id ?? low));
    const step = Math.max(1, Math.ceil((high - low) / FIELD_RANGES));
    const bounds = Array.from({ length: FIELD_RANGES }, (_, i) => low + i * step).filter((a, i) => i === 0 || a < high);
    const queue = bounds.map((a, i) => [a, i === bounds.length - 1 ? null : bounds[i + 1]]);
    const together = clock() < nearUntil ? BULK_CONCURRENCY_NEAR : FIELD_RANGES;
    const out = [...first.issues];
    const readers = [];
    let reading = 0;
    let splits = 0;

    async function read(range) {
      let [a, b] = range;
      let nextPageToken = null;
      for (;;) {
        const page = await fieldPage(ordered(within(a, b), 'ASC'), fields, reconcile, nextPageToken);
        out.push(...page.issues);
        if (!page.nextPageToken || !page.issues.length) break;
        const last = Number(page.issues[page.issues.length - 1].id);
        const end = b ?? high;
        if (!queue.length && reading < together && splits < FIELD_RANGES && end - last > 1) {
          const middle = Math.floor((last + end) / 2);
          splits += 1;
          start([middle, b]);
          [a, b, nextPageToken] = [last, middle, null];
        } else nextPageToken = page.nextPageToken;
      }
      if (queue.length) await read(queue.shift());
    }

    function start(range) {
      reading += 1;
      const reader = read(range).finally(() => {
        reading -= 1;
      });
      reader.catch(() => {});
      readers.push(reader);
    }

    while (queue.length && reading < together) start(queue.shift());
    for (let i = 0; i < readers.length; i += 1) await readers[i];
    return out.sort((x, y) => Number(x.id) - Number(y.id));
  }

  async function searchPage(jql, nextPageToken, { maxResults = ID_PAGE, fields = ['id'] } = {}) {
    const page = await call('POST', '/rest/api/3/search/jql', { jql, fields, maxResults: Math.min(pageSize(), maxResults), ...(nextPageToken ? { nextPageToken } : {}) });
    const issues = page?.issues ?? [];
    return { ids: issues.map((x) => String(x.id)), issues, nextPageToken: page?.nextPageToken ?? null };
  }

  const checked = new Map();

  async function parseErrors(jql) {
    const answer = await call('POST', '/rest/api/3/jql/parse?validation=strict', { queries: [jql] });
    return (answer?.queries?.[0]?.errors ?? []).map(String);
  }

  /** Rejects a query Jira's strict parser finds errors in with a 400 carrying its texts; the answer per text is reused for JQL_CHECK_MS. */
  async function validateJql(jql) {
    const now = clock();
    for (const [text, entry] of checked) if (now - entry.at >= JQL_CHECK_MS) checked.delete(text);
    let entry = checked.get(jql);
    if (!entry) {
      entry = { at: now, errors: parseErrors(jql) };
      checked.set(jql, entry);
      entry.errors.catch(() => {
        if (checked.get(jql) === entry) checked.delete(jql);
      });
    }
    const errors = await entry.errors;
    if (errors.length) throw new JiraError(400, errors);
  }

  async function bulkIssues(ids, fields) {
    const pages = await pool(chunks(ids, BULK_BATCH), clock() < nearUntil ? BULK_CONCURRENCY_NEAR : BULK_CONCURRENCY, (chunk) => call('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: chunk, fields }));
    return pages.flatMap((p) => p?.issues ?? []);
  }

  async function boards(arg) {
    const text = String(arg).trim();
    const named = await paged(`/rest/agile/1.0/board?name=${enc(text)}`);
    if (!/^\d+$/.test(text)) return named;
    try {
      const byId = await call('GET', `/rest/agile/1.0/board/${text}`);
      return [byId, ...named.filter((b) => String(b.id) !== text)];
    } catch (error) {
      if (error instanceof JiraError && error.status === 404) return named;
      throw error;
    }
  }

  async function changelogs(ids, fieldIds) {
    const out = new Map();
    for (const chunk of chunks(ids, CHANGELOG_BATCH)) {
      let nextPageToken;
      do {
        const page = await call('POST', '/rest/api/3/changelog/bulkfetch', { issueIdsOrKeys: chunk, fieldIds, maxResults: CHANGELOG_PAGE, ...(nextPageToken ? { nextPageToken } : {}) });
        for (const log of page?.issueChangeLogs ?? []) {
          const key = String(log.issueId);
          out.set(key, [...(out.get(key) ?? []), ...(log.changeHistories ?? [])]);
        }
        nextPageToken = page?.nextPageToken;
      } while (nextPageToken);
    }
    return out;
  }

  async function groupMemberIds(name) {
    return (await paged(`/rest/api/3/group/member?groupname=${enc(name)}&includeInactiveUsers=true`)).map((u) => u.accountId);
  }

  async function roleGroupMembers(name) {
    try {
      return await groupMemberIds(name);
    } catch (error) {
      if (error instanceof JiraError && error.status === 404) return [];
      throw error;
    }
  }

  /** Members of a project role, or null when the project has no such role; `groups` caches role groups across the calls that share it, and a role group Jira no longer knows has no members. */
  async function roleMemberIds(projectKey, roleName, { groups = new Map() } = {}) {
    const roles = (await call('GET', `/rest/api/3/project/${enc(projectKey)}/role`)) ?? {};
    const url = Object.entries(roles).find(([name]) => name.toLowerCase() === String(roleName).toLowerCase())?.[1];
    if (!url) return null;
    const role = await call('GET', `/rest/api/3/project/${enc(projectKey)}/role/${enc(String(url).split('/').pop())}`);
    const users = (role?.actors ?? []).filter((a) => a.actorUser).map((a) => a.actorUser.accountId);
    for (const group of (role?.actors ?? []).filter((a) => a.actorGroup).map((a) => a.actorGroup.name)) {
      if (!groups.has(group)) groups.set(group, roleGroupMembers(group));
      users.push(...(await groups.get(group)));
    }
    return [...new Set(users)];
  }

  /** Requests sent since the last call, by method and endpoint, with how many Jira rate-limited and the rate headers of the last answer that was not a 429. */
  function takeRequests() {
    const out = counts;
    counts = {};
    return out;
  }

  return {
    call,
    takeRequests,
    searchIds,
    searchIssues,
    searchPage,
    validateJql,
    bulkIssues,
    boards,
    changelogs,
    groupMemberIds,
    roleMemberIds,
    issue: (id, fields) => call('GET', `/rest/api/3/issue/${enc(id)}?fields=${fields.map(enc).join(',')}`),
    linkTypes: async () => (await call('GET', '/rest/api/3/issueLinkType'))?.issueLinkTypes ?? [],
    fields: () => call('GET', '/rest/api/3/field'),
    statusCategories: async () => new Map(((await call('GET', '/rest/api/3/status')) ?? []).map((s) => [String(s.id), s.statusCategory?.key ?? 'new'])),
    allBoards: () => paged('/rest/agile/1.0/board'),
    boardPage: (startAt) => call('GET', `/rest/agile/1.0/board?startAt=${startAt}&maxResults=${LIST_PAGE}`),
    projects: async () => (await paged('/rest/api/3/project/search')).map((p) => ({ id: String(p.id), key: p.key })),
    sprints: (boardId) => paged(`/rest/agile/1.0/board/${enc(boardId)}/sprint?state=active,closed,future`),
    precomputations: () => paged('/rest/api/3/jql/function/computation', PRECOMPUTATION_PAGE),
    recentPrecomputations: async (since) => {
      const out = [];
      for (let page = 0, startAt = 0; page < PCS_RECENT_PAGES; page += 1) {
        const items = (await call('GET', `/rest/api/3/jql/function/computation?orderBy=-used&startAt=${startAt}&maxResults=${PRECOMPUTATION_PAGE}`))?.values ?? [];
        const newer = items.filter((pc) => Date.parse(pc.used ?? '') >= since);
        out.push(...newer);
        startAt += items.length;
        if (newer.length < items.length || !items.length) break;
      }
      return out;
    },
    writePrecomputations: async (updates) => {
      for (const batch of chunks(updates, PRECOMPUTATION_BATCH)) await call('POST', '/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true', { values: batch });
    },
    userIds: async (query) => ((await call('GET', `/rest/api/3/user/search?query=${enc(query)}&maxResults=${USER_SEARCH_MAX}`)) ?? []).map((u) => u.accountId),
    approximateCount: async (jql, { attempts: tries } = {}) => (await call('POST', '/rest/api/3/search/approximate-count', { jql }, tries ? { tries } : {}))?.count ?? 0,
  };
}

/** Client acting as the app, against the Jira of the installation only. */
export const appJira = (options = {}) => createJira((path, init) => api.asApp().requestJira(assumeTrustedRoute(path), init), options);
