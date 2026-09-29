import { describe, expect, it, vi } from 'vitest';
import { createPermissions } from '../src/templates/permissions.js';

const ME = '557058:me';

function grants(global = [], byProject = {}) {
  return vi.fn(async (keys, projectKey) => {
    const held = projectKey ? byProject[projectKey] ?? [] : global;
    return Object.fromEntries(keys.map((k) => [k, held.includes(k)]));
  });
}

describe('createPermissions — user scope', () => {
  it('lets the owner view and manage', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants() });
    expect([await p.canView({ scope: 'user', scopeId: ME }), await p.canManage('user', ME)]).toEqual([true, true]);
  });

  it('denies another user view and manage without asking Jira', async () => {
    const fetchMyPermissions = grants(['ADMINISTER']);
    const p = createPermissions({ accountId: ME, fetchMyPermissions });
    expect([await p.canView({ scope: 'user', scopeId: 'other' }), await p.canManage('user', 'other'), fetchMyPermissions.mock.calls]).toEqual([false, false, []]);
  });
});

describe('createPermissions — site scope', () => {
  it('lets everyone view', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants() });
    expect(await p.canView({ scope: 'site', scopeId: 'site' })).toEqual(true);
  });

  it('lets a Jira administrator manage', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants(['ADMINISTER']) });
    expect(await p.canManage('site', 'site')).toEqual(true);
  });

  it('denies management without ADMINISTER', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants([], { RPT: ['ADMINISTER_PROJECTS'] }) });
    expect(await p.canManage('site', 'site')).toEqual(false);
  });
});

describe('createPermissions — project scope', () => {
  it('lets a user with BROWSE_PROJECTS view but not manage', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants([], { RPT: ['BROWSE_PROJECTS'] }) });
    expect([await p.canView({ scope: 'project', scopeId: 'RPT' }), await p.canManage('project', 'RPT')]).toEqual([true, false]);
  });

  it('lets a project administrator manage', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants([], { RPT: ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'] }) });
    expect(await p.canManage('project', 'RPT')).toEqual(true);
  });

  it('denies a user without BROWSE_PROJECTS', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants([], { OTHER: ['BROWSE_PROJECTS'] }) });
    expect(await p.canView({ scope: 'project', scopeId: 'RPT' })).toEqual(false);
  });

  it('asks Jira with the project key', async () => {
    const fetchMyPermissions = grants();
    await createPermissions({ accountId: ME, fetchMyPermissions }).canView({ scope: 'project', scopeId: 'RPT' });
    expect(fetchMyPermissions.mock.calls).toEqual([[['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'], 'RPT']]);
  });
});

describe('createPermissions — failures and caching', () => {
  it('denies when the permission call throws', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: vi.fn().mockRejectedValue(new Error('boom')) });
    expect([await p.canView({ scope: 'project', scopeId: 'RPT' }), await p.canManage('site', 'site')]).toEqual([false, false]);
  });

  it('denies when the permission call returns nothing', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: vi.fn().mockResolvedValue({}) });
    expect(await p.canManage('project', 'RPT')).toEqual(false);
  });

  it('denies an unknown scope', async () => {
    const p = createPermissions({ accountId: ME, fetchMyPermissions: grants(['ADMINISTER']) });
    expect([await p.canView({ scope: 'org', scopeId: 'x' }), await p.canManage('org', 'x'), await p.canView(null)]).toEqual([false, false, false]);
  });

  it('caches results per keys and project within one checker', async () => {
    const fetchMyPermissions = grants(['ADMINISTER'], { RPT: ['BROWSE_PROJECTS'] });
    const p = createPermissions({ accountId: ME, fetchMyPermissions });
    await p.canView({ scope: 'project', scopeId: 'RPT' });
    await p.canManage('project', 'RPT');
    await p.canManage('site', 'site');
    await p.canManage('site', 'site');
    await p.canView({ scope: 'project', scopeId: 'ABC' });
    expect(fetchMyPermissions.mock.calls).toEqual([
      [['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'], 'RPT'],
      [['ADMINISTER'], undefined],
      [['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'], 'ABC'],
    ]);
  });
});
