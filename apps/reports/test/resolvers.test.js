import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ defs: {}, user: undefined, kvs: undefined, requests: [] }));

vi.mock('@forge/resolver', () => ({
  default: class {
    define(key, fn) {
      h.defs[key] = fn;
    }

    getDefinitions() {
      return h.defs;
    }
  },
}));

vi.mock('@forge/kvs', async () => {
  const { createFakeKvs } = await import('./fakeKvs.js');
  h.kvs = createFakeKvs({ pageSize: 2 });
  return {
    kvs: h.kvs,
    default: h.kvs,
    WhereConditions: { beginsWith: (value) => ({ condition: 'BEGINS_WITH', values: [value] }) },
  };
});

const OWNER = '557058:owner';
const OTHER = '557058:other';
const PADMIN = '557058:project-admin';
const BROWSER = '557058:browser';
const JADMIN = '557058:jira-admin';
const OUTSIDER = '557058:outsider';

const GRANTS = {
  [PADMIN]: { global: [], RPT: ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'] },
  [BROWSER]: { global: [], RPT: ['BROWSE_PROJECTS'] },
  [JADMIN]: { global: ['ADMINISTER'], RPT: [] },
};

vi.mock('@forge/api', () => {
  const route = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '');
  const asUser = () => ({
    requestJira: async (path) => {
      h.requests.push({ user: h.user, path });
      const url = new URL(path, 'https://jira.example');
      const keys = url.searchParams.get('permissions').split(',');
      const projectKey = url.searchParams.get('projectKey');
      if (projectKey && projectKey !== 'RPT') return { ok: false, status: 404, json: async () => ({}) };
      const held = GRANTS[h.user]?.[projectKey ?? 'global'] ?? [];
      const permissions = Object.fromEntries(keys.map((k) => [k, { key: k, havePermission: held.includes(k) }]));
      return { ok: true, status: 200, json: async () => ({ permissions }) };
    },
  });
  return { default: { asUser }, asUser, route };
});

