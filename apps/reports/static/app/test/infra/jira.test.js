import { describe, expect, it, vi } from 'vitest';
import { createJiraClient, JiraError } from '../../src/infra/jira.js';
import { fakeJira } from '../fixtures/fakeJira.js';

const ok = (body) => ({ status: 200, body });
const abortError = () => new DOMException('Aborted', 'AbortError');

function client(routes, options = {}) {
  const jira = fakeJira(routes);
  const sleep = vi.fn(async () => {});
  const onRetry = vi.fn();
  return { jira, sleep, onRetry, api: createJiraClient({ request: jira.request, sleep, onRetry, ...options }) };
}

describe('jira client', () => {
  it('searchIds follows nextPageToken over two pages and returns the ids as strings in order', async () => {
    const { jira, api } = client({
      'POST /rest/api/3/search/jql': ({ body }) => (body.nextPageToken === 'p2'
        ? ok({ issues: [{ id: 3 }] })
        : ok({ issues: [{ id: 1 }, { id: '2' }], nextPageToken: 'p2' })),
    });
    expect(await api.searchIds('project = A')).toEqual(['1', '2', '3']);
    expect(jira.calls.map((c) => c.body)).toEqual([
      { jql: 'project = A', fields: ['id'], maxResults: 5000 },
      { jql: 'project = A', fields: ['id'], maxResults: 5000, nextPageToken: 'p2' },
    ]);
  });

  it('searchIds with a limit asks for that many ids and returns exactly that many', async () => {
    const { jira, api } = client({
      'POST /rest/api/3/search/jql': () => ok({ issues: [{ id: 1 }, { id: 2 }, { id: 3 }], nextPageToken: 'more' }),
    });
    expect(await api.searchIds('x', { limit: 3 })).toEqual(['1', '2', '3']);
    expect(jira.calls.map((c) => c.body)).toEqual([{ jql: 'x', fields: ['id'], maxResults: 3 }]);
  });

  it('searchIds throws JiraError 508 when a page repeats a token it has already seen', async () => {
    const { api } = client({
      'POST /rest/api/3/search/jql': () => ok({ issues: [{ id: 1 }], nextPageToken: 'same' }),
    });
    await expect(api.searchIds('x')).rejects.toMatchObject({ name: 'JiraError', status: 508 });
  });

  it('approximateCount posts the jql and returns the count', async () => {
    const { jira, api } = client({ 'POST /rest/api/3/search/approximate-count': () => ok({ count: 42 }) });
    expect(await api.approximateCount('x')).toBe(42);
    expect(jira.calls.map((c) => c.body)).toEqual([{ jql: 'x' }]);
  });

  it('throws JiraError with the status and Jira messages on a 400 and does not retry it', async () => {
    const { jira, sleep, api } = client({
      'GET /rest/api/3/field': () => ({ status: 400, body: { errorMessages: ['Bad jql'], errors: { jql: 'Field x does not exist' } } }),
    });
    const error = await api.getFields().catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect({ status: error.status, messages: error.messages }).toEqual({ status: 400, messages: ['Bad jql', 'Field x does not exist'] });
    expect(jira.calls.length).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a 429 after the retry-after wait, reports the retry and returns the second answer', async () => {
    const { sleep, onRetry, api } = client({
      'GET /rest/api/3/field': ({ attempt }) => (attempt === 1 ? { status: 429, headers: { 'retry-after': '2' } } : ok([{ id: 'summary' }])),
    });
    expect(await api.getFields()).toEqual([{ id: 'summary' }]);
    expect(sleep.mock.calls).toEqual([[2000]]);
    expect(onRetry.mock.calls).toEqual([[{ status: 429, path: '/rest/api/3/field' }]]);
  });

  it('retries a 503 with backoff 1, 2, 4, 8, 16 s and throws JiraError 503 after the sixth attempt', async () => {
    const { jira, sleep, api } = client({ 'GET /rest/api/3/field': () => ({ status: 503, body: {} }) });
    await expect(api.getFields()).rejects.toMatchObject({ name: 'JiraError', status: 503 });
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000], [8000], [16000]]);
    expect(jira.calls.length).toBe(6);
  });

  it('retries a rejected request and throws JiraError with status 0 after the sixth attempt', async () => {
    const { jira, sleep, api } = client({
      'GET /rest/api/3/field': () => {
        throw new TypeError('network down');
      },
    });
    await expect(api.getFields()).rejects.toMatchObject({ name: 'JiraError', status: 0, messages: [] });
    expect(jira.calls.length).toBe(6);
    expect(sleep).toHaveBeenCalledTimes(5);
  });

  it('rethrows an AbortError from the request at once without retrying', async () => {
    const { jira, sleep, api } = client({
      'GET /rest/api/3/field': () => {
        throw abortError();
      },
    });
    await expect(api.getFields()).rejects.toMatchObject({ name: 'AbortError' });
    expect(jira.calls.length).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws AbortError before any request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { jira, api } = client({ 'GET /rest/api/3/field': () => ok([]) }, { signal: controller.signal });
    await expect(api.getFields()).rejects.toMatchObject({ name: 'AbortError' });
    expect(jira.calls).toEqual([]);
  });

  it('throws AbortError instead of retrying when the signal aborts during the backoff wait', async () => {
    const controller = new AbortController();
    const jira = fakeJira({ 'GET /rest/api/3/field': () => ({ status: 503, body: {} }) });
    const sleep = vi.fn(async () => controller.abort());
    const api = createJiraClient({ request: jira.request, sleep, signal: controller.signal });
    await expect(api.getFields()).rejects.toMatchObject({ name: 'AbortError' });
    expect(jira.calls.length).toBe(1);
  });

  it('bulkFetch posts ids, fields and expand and returns the issues and issue errors', async () => {
    const { jira, api } = client({
      'POST /rest/api/3/issue/bulkfetch': () => ok({ issues: [{ id: '1' }], issueErrors: [{ id: '2' }] }),
    });
    expect(await api.bulkFetch(['1', '2'], { fields: ['summary'], expand: ['renderedFields'] })).toEqual({ issues: [{ id: '1' }], errors: [{ id: '2' }] });
    expect(jira.calls).toEqual([{
      method: 'POST',
      path: '/rest/api/3/issue/bulkfetch',
      body: { issueIdsOrKeys: ['1', '2'], fields: ['summary'], expand: ['renderedFields'], fieldsByKeys: false },
    }]);
  });

  it('listComments pages by 100 with rendered bodies until total and keeps each comment whole', async () => {
    const page = (from, n) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), renderedBody: `<p>${from + i}</p>` }));
    const { jira, api } = client({
      'GET /rest/api/3/issue/10/comment': ({ path }) => (path.includes('startAt=0&')
        ? ok({ comments: page(0, 100), total: 150 })
        : ok({ comments: page(100, 50), total: 150 })),
    });
    const comments = await api.listComments('10');
    expect(comments).toEqual([...page(0, 100), ...page(100, 50)]);
    expect(jira.calls.map((c) => c.path)).toEqual([
      '/rest/api/3/issue/10/comment?expand=renderedBody&startAt=0&maxResults=100',
      '/rest/api/3/issue/10/comment?expand=renderedBody&startAt=100&maxResults=100',
    ]);
  });

  it('listWorklogs pages by 5000 until total', async () => {
    const { jira, api } = client({
      'GET /rest/api/3/issue/10/worklog': ({ path }) => (path.includes('startAt=0&')
        ? ok({ worklogs: [{ id: 'a' }], total: 2 })
        : ok({ worklogs: [{ id: 'b' }], total: 2 })),
    });
    expect(await api.listWorklogs('10')).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(jira.calls.map((c) => c.path)).toEqual([
      '/rest/api/3/issue/10/worklog?startAt=0&maxResults=5000',
      '/rest/api/3/issue/10/worklog?startAt=1&maxResults=5000',
    ]);
  });

  it('getMyself returns the account id and display name', async () => {
    const { api } = client({ 'GET /rest/api/3/myself': () => ok({ accountId: 'u1', displayName: 'Ann', emailAddress: 'a@x' }) });
    expect(await api.getMyself()).toEqual({ accountId: 'u1', displayName: 'Ann' });
  });

  it('boardJql reads the board configuration, then its filter, and returns the jql and board name', async () => {
    const { jira, api } = client({
      'GET /rest/agile/1.0/board/7/configuration': () => ok({ name: 'Team board', filter: { id: '1001' } }),
      'GET /rest/api/3/filter/1001': () => ok({ jql: 'project = A ORDER BY Rank' }),
    });
    expect(await api.boardJql(7)).toEqual({ jql: 'project = A ORDER BY Rank', name: 'Team board' });
    expect(jira.calls.map((c) => c.path)).toEqual(['/rest/agile/1.0/board/7/configuration', '/rest/api/3/filter/1001']);
  });

  it('filterName reads the saved filter and returns its name', async () => {
    const { jira, api } = client({ 'GET /rest/api/3/filter/10034': () => ok({ id: '10034', name: 'Filter for RPT board', jql: 'project = RPT' }) });
    expect(await api.filterName('10034')).toBe('Filter for RPT board');
    expect(jira.calls.map((c) => c.path)).toEqual(['/rest/api/3/filter/10034']);
  });

  it('sprintName reads the sprint and returns its name', async () => {
    const { jira, api } = client({ 'GET /rest/agile/1.0/sprint/5': () => ok({ name: 'Sprint 5' }) });
    expect(await api.sprintName('5')).toBe('Sprint 5');
    expect(jira.calls.map((c) => c.path)).toEqual(['/rest/agile/1.0/sprint/5']);
  });

  it('searchFilters queries filters by name with their jql and maps the values', async () => {
    const { jira, api } = client({
      'GET /rest/api/3/filter/search': () => ok({ values: [{ id: 10, name: 'My bugs', jql: 'type = Bug' }, { id: 11, name: 'No jql' }] }),
    });
    expect(await api.searchFilters('bugs')).toEqual([{ id: '10', name: 'My bugs', jql: 'type = Bug' }, { id: '11', name: 'No jql', jql: '' }]);
    expect(jira.calls.map((c) => c.path)).toEqual(['/rest/api/3/filter/search?filterName=bugs&expand=jql&maxResults=50']);
  });

  it('keeps at most 6 issue requests in flight across 20 parallel bulkFetch calls', async () => {
    const { jira, api } = client({ 'POST /rest/api/3/issue/bulkfetch': () => ok({ issues: [] }) });
    await Promise.all(Array.from({ length: 20 }, () => api.bulkFetch(['1'], { fields: [] })));
    expect(jira.maxInFlight()).toBe(6);
  });

  it('keeps at most 12 media requests in flight across 30 parallel attachmentBytes calls', async () => {
    const { jira, api } = client({ 'GET /rest/api/3/attachment/content/': () => ok(null) });
    await Promise.all(Array.from({ length: 30 }, (_, i) => api.attachmentBytes(String(i))));
    expect(jira.maxInFlight()).toBe(12);
  });

  it('attachmentBytes downloads the attachment content and returns its ArrayBuffer', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { jira, api } = client({ 'GET /rest/api/3/attachment/content/10001': () => ({ status: 200, bytes }) });
    expect(await api.attachmentBytes('10001')).toBe(bytes);
    expect(jira.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /rest/api/3/attachment/content/10001']);
  });

  it('attachmentThumbnail downloads the attachment thumbnail', async () => {
    const bytes = new Uint8Array([4]).buffer;
    const { jira, api } = client({ 'GET /rest/api/3/attachment/thumbnail/10001': () => ({ status: 200, bytes }) });
    expect(await api.attachmentThumbnail('10001')).toBe(bytes);
    expect(jira.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /rest/api/3/attachment/thumbnail/10001']);
  });
});
