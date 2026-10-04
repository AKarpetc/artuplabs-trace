import { AsyncLocalStorage } from 'node:async_hooks';
import api, { assumeTrustedRoute } from '@forge/api';
import {
  BULK_BATCH, BULK_CONCURRENCY, BULK_CONCURRENCY_NEAR, CHANGELOG_BATCH, CHANGELOG_PAGE, ID_PAGE, JQL_CHECK_MS, LIST_PAGE, NEAR_LIMIT_MS, PRECOMPUTATION_BATCH, PRECOMPUTATION_PAGE,
  RECONCILE_MAX, REQUEST_ATTEMPTS, RETRY_BASE_MS, RETRY_MAX_MS, USER_SEARCH_MAX,
} from '../core/limits.js';
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

const deadlines = new AsyncLocalStorage();

/** Runs task in a scope whose Jira requests are refused (DeadlineError) from `deadline` (epoch ms) on; parallel scopes stay apart. */
export function withDeadline(deadline, task) {
  return deadlines.run(deadline, task);
}

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const enc = encodeURIComponent;
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

function messagesOf(raw) {
  try {
    const body = JSON.parse(raw);
    return [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].map(String);
  } catch {
    return [];
  }
}

/** Jira REST client over `request(path, init)`; 5xx and a 429 whose wait fits `retryMaxMs` are retried (Retry-After or exponential backoff, each sleep capped); a longer 429 throws RateLimitError at once; bulkfetch narrows after a near-limit warning; no request starts after the deadline of the current scope. */
export function createJira(request, { sleep = wait, attempts = REQUEST_ATTEMPTS, retryMaxMs = RETRY_MAX_MS, clock = Date.now } = {}) {
  let counts = {};
  let nearUntil = 0;
  function count(endpoint, res, facts, at) {
    const c = counts[endpoint] ?? { requests: 0, limited: 0, remaining: null };
    counts[endpoint] = { requests: c.requests + 1, limited: c.limited + (res.status === 429 ? 1 : 0), remaining: facts.remaining ?? c.remaining };
    if (facts.near) nearUntil = Math.max(nearUntil, facts.retryAt ?? at + NEAR_LIMIT_MS);
  }

  async function call(method, path, body) {
    const endpoint = endpointOf(path);
    for (let attempt = 1; ; attempt += 1) {
      const deadline = deadlines.getStore();
      if (deadline !== undefined && clock() >= deadline) throw new DeadlineError();
      const headers = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
      const res = await request(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      const header = (name) => res.headers?.get?.(name) ?? null;
      const at = clock();
      const facts = rateLimitOf(header, at);
      count(`${method} ${endpoint}`, res, facts, at);
      if (res.status === 429) console.warn(`rate limited ${method} ${endpoint} attempt ${attempt}: ${rateHeaderText(header)}`);
      const wait = facts.retryAt === null ? RETRY_BASE_MS * 2 ** attempt : facts.retryAt - at;
      const retry = (res.status === 429 || res.status >= 500) && attempt < attempts && (res.status !== 429 || wait <= retryMaxMs);
      if (retry) {
        await sleep(Math.min(wait, retryMaxMs));
        continue;
      }
      const raw = await res.text();
      if (res.status === 429) throw new RateLimitError(facts, messagesOf(raw));
      if (res.status >= 400) throw new JiraError(res.status, messagesOf(raw));
      return raw ? JSON.parse(raw) : null;
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
        maxResults: ID_PAGE,
        ...(reconcile.length ? { reconcileIssues: reconcile.slice(0, RECONCILE_MAX).map(Number) } : {}),
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      out.push(...(page.issues ?? []).map((x) => String(x.id)));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return out;
  }

  async function searchPage(jql, nextPageToken) {
    const page = await call('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: ID_PAGE, ...(nextPageToken ? { nextPageToken } : {}) });
    return { ids: (page?.issues ?? []).map((x) => String(x.id)), nextPageToken: page?.nextPageToken ?? null };
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

  /** Requests sent since the last call, by method and endpoint, with how many Jira rate-limited and the last remaining quota it reported. */
  function takeRequests() {
    const out = counts;
    counts = {};
    return out;
  }

  return {
    call,
    takeRequests,
    searchIds,
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
    projects: async () => (await paged('/rest/api/3/project/search')).map((p) => ({ id: String(p.id), key: p.key })),
    sprints: (boardId) => paged(`/rest/agile/1.0/board/${enc(boardId)}/sprint?state=active,closed,future`),
    precomputations: () => paged('/rest/api/3/jql/function/computation', PRECOMPUTATION_PAGE),
    writePrecomputations: async (updates) => {
      for (const batch of chunks(updates, PRECOMPUTATION_BATCH)) await call('POST', '/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true', { values: batch });
    },
    userIds: async (query) => ((await call('GET', `/rest/api/3/user/search?query=${enc(query)}&maxResults=${USER_SEARCH_MAX}`)) ?? []).map((u) => u.accountId),
    approximateCount: async (jql) => (await call('POST', '/rest/api/3/search/approximate-count', { jql }))?.count ?? 0,
  };
}

/** Client acting as the app, against the Jira of the installation only. */
export const appJira = (options = {}) => createJira((path, init) => api.asApp().requestJira(assumeTrustedRoute(path), init), options);
