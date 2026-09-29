import { ID_PAGE, ISSUE_CONCURRENCY, MAX_ATTEMPTS, MEDIA_CONCURRENCY } from '../core/limits.js';
import { createPool } from './pool.js';

const MAX_RETRY_AFTER_S = 120;
const MAX_BACKOFF_S = 30;
const MAX_PAGES = 1000;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/** Jira REST failure with its HTTP status (0 = network) and Jira's error messages. */
export class JiraError extends Error {
  constructor(status, path, messages = []) {
    super(`jira ${status} ${path}`);
    this.name = 'JiraError';
    this.status = status;
    this.messages = messages;
  }
}

/** Jira's error messages from a failed response body, or none when it is not JSON. */
async function messagesOf(response) {
  try {
    const body = await response.json();
    return [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].map(String);
  } catch {
    return [];
  }
}

/** Wait before the next attempt: 1, 2, 4, 8, 16 s, capped. */
const backoff = (attempt) => Math.min(MAX_BACKOFF_S, 2 ** attempt) * 1000;

/** Jira REST client over a requestJira-like function: two pools (issues, media), retries on 429/5xx/network, cancellation. */
export function createJiraClient({ request, sleep, signal, onRetry = () => {}, concurrency = ISSUE_CONCURRENCY, mediaConcurrency = MEDIA_CONCURRENCY }) {
  const runIssue = createPool(concurrency);
  const runMedia = createPool(mediaConcurrency);
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const send = (run, path, init, parse) => run(async () => {
    for (let attempt = 0; ; attempt += 1) {
      checkAbort();
      let response;
      try {
        response = await request(path, init);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (attempt >= MAX_ATTEMPTS - 1) throw new JiraError(0, path);
        onRetry({ status: 0, path });
        await sleep(backoff(attempt));
        continue;
      }
      if (response.ok) return parse(response);
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt >= MAX_ATTEMPTS - 1) throw new JiraError(response.status, path, await messagesOf(response));
      onRetry({ status: response.status, path });
      const header = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(header) && header > 0 ? Math.min(MAX_RETRY_AFTER_S, header) * 1000 : backoff(attempt));
    }
  });
  const getJson = (path) => send(runIssue, path, { headers: { Accept: 'application/json' } }, (r) => r.json());
  const postJson = (path, body) => send(runIssue, path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, (r) => r.json());
  const bytes = (path) => send(runMedia, path, { headers: {} }, (r) => r.arrayBuffer());
  const paged = async (base, key, size) => {
    const out = [];
    for (let startAt = 0, pages = 0; ; pages += 1) {
      if (pages >= MAX_PAGES) throw new JiraError(508, base);
      const sep = base.includes('?') ? '&' : '?';
      const page = await getJson(`${base}${sep}startAt=${startAt}&maxResults=${size}`);
      const items = page[key] ?? [];
      out.push(...items);
      startAt += items.length;
      if (items.length === 0 || startAt >= (page.total ?? 0)) return out;
    }
  };
  return {
    async searchIds(jql, { limit = Infinity } = {}) {
      const ids = [];
      const seen = new Set();
      let token;
      do {
        if (seen.size >= MAX_PAGES || (token && seen.has(token))) throw new JiraError(508, '/rest/api/3/search/jql');
        if (token) seen.add(token);
        const page = await postJson('/rest/api/3/search/jql', {
          jql, fields: ['id'], maxResults: Math.min(ID_PAGE, limit - ids.length), ...(token ? { nextPageToken: token } : {}),
        });
        ids.push(...(page.issues ?? []).map((x) => String(x.id)));
        token = page.nextPageToken;
      } while (token && ids.length < limit);
      return ids.slice(0, limit);
    },
    async approximateCount(jql) {
      return (await postJson('/rest/api/3/search/approximate-count', { jql })).count ?? 0;
    },
    async bulkFetch(ids, { fields, expand = [] }) {
      const page = await postJson('/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: ids, fields, expand, fieldsByKeys: false });
      return { issues: page.issues ?? [], errors: page.issueErrors ?? [] };
    },
    listComments: (issueId) => paged(`/rest/api/3/issue/${encodeURIComponent(issueId)}/comment?expand=renderedBody`, 'comments', 100),
    listWorklogs: (issueId) => paged(`/rest/api/3/issue/${encodeURIComponent(issueId)}/worklog`, 'worklogs', 5000),
    getFields: () => getJson('/rest/api/3/field'),
    async getMyself() {
      const me = await getJson('/rest/api/3/myself');
      return { accountId: me.accountId, displayName: me.displayName };
    },
    async boardJql(boardId) {
      const config = await getJson(`/rest/agile/1.0/board/${Number(boardId)}/configuration`);
      const filter = await getJson(`/rest/api/3/filter/${Number(config.filter?.id)}`);
      return { jql: filter.jql, name: config.name ?? '' };
    },
    async sprintName(sprintId) {
      return (await getJson(`/rest/agile/1.0/sprint/${Number(sprintId)}`)).name ?? '';
    },
    async searchFilters(query) {
      const page = await getJson(`/rest/api/3/filter/search?filterName=${encodeURIComponent(query)}&expand=jql&maxResults=50`);
      return (page.values ?? []).map((f) => ({ id: String(f.id), name: f.name, jql: f.jql ?? '' }));
    },
    attachmentBytes: (id) => bytes(`/rest/api/3/attachment/content/${encodeURIComponent(id)}`),
    attachmentThumbnail: (id) => bytes(`/rest/api/3/attachment/thumbnail/${encodeURIComponent(id)}`),
  };
}
