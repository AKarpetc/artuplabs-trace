import { describe, it, expect } from 'vitest';
import { createJira, RateLimited, TransientJiraError } from '../../src/infra/jira';

function response(status, body, headers = {}) {
  return { status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body };
}

describe('searchPage', () => {
  it('posts JQL and returns issues, next token and points spent', async () => {
    const calls = [];
    const jira = createJira(async (path, init) => {
      calls.push({ path, body: JSON.parse(init.body) });
      return response(200, { issues: [{ id: '1' }, { id: '2' }], nextPageToken: 'n2' });
    });
    const page = await jira.searchPage({ jql: 'project = 10000', fields: ['summary'], maxResults: 100 });
    expect(calls[0]).toEqual({ path: '/rest/api/3/search/jql', body: { jql: 'project = 10000', fields: ['summary'], maxResults: 100 } });
    expect(page).toEqual({ issues: [{ id: '1' }, { id: '2' }], nextPageToken: 'n2', points: 3 });
  });

  it('passes nextPageToken and returns null when last page', async () => {
    const jira = createJira(async (_p, init) => {
      expect(JSON.parse(init.body).nextPageToken).toBe('t');
      return response(200, { issues: [] });
    });
    expect((await jira.searchPage({ jql: 'x', fields: [], nextPageToken: 't', maxResults: 100 })).nextPageToken).toBeNull();
  });

  it('throws RateLimited with Retry-After on 429', async () => {
    const jira = createJira(async () => response(429, {}, { 'retry-after': '42' }));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toMatchObject({ name: 'RateLimited', retryAfterSeconds: 42 });
  });

  it('defaults Retry-After to 60 seconds', async () => {
    const jira = createJira(async () => response(429, {}));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toBeInstanceOf(RateLimited);
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('throws a descriptive error on other failures', async () => {
    const jira = createJira(async () => response(400, { errorMessages: ['bad jql'] }));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toThrow('Jira search failed (400): bad jql');
  });
});

describe('searchPage transient failures', () => {
  it('maps a 5xx answer to a retryable TransientJiraError', async () => {
    const jira = createJira(async () => response(503, { errorMessages: ['unavailable'] }));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toBeInstanceOf(TransientJiraError);
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('maps a network failure to a retryable TransientJiraError', async () => {
    const jira = createJira(async () => { throw new TypeError('fetch failed'); });
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toMatchObject({ name: 'TransientJiraError', retryAfterSeconds: 60 });
  });
});

describe('hasPermission', () => {
  it('reads havePermission from mypermissions', async () => {
    const jira = createJira(async () => response(200, {}));
    const asUser = async (path) => {
      expect(path).toBe('/rest/api/3/mypermissions?projectId=10000&permissions=BROWSE_PROJECTS');
      return response(200, { permissions: { BROWSE_PROJECTS: { havePermission: true } } });
    };
    expect(await jira.hasPermission(asUser, '10000', 'BROWSE_PROJECTS')).toBe(true);
  });
});