const { resolverHandler } = await import('../src/index.js');
const { TEMPLATE_MAX_PARTS, TEMPLATE_PART_BYTES } = await import('../src/templates/limits.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING = '99999999-9999-4999-8999-999999999999';

function call(name, payload, accountId, context = { environmentType: 'DEVELOPMENT' }) {
  h.user = accountId;
  return Promise.resolve().then(() => resolverHandler[name]({ payload, context: { ...context, accountId } }));
}

const columns = (extra = {}) => ({ scope: 'user', name: 'Mine', format: 'xlsx', kind: 'columns', columns: ['key'], ...extra });
const docx = (extra = {}) => ({ scope: 'project', scopeId: 'RPT', name: 'Contract', format: 'docx', kind: 'docx', ...extra });
const b64 = (bytes) => Buffer.alloc(bytes, 7).toString('base64');

beforeEach(() => {
  h.kvs.data.clear();
  h.requests.length = 0;
});

describe('getAccess', () => {
  it('denies an unlicensed production context', () => {
    const result = resolverHandler.getAccess({ context: { environmentType: 'PRODUCTION' } });
    expect(result).toEqual({ licensed: false, environmentType: 'PRODUCTION' });
  });

  it('allows a non-production context', () => {
    const result = resolverHandler.getAccess({ context: { environmentType: 'DEVELOPMENT' } });
    expect(result).toEqual({ licensed: true, environmentType: 'DEVELOPMENT' });
  });
});

describe('saveTemplate — personal', () => {
  it('creates a template owned by the caller with server-set fields', async () => {
    const saved = await call('saveTemplate', { template: columns() }, OWNER);
    expect(saved).toEqual({ ...columns(), id: expect.stringMatching(UUID), scopeId: OWNER, authorId: OWNER, parts: 0, size: 0, updatedAt: expect.any(String) });
  });

  it('ignores a client-sent authorId, authorName and scopeId', async () => {
    const saved = await call('saveTemplate', { template: columns({ authorId: OTHER, authorName: 'Mallory', scopeId: OTHER }) }, OWNER);
    expect([saved.authorId, saved.scopeId, 'authorName' in saved]).toEqual([OWNER, OWNER, false]);
  });

  it('lets the owner update it and keeps the author and id', async () => {
    const created = await call('saveTemplate', { template: columns() }, OWNER);
    const updated = await call('saveTemplate', { template: columns({ id: created.id, name: 'Renamed' }) }, OWNER);
    expect(updated).toEqual({ ...created, name: 'Renamed', updatedAt: expect.any(String) });
  });

  it('forbids another user to update it', async () => {
    const created = await call('saveTemplate', { template: columns() }, OWNER);
    await expect(call('saveTemplate', { template: columns({ id: created.id, name: 'Hijack' }) }, OTHER)).rejects.toThrow(new Error('forbidden'));
  });

  it('forbids another user to delete it', async () => {
    const created = await call('saveTemplate', { template: columns() }, OWNER);
    await expect(call('deleteTemplate', { id: created.id }, OTHER)).rejects.toThrow(new Error('forbidden'));
  });

  it('lets the owner delete it', async () => {
    const created = await call('saveTemplate', { template: columns() }, OWNER);
    const result = await call('deleteTemplate', { id: created.id }, OWNER);
    expect([result, [...h.kvs.data.keys()]]).toEqual([{ deleted: true }, []]);
  });

  it('shows it only to its owner', async () => {
    const created = await call('saveTemplate', { template: columns() }, OWNER);
    const mine = await call('listTemplates', {}, OWNER);
    const theirs = await call('listTemplates', {}, OTHER);
    expect([mine, theirs]).toEqual([{ user: [created], project: [], site: [] }, { user: [], project: [], site: [] }]);
  });
});

describe('saveTemplate — project and site', () => {
  it('lets a project administrator publish to the project', async () => {
    const saved = await call('saveTemplate', { template: docx() }, PADMIN);
    expect(saved).toEqual({ ...docx(), id: expect.stringMatching(UUID), authorId: PADMIN, parts: 0, size: 0, updatedAt: expect.any(String) });
  });

  it('forbids a non-admin to publish to the project', async () => {
    await expect(call('saveTemplate', { template: docx() }, BROWSER)).rejects.toThrow(new Error('forbidden'));
  });

  it('forbids publishing to a project the user cannot see', async () => {
    await expect(call('saveTemplate', { template: docx({ scopeId: 'SECRET' }) }, PADMIN)).rejects.toThrow(new Error('forbidden'));
  });

  it('lets a Jira administrator publish to the site', async () => {
    const saved = await call('saveTemplate', { template: columns({ scope: 'site' }) }, JADMIN);
    expect(saved).toEqual({ ...columns({ scope: 'site' }), scopeId: 'site', id: expect.stringMatching(UUID), authorId: JADMIN, parts: 0, size: 0, updatedAt: expect.any(String) });
  });

  it('forbids a non-admin to publish to the site', async () => {
    await expect(call('saveTemplate', { template: columns({ scope: 'site' }) }, PADMIN)).rejects.toThrow(new Error('forbidden'));
  });

  it('forbids a project administrator to change a site template', async () => {
    const created = await call('saveTemplate', { template: columns({ scope: 'site' }) }, JADMIN);
    await expect(call('saveTemplate', { template: columns({ scope: 'site', id: created.id, name: 'X' }) }, PADMIN)).rejects.toThrow(new Error('forbidden'));
  });

  it('rejects moving an existing template to another scope', async () => {
    const created = await call('saveTemplate', { template: docx() }, PADMIN);
    await expect(call('saveTemplate', { template: docx({ id: created.id, scope: 'user' }) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects changing the kind of an existing template', async () => {
    const created = await call('saveTemplate', { template: docx() }, PADMIN);
    await expect(call('saveTemplate', { template: docx({ id: created.id, kind: 'layout', layout: 'list' }) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects an id that does not exist with not-found', async () => {
    await expect(call('saveTemplate', { template: columns({ id: MISSING }) }, OWNER)).rejects.toThrow(new Error('not-found'));
  });

  it('rejects an invalid template with bad-request', async () => {
    await expect(call('saveTemplate', { template: columns({ name: '' }) }, OWNER)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a call without an account with forbidden', async () => {
    await expect(call('saveTemplate', { template: columns() }, undefined)).rejects.toThrow(new Error('forbidden'));
  });

  it('asks Jira for permissions as the user with the project key', async () => {
    await call('saveTemplate', { template: docx() }, PADMIN);
    expect(h.requests).toEqual([{ user: PADMIN, path: '/rest/api/3/mypermissions?permissions=BROWSE_PROJECTS%2CADMINISTER_PROJECTS&projectKey=RPT' }]);
  });
});

describe('listTemplates and getScopes', () => {
  it('hides project templates of projects the user cannot browse', async () => {
    const project = await call('saveTemplate', { template: docx() }, PADMIN);
    const site = await call('saveTemplate', { template: columns({ scope: 'site' }) }, JADMIN);
    const browser = await call('listTemplates', { projectKeys: ['RPT'] }, BROWSER);
    const outsider = await call('listTemplates', { projectKeys: ['RPT'] }, OUTSIDER);
    expect([browser, outsider]).toEqual([{ user: [], project: [project], site: [site] }, { user: [], project: [], site: [site] }]);
  });

  it('rejects more than 20 project keys', async () => {
    const keys = Array.from({ length: 21 }, (_, i) => `P${i}`);
    await expect(call('listTemplates', { projectKeys: keys }, OWNER)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a malformed project key', async () => {
    await expect(call('listTemplates', { projectKeys: ['rpt'] }, OWNER)).rejects.toThrow(new Error('bad-request'));
  });

  it('returns only stored metadata fields', async () => {
    const created = await call('saveTemplate', { template: columns() }, OWNER);
    h.kvs.data.set(`tpl:user:${OWNER}:${created.id}`, { ...created, secret: 'x' });
    expect((await call('listTemplates', {}, OWNER)).user).toEqual([created]);
  });

  it('reports where a project administrator may publish', async () => {
    expect(await call('getScopes', { projectKeys: ['RPT', 'OTHER'] }, PADMIN)).toEqual({ site: false, projects: ['RPT'] });
  });

  it('reports that a Jira administrator may publish to the site', async () => {
    expect(await call('getScopes', { projectKeys: ['RPT'] }, JADMIN)).toEqual({ site: true, projects: [] });
  });
});

describe('uploadTemplatePart', () => {
  async function docxTemplate() {
    return call('saveTemplate', { template: docx() }, PADMIN);
  }

  it('stores the parts and sets parts and size on the last one', async () => {
    const { id } = await docxTemplate();
    const first = await call('uploadTemplatePart', { id, index: 0, total: 2, data: b64(TEMPLATE_PART_BYTES) }, PADMIN);
    const last = await call('uploadTemplatePart', { id, index: 1, total: 2, data: b64(10) }, PADMIN);
    const [meta] = (await call('listTemplates', { projectKeys: ['RPT'] }, PADMIN)).project;
    expect([first, last, meta.parts, meta.size]).toEqual([{ stored: 0 }, { stored: 1 }, 2, TEMPLATE_PART_BYTES + 10]);
  });

  it('accepts parts out of order', async () => {
    const { id } = await docxTemplate();
    await call('uploadTemplatePart', { id, index: 1, total: 2, data: b64(3) }, PADMIN);
    await call('uploadTemplatePart', { id, index: 0, total: 2, data: b64(TEMPLATE_PART_BYTES) }, PADMIN);
    expect(await call('getTemplatePart', { id, index: 1 }, PADMIN)).toEqual({ data: b64(3) });
  });

  it('deletes stale parts above the new total', async () => {
    const { id } = await docxTemplate();
    for (let i = 0; i < 3; i += 1) await call('uploadTemplatePart', { id, index: i, total: 3, data: b64(i < 2 ? TEMPLATE_PART_BYTES : 5) }, PADMIN);
    await call('uploadTemplatePart', { id, index: 0, total: 1, data: b64(4) }, PADMIN);
    expect([...h.kvs.data.keys()].filter((k) => k.startsWith('tplbin:'))).toEqual([`tplbin:${id}:0`]);
  });

  it('rejects a part over 150 KB decoded with too-large', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0, total: 1, data: b64(TEMPLATE_PART_BYTES + 1) }, PADMIN)).rejects.toThrow(new Error('too-large'));
  });

  it('rejects index equal to total', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 2, total: 2, data: b64(4) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a total above the part maximum', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0, total: TEMPLATE_MAX_PARTS + 1, data: b64(TEMPLATE_PART_BYTES) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a template whose kind is not docx', async () => {
    const { id } = await call('saveTemplate', { template: columns() }, OWNER);
    await expect(call('uploadTemplatePart', { id, index: 0, total: 1, data: b64(4) }, OWNER)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects data that is not base64', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0, total: 1, data: 'not base64!' }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a non-last part that is not a full part', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0, total: 2, data: b64(10) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a non-integer index', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0.5, total: 1, data: b64(4) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('rejects a total sent as a string', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0, total: '2', data: b64(TEMPLATE_PART_BYTES) }, PADMIN)).rejects.toThrow(new Error('bad-request'));
  });

  it('forbids a user who cannot manage the template', async () => {
    const { id } = await docxTemplate();
    await expect(call('uploadTemplatePart', { id, index: 0, total: 1, data: b64(4) }, BROWSER)).rejects.toThrow(new Error('forbidden'));
  });

  it('rejects an unknown template with not-found', async () => {
    await expect(call('uploadTemplatePart', { id: MISSING, index: 0, total: 1, data: b64(4) }, PADMIN)).rejects.toThrow(new Error('not-found'));
  });
});

describe('getTemplatePart', () => {
  async function uploaded() {
    const { id } = await call('saveTemplate', { template: docx() }, PADMIN);
    await call('uploadTemplatePart', { id, index: 0, total: 1, data: b64(6) }, PADMIN);
    return id;
  }

  it('returns a part to a user who can view the template', async () => {
    const id = await uploaded();
    expect(await call('getTemplatePart', { id, index: 0 }, BROWSER)).toEqual({ data: b64(6) });
  });

  it('forbids a user who cannot view the template', async () => {
    const id = await uploaded();
    await expect(call('getTemplatePart', { id, index: 0 }, OUTSIDER)).rejects.toThrow(new Error('forbidden'));
  });

  it('forbids another user to read a personal template part', async () => {
    const { id } = await call('saveTemplate', { template: docx({ scope: 'user', scopeId: undefined }) }, OWNER);
    await call('uploadTemplatePart', { id, index: 0, total: 1, data: b64(6) }, OWNER);
    await expect(call('getTemplatePart', { id, index: 0 }, OTHER)).rejects.toThrow(new Error('forbidden'));
  });

  it('rejects an index beyond the stored parts with not-found', async () => {
    const id = await uploaded();
    await expect(call('getTemplatePart', { id, index: 1 }, PADMIN)).rejects.toThrow(new Error('not-found'));
  });
});

describe('licence and errors', () => {
  const UNLICENSED = { environmentType: 'PRODUCTION', license: { active: false } };
  const payloads = {
    listTemplates: {},
    getScopes: { projectKeys: ['RPT'] },
    saveTemplate: { template: columns() },
    uploadTemplatePart: { id: MISSING, index: 0, total: 1, data: 'QQ==' },
    getTemplatePart: { id: MISSING, index: 0 },
    deleteTemplate: { id: MISSING },
  };

  it.each(Object.keys(payloads))('rejects %s in an unlicensed production context before touching storage', async (name) => {
    const spies = ['get', 'set', 'delete', 'query'].map((m) => vi.spyOn(h.kvs, m));
    await expect(call(name, payloads[name], OWNER, UNLICENSED)).rejects.toThrow(new Error('unlicensed'));
    expect([spies.map((s) => s.mock.calls.length), h.requests]).toEqual([[0, 0, 0, 0], []]);
    spies.forEach((s) => s.mockRestore());
  });

  it('allows a licensed production context', async () => {
    const result = await call('listTemplates', {}, OWNER, { environmentType: 'PRODUCTION', license: { active: true } });
    expect(result).toEqual({ user: [], project: [], site: [] });
  });

  it('hides internal error details behind a generic code', async () => {
    const spy = vi.spyOn(h.kvs, 'get').mockRejectedValue(new Error('storage exploded at shard 7'));
    await expect(call('deleteTemplate', { id: MISSING }, OWNER)).rejects.toThrow(new Error('internal'));
    spy.mockRestore();
  });

  it('rejects a payload that is not an object with bad-request', async () => {
    await expect(call('deleteTemplate', null, OWNER)).rejects.toThrow(new Error('bad-request'));
  });
});
