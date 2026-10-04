import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asApp: () => ({ requestJira: vi.fn() }) }, assumeTrustedRoute: (p) => p }));
const { createJira, JiraError, withDeadline } = await import('../../src/infra/jira.js');
const { FUNCTION_BUDGET_MS, JQL_CHECK_MS, RECONCILE_MAX, REQUEST_ATTEMPTS, RETRY_MAX_MS, WORKER_RETRY_MAX_MS, LEASE_MS } = await import('../../src/core/limits.js');

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

describe('deadline scope', () => {
  it('refuses a request once the deadline of its scope has passed', async () => {
    const { calls, request } = scripted([reply(200, {})]);
    const jira = createJira(request, { clock: () => 5000 });
    await expect(withDeadline(5000, () => jira.call('GET', '/x'))).rejects.toMatchObject({ name: 'DeadlineError' });
    expect(calls).toEqual([]);
  });
  it('sends requests before the deadline and outside any scope', async () => {
    const { calls, request } = scripted([reply(200, { a: 1 }), reply(200, { b: 2 })]);
    const jira = createJira(request, { clock: () => 4999 });
    expect(await withDeadline(5000, () => jira.call('GET', '/x'))).toEqual({ a: 1 });
    expect(await jira.call('GET', '/y')).toEqual({ b: 2 });
    expect(calls).toHaveLength(2);
  });
  it('keeps the deadlines of parallel scopes apart', async () => {
    const { request } = scripted([reply(200, { ok: 1 })]);
    const jira = createJira(request, { clock: () => 100 });
    const late = withDeadline(50, () => jira.call('GET', '/x')).catch((e) => e.name);
    const early = withDeadline(500, () => jira.call('GET', '/y'));
    expect(await Promise.all([late, early])).toEqual(['DeadlineError', { ok: 1 }]);
  });
});

describe('call', () => {
  it('waits Retry-After on 429 and then succeeds', async () => {
    const { request } = scripted([reply(429, {}, { 'retry-after': '1' }), reply(200, { ok: 1 })]);
    const sleep = vi.fn(async () => {});
    expect(await createJira(request, { sleep }).call('GET', '/x')).toEqual({ ok: 1 });
    expect(sleep.mock.calls).toEqual([[1000]]);
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
  it('expands a role group once per shared cache and skips a role group Jira no longer knows', async () => {
    const { request, calls } = scripted([
      reply(200, { Developers: 'https://x/rest/api/3/project/1/role/10' }),
      reply(200, { actors: [{ actorGroup: { name: 'devs' } }, { actorGroup: { name: 'gone' } }] }),
      reply(200, { values: [{ accountId: 'u1' }], isLast: true }),
      reply(404, { errorMessages: ['no group'] }),
      reply(200, { Developers: 'https://x/rest/api/3/project/2/role/10' }),
      reply(200, { actors: [{ actorGroup: { name: 'devs' } }] }),
    ]);
    const jira = createJira(request);
    const groups = new Map();
    expect(await jira.roleMemberIds('1', 'Developers', { groups })).toEqual(['u1']);
    expect(await jira.roleMemberIds('2', 'Developers', { groups })).toEqual(['u1']);
    expect(calls.filter((c) => c.path.includes('/group/member'))).toHaveLength(2);
  });
});

describe('index reads', () => {
  it('returns one search page with its token', async () => {
    const { request, calls } = scripted([reply(200, { issues: [{ id: 1 }], nextPageToken: 'x' })]);
    expect(await createJira(request).searchPage('project = "A" ORDER BY id ASC', null)).toEqual({ ids: ['1'], nextPageToken: 'x' });
    expect(calls[0].body).toEqual({ jql: 'project = "A" ORDER BY id ASC', fields: ['id'], maxResults: 5000 });
  });
  it('asks the next search page by its token and reads the last page', async () => {
    const { request, calls } = scripted([reply(200, {})]);
    expect(await createJira(request).searchPage('x', 'tok')).toEqual({ ids: [], nextPageToken: null });
    expect(calls[0].body.nextPageToken).toBe('tok');
  });
  it('lists projects as id and key', async () => {
    const { request } = scripted([reply(200, { values: [{ id: 10, key: 'A', name: 'n' }], isLast: true })]);
    expect(await createJira(request).projects()).toEqual([{ id: '10', key: 'A' }]);
  });
});

describe('subquery validation', () => {
  const parsed = (errors) => reply(200, { queries: [{ query: 'q', ...(errors ? { errors } : { structure: {} }) }] });
  it('asks Jira\'s strict parser about the query', async () => {
    const { request, calls } = scripted([parsed()]);
    await createJira(request).validateJql('project = A');
    expect(calls).toEqual([{ path: '/rest/api/3/jql/parse?validation=strict', method: 'POST', body: { queries: ['project = A'] } }]);
  });
  it('accepts a query the parser finds no errors in', async () => {
    const { request } = scripted([parsed()]);
    await expect(createJira(request).validateJql('project = A')).resolves.toBeUndefined();
  });
  it('rejects a query with a 400 carrying the parser\'s texts', async () => {
    const { request } = scripted([parsed(['Field \'projekt\' does not exist or you do not have permission to view it.', 'Second.'])]);
    const error = await createJira(request).validateJql('projekt = A').catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect([error.status, error.message]).toEqual([400, 'Field \'projekt\' does not exist or you do not have permission to view it.; Second.']);
  });
  it('asks once for the same query within the check window', async () => {
    let now = 1000;
    const { request, calls } = scripted([parsed(['Bad.'])]);
    const jira = createJira(request, { clock: () => now });
    await jira.validateJql('x = 1').catch(() => {});
    now += JQL_CHECK_MS - 1;
    await expect(jira.validateJql('x = 1')).rejects.toMatchObject({ status: 400, message: 'Bad.' });
    expect(calls).toHaveLength(1);
  });
  it('asks again once the check window has passed', async () => {
    let now = 1000;
    const { request, calls } = scripted([parsed(), parsed(['Gone.'])]);
    const jira = createJira(request, { clock: () => now });
    await jira.validateJql('x = 1');
    now += JQL_CHECK_MS;
    await expect(jira.validateJql('x = 1')).rejects.toMatchObject({ message: 'Gone.' });
    expect(calls).toHaveLength(2);
  });
  it('asks again after the parser call itself failed', async () => {
    const { request, calls } = scripted([reply(503, {}), parsed()]);
    const jira = createJira(request, { attempts: 1 });
    await expect(jira.validateJql('x = 1')).rejects.toMatchObject({ status: 503 });
    await expect(jira.validateJql('x = 1')).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });
});
