export const SITE = 'https://artuplabs-dev.atlassian.net';
export const stats = { requests: 0, retries: 0, timeouts: 0 };

/** Thrown when a write timed out or the connection broke: the caller checks whether it was applied before retrying. */
export class UnsafeRetryError extends Error {}

const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;
export const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/** REST call with a request timeout and retries of network errors, 429 and 5xx; `unsafe` throws on a network error or 5xx instead; `raw` returns status and text; `headers` are added to every attempt. */
export async function api(method, path, body, { raw = false, attempts = 8, timeoutMs = 30000, unsafe = false, headers = {} } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    stats.requests += 1;
    let res;
    let text = '';
    try {
      res = await fetch(`${SITE}${path}`, {
        method,
        headers: { Authorization: auth(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 429 && res.status < 500) text = await res.text();
    } catch (error) {
      stats.retries += 1;
      if (error?.name === 'TimeoutError') stats.timeouts += 1;
      if (unsafe) throw new UnsafeRetryError(`${method} ${path}: ${error?.name ?? error}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (unsafe && res.status >= 500) {
      stats.retries += 1;
      throw new UnsafeRetryError(`${method} ${path}: ${res.status}`);
    }
    if (res.status === 429 || res.status >= 500) {
      stats.retries += 1;
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    if (raw) return { status: res.status, text };
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`), { status: res.status, text });
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path} → gave up after ${attempts} attempts`);
}

/** Non-idempotent write: after a timeout, a broken connection or a 5xx it asks `applied()` and sends again only when that finds nothing. */
export async function write(method, path, body, applied, { attempts = 4, settleMs = 3000, raw = false } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await api(method, path, body, { raw, unsafe: true });
    } catch (error) {
      if (!(error instanceof UnsafeRetryError)) throw error;
      await sleep(settleMs);
      const found = await applied();
      if (found) return found;
    }
  }
  throw new Error(`${method} ${path} → not applied after ${attempts} attempts`);
}

/** Runs task over items with at most n in flight (own copy, not src/infra/pool.js: the tools stay independent of the app). */
export async function pool(items, n, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  }));
  return out;
}

/** All ids of a JQL (5 000 per page), or `{ error }` with Jira's answer. */
export async function ids(jql) {
  const out = [];
  let nextPageToken;
  do {
    const r = await api('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: 5000, ...(nextPageToken ? { nextPageToken } : {}) }, { raw: true });
    if (r.status !== 200) return { error: `${r.status} ${r.text.slice(0, 300)}` };
    const page = JSON.parse(r.text);
    out.push(...page.issues.map((x) => String(x.id)));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return { ids: out };
}

/**
 * All ids of a JQL once the answer is settled. Jira's REST search answers a function error, the Computing answer included, with
 * no issues (measured on the dev site), so an answer slow enough to include a deferral (a function answers Computing after 10 s)
 * is searched again after a minute, up to six times.
 */
export async function settledIds(jql, { search = ids, sleep: wait = sleep, now = Date.now, slowS = 9, attempts = 6, log = () => {} } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const t0 = now();
    const r = await search(jql);
    const seconds = (now() - t0) / 1000;
    if (r.error || seconds < slowS) return { ...r, seconds, attempts: attempt };
    log(`slow answer (${seconds} s) may be Computing, searching again in 60 s: ${jql.slice(0, 80)}`);
    await wait(60000);
  }
  return { error: `still slow after ${attempts} attempts` };
}

/** Issues with the given fields via bulkfetch, 100 per call, 8 in parallel. */
export async function bulk(idList, fields) {
  const chunks = [];
  for (let i = 0; i < idList.length; i += 100) chunks.push(idList.slice(i, i + 100));
  const pages = await pool(chunks, 8, (c) => api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: c, fields }));
  return pages.flatMap((p) => p.issues ?? []);
}

/** Uploads one small file as an attachment of an issue; not retried, because a retry could attach it twice. */
export async function upload(issueId, filename, text) {
  stats.requests += 1;
  const form = new FormData();
  form.append('file', new Blob([text]), filename);
  const res = await fetch(`${SITE}/rest/api/3/issue/${issueId}/attachments`, {
    method: 'POST',
    headers: { Authorization: auth(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`upload ${issueId} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
