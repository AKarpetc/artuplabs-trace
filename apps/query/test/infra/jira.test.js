import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asApp: () => ({ requestJira: vi.fn() }) }, assumeTrustedRoute: (p) => p }));
const { createJira, JiraError } = await import('../../src/infra/jira.js');
const { FUNCTION_BUDGET_MS, RECONCILE_MAX, REQUEST_ATTEMPTS, RETRY_MAX_MS, WORKER_RETRY_MAX_MS, LEASE_MS } = await import('../../src/core/limits.js');

const reply = (status, body, headers = {}) => ({ status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

function scripted(answers) {
  const calls = [];
  const request = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const next = answers.shift();
    return typeof next === 'function' ? next(path, init) : next;
  };
  return { calls, request };
}

describe('call', () => {
  it('waits Retry-After on 429 and then succeeds', async () => {
    const { request } = scripted([reply(429, {}, { 'retry-after': '2' }), reply(200, { ok: 1 })]);
    const sleep = vi.fn(async () => {});
    expect(await createJira(request, { sleep }).call('GET', '/x')).toEqual({ ok: 1 });
    expect(sleep.mock.calls).toEqual([[2000]]);
  });
  it('gives up on a 5xx after the last attempt', async () => {
    const { request, calls } = scripted([reply(503, {}), reply(503, {}), reply(503, { errorMessages: ['down'] })]);
    await expect(createJira(request, { sleep: async () => {}, attempts: 3 }).call('GET', '/x')).rejects.toMatchObject({ name: 'JiraError', status: 503, message: 'down' });
    expect(calls).toHaveLength(3);
  });
  it('keeps Jira messages of a 400', async () => {
    const { request } = scripted([reply(400, { errorMessages: ['Field "x" does not exist'], errors: { jql: 'bad' } })]);
    const error = await createJira(request).call('POST', '/x', {}).catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect([error.status, error.message]).toEqual([400, 'Field "x" does not exist; bad']);
  });
});

describe('reads', () => {
  it('pages ids by token and sends at most 50 reconcile ids as numbers', async () => {
    const { request, calls } = scripted([reply(200, { issues: [{ id: '1' }], nextPageToken: 't' }), reply(200, { issues: [{ id: 2 }] })]);
    const touched = Array.from({ length: 60 }, (_, i) => String(i + 1));
    expect(await createJira(request).searchIds('project = A', { reconcile: touched })).toEqual(['1', '2']);
    expect(calls[0].body).toEqual({ jql: 'project = A', fields: ['id'], maxResults: 5000, reconcileIssues: touched.slice(0, RECONCILE_MAX).map(Number) });
    expect(RECONCILE_MAX).toBe(50);
    expect(calls[1].body.nextPageToken).toBe('t');
  });
  it('bulkfetches in batches of 100', async () => {
    const answer = (_p, init) => reply(200, { issues: JSON.parse(init.body).issueIdsOrKeys.map((id) => ({ id })) });
    const { request, calls } = scripted([answer, answer, answer]);
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect((await createJira(request).bulkIssues(ids, ['parent'])).map((x) => x.id)).toEqual(ids);
    expect(calls.map((c) => c.body.issueIdsOrKeys.length).sort()).toEqual([100, 100, 50]);
  });
  it('merges changelog pages per issue', async () => {
    const { request, calls } = scripted([
      reply(200, { issueChangeLogs: [{ issueId: '1', changeHistories: [{ id: 'a' }] }], nextPageToken: 'n' }),
      reply(200, { issueChangeLogs: [{ issueId: '1', changeHistories: [{ id: 'b' }] }, { issueId: '2', changeHistories: [{ id: 'c' }] }] }),
    ]);
    const logs = await createJira(request).changelogs(['1', '2'], ['status']);
    expect([...logs.entries()]).toEqual([['1', [{ id: 'a' }, { id: 'b' }]], ['2', [{ id: 'c' }]]]);
    expect(calls[0].body).toEqual({ issueIdsOrKeys: ['1', '2'], fieldIds: ['status'], maxResults: 10000 });
  });
  it('lists precomputations until the last page', async () => {
    const { request, calls } = scripted([reply(200, { values: [{ id: 'a' }], isLast: false }), reply(200, { values: [{ id: 'b' }], isLast: true })]);
    expect(await createJira(request).precomputations()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(calls.map((c) => c.path)).toEqual(['/rest/api/3/jql/function/computation?startAt=0&maxResults=100', '/rest/api/3/jql/function/computation?startAt=1&maxResults=100']);
  });
  it('writes precomputations in batches of 50', async () => {
    const { request, calls } = scripted([reply(204), reply(204), reply(204)]);
    await createJira(request).writePrecomputations(Array.from({ length: 120 }, (_, i) => ({ id: String(i), value: 'id = 1' })));
    expect(calls.map((c) => c.body.values.length)).toEqual([50, 50, 20]);
    expect(calls[0].path).toBe('/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true');
  });
  it('finds a board by id and by name, and only by name when the id is unknown', async () => {
    const { request } = scripted([reply(200, { values: [{ id: 9, name: '7' }], isLast: true }), reply(200, { id: 7, name: 'Team' })]);
    expect(await createJira(request).boards('7')).toEqual([{ id: 7, name: 'Team' }, { id: 9, name: '7' }]);
    const missing = scripted([reply(200, { values: [{ id: 9, name: '7' }], isLast: true }), reply(404, { errorMessages: ['no'] })]);
    expect(await createJira(missing.request).boards('7')).toEqual([{ id: 9, name: '7' }]);
  });
  it('maps statuses to their categories', async () => {
    const { request } = scripted([reply(200, [{ id: '1', statusCategory: { key: 'done' } }, { id: 2, statusCategory: { key: 'new' } }])]);
    expect([...(await createJira(request).statusCategories()).entries()]).toEqual([['1', 'done'], ['2', 'new']]);
  });
});

describe('backoff and roles', () => {
  it('backs off exponentially when Retry-After is missing', async () => {
    const { request } = scripted([reply(502, {}), reply(500, {}), reply(200, [])]);
    const sleep = vi.fn(async () => {});
    await createJira(request, { sleep }).call('GET', '/x');
    expect(sleep.mock.calls).toEqual([[600], [1200]]);
  });
  it('caps a long Retry-After at the retry maximum', async () => {
    const { request } = scripted([reply(429, {}, { 'retry-after': '120' }), reply(200, {})]);
    const sleep = vi.fn(async () => {});
    await createJira(request, { sleep }).call('GET', '/x');
    expect(sleep.mock.calls).toEqual([[RETRY_MAX_MS]]);
  });
  it('waits a longer Retry-After in a queue worker than in a function call', async () => {
    const { request } = scripted([reply(429, {}, { 'retry-after': '20' }), reply(200, {})]);
    const sleep = vi.fn(async () => {});
    await createJira(request, { sleep, retryMaxMs: WORKER_RETRY_MAX_MS }).call('GET', '/x');
    expect(sleep.mock.calls).toEqual([[20000]]);
  });
  it('keeps a queue worker retry sleep inside the refresh lease', async () => {
    const { request } = scripted([reply(429, {}, { 'retry-after': '600' }), reply(200, {})]);
    const sleep = vi.fn(async () => {});
    await createJira(request, { sleep, retryMaxMs: WORKER_RETRY_MAX_MS }).call('GET', '/x');
    expect(sleep.mock.calls[0][0]).toBeLessThan(LEASE_MS);
  });
  it('keeps every retry sleep of one request inside the function budget', async () => {
    const { request } = scripted(Array.from({ length: REQUEST_ATTEMPTS }, () => reply(503, {})));
    const sleep = vi.fn(async () => {});
    await createJira(request, { sleep }).call('GET', '/x').catch(() => null);
    const slept = sleep.mock.calls.map(([ms]) => ms);
    expect([slept.length, slept.every((ms) => ms <= RETRY_MAX_MS), slept.reduce((a, b) => a + b, 0) < FUNCTION_BUDGET_MS]).toEqual([REQUEST_ATTEMPTS - 1, true, true]);
    expect((REQUEST_ATTEMPTS - 1) * RETRY_MAX_MS).toBeLessThan(FUNCTION_BUDGET_MS);
  });
  it('answers null for a role the project does not have', async () => {
    const { request } = scripted([reply(200, { Developers: 'https://x/rest/api/3/project/A/role/10' })]);
    expect(await createJira(request).roleMemberIds('A', 'Admins')).toBe(null);
  });
  it('merges role users with members of role groups without repeats', async () => {
    const { request, calls } = scripted([
      reply(200, { Developers: 'https://x/rest/api/3/project/A/role/10' }),
      reply(200, { actors: [{ actorUser: { accountId: 'u1' } }, { actorGroup: { name: 'devs' } }] }),
      reply(200, { values: [{ accountId: 'u1' }, { accountId: 'u2' }], isLast: true }),
    ]);
    expect(await createJira(request).roleMemberIds('A', 'developers')).toEqual(['u1', 'u2']);
    expect(calls[1].path).toBe('/rest/api/3/project/A/role/10');
  });
});
