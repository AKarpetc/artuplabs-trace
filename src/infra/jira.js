import api, { assumeTrustedRoute } from '@forge/api';

export const SEARCH_PAGE = 100;

/** Raised when Jira answers 429; the caller re-enqueues after retryAfterSeconds. */
export class RateLimited extends Error {
  constructor(retryAfterSeconds) {
    super(`Jira rate limited, retry after ${retryAfterSeconds}s`);
    this.name = 'RateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function failure(res, what) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body.errorMessages ?? []).join('; ');
  } catch {
    detail = '';
  }
  return new Error(`${what} failed (${res.status}): ${detail}`);
}

/** Jira client over an injected request(path, init) function. */
export function createJira(request) {
  return {
    async searchPage({ jql, fields, nextPageToken, maxResults }) {
      const body = { jql, fields, maxResults };
      if (nextPageToken) {
        body.nextPageToken = nextPageToken;
      }
      const res = await request('/rest/api/3/search/jql', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        throw new RateLimited(Number(res.headers.get('retry-after')) || 60);
      }
      if (res.status !== 200) {
        throw await failure(res, 'Jira search');
      }
      const json = await res.json();
      const issues = json.issues ?? [];
      return { issues, nextPageToken: json.nextPageToken ?? null, points: 1 + issues.length };
    },

    async hasPermission(asUserRequest, projectId, permission) {
      const res = await asUserRequest(`/rest/api/3/mypermissions?projectId=${encodeURIComponent(projectId)}&permissions=${permission}`);
      if (res.status !== 200) {
        return false;
      }
      const json = await res.json();
      return json.permissions?.[permission]?.havePermission === true;
    },
  };
}

/** Request function that calls Jira as the app. */
export function asAppRequest(path, init) {
  return api.asApp().requestJira(assumeTrustedRoute(path), init);
}

/** Request function that calls Jira as the current user. */
export function asUserRequest(path, init) {
  return api.asUser().requestJira(assumeTrustedRoute(path), init);
}
