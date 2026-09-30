import { randomUUID } from 'node:crypto';
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { decideLicence } from './access.js';
import { TEMPLATE_MAX_BYTES, TEMPLATE_MAX_PARTS, TEMPLATE_PART_BYTES } from './templates/limits.js';
import { createPermissions } from './templates/permissions.js';
import { createTemplateStore } from './templates/store.js';
import { SITE_SCOPE_ID, isProjectKey, isUuid, validateTemplate } from './templates/validate.js';

const CODES = new Set(['forbidden', 'not-found', 'bad-request', 'too-large', 'unlicensed']);
const META_FIELDS = ['id', 'scope', 'scopeId', 'name', 'format', 'kind', 'columns', 'rowMode', 'groupBy', 'summary',
  'layout', 'paper', 'fileNamePattern', 'placeholders', 'parts', 'size', 'authorId', 'updatedAt'];
const MAX_PROJECT_KEYS = 20;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const store = createTemplateStore({ kvs, beginsWith: WhereConditions.beginsWith, newId: randomUUID });
const resolver = new Resolver();

async function fetchMyPermissions(keys, projectKey) {
  const response = projectKey
    ? await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=${keys.join(',')}&projectKey=${projectKey}`)
    : await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=${keys.join(',')}`);
  if (response.status === 429 || response.status >= 500) throw new Error(`mypermissions ${response.status}`);
  if (!response.ok) return {};
  const body = await response.json();
  return Object.fromEntries(keys.map((k) => [k, body.permissions?.[k]?.havePermission === true]));
}

const fail = (code) => {
  throw new Error(code);
};

const isIndex = (v, max) => Number.isInteger(v) && v >= 0 && v < max;

const publicMeta = (meta) => Object.fromEntries(META_FIELDS.filter((k) => meta?.[k] !== undefined).map((k) => [k, meta[k]]));

function decodedSize(data) {
  return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

function projectKeysOf(payload) {
  const keys = payload.projectKeys ?? [];
  if (!Array.isArray(keys) || keys.length > MAX_PROJECT_KEYS || !keys.every(isProjectKey)) fail('bad-request');
  return [...new Set(keys)];
}

async function existing(id) {
  if (!isUuid(id)) fail('bad-request');
  return (await store.get(id)) ?? fail('not-found');
}

function defineTemplate(key, handle) {
  resolver.define(key, async ({ payload, context }) => {
    try {
      if (!decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed) fail('unlicensed');
      const accountId = context?.accountId;
      if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) fail('forbidden');
      if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) fail('bad-request');
      const permissions = createPermissions({ accountId, fetchMyPermissions });
      return await handle(payload ?? {}, { accountId, permissions });
    } catch (error) {
      if (CODES.has(error?.message)) throw new Error(error.message);
      console.error(`${key} failed: ${error?.message}`);
      throw new Error('internal');
    }
  });
}

resolver.define('getAccess', ({ context }) => ({
  ...decideLicence({ environmentType: context.environmentType, license: context.license }),
  environmentType: context.environmentType ?? '',
}));

defineTemplate('listTemplates', async (payload, { accountId, permissions }) => {
  const keys = projectKeysOf(payload);
  const visible = await Promise.all(keys.map((k) => permissions.canView({ scope: 'project', scopeId: k })));
  const lists = await Promise.all(keys.filter((_, i) => visible[i]).map((k) => store.list('project', k)));
  const [user, site] = await Promise.all([store.list('user', accountId), store.list('site', SITE_SCOPE_ID)]);
  return { user: user.map(publicMeta), project: lists.flat().map(publicMeta), site: site.map(publicMeta) };
});

defineTemplate('getScopes', async (payload, { permissions }) => {
  const keys = projectKeysOf(payload);
  const managed = await Promise.all(keys.map((k) => permissions.canManage('project', k)));
  return { site: await permissions.canManage('site', SITE_SCOPE_ID), projects: keys.filter((_, i) => managed[i]) };
});

defineTemplate('saveTemplate', async ({ template }, { accountId, permissions }) => {
  const clean = validateTemplate(template);
  if (clean === 'bad-request') fail('bad-request');
  const scopeId = clean.scope === 'user' ? accountId : clean.scopeId;
  const updatedAt = new Date().toISOString();
  if (clean.id === undefined) {
    if (!(await permissions.canManage(clean.scope, scopeId))) fail('forbidden');
    return publicMeta(await store.save({ ...clean, scopeId, id: randomUUID(), authorId: accountId, parts: 0, size: 0, updatedAt }));
  }
  const stored = await existing(clean.id);
  if (!(await permissions.canManage(stored.scope, stored.scopeId))) fail('forbidden');
  if (stored.scope !== clean.scope || stored.scopeId !== scopeId || stored.kind !== clean.kind) fail('bad-request');
  const { authorId, gen, parts, size } = stored;
  return publicMeta(await store.save({ ...clean, scopeId, authorId, gen, parts, size, updatedAt }));
});

/** uploadTemplatePart({ id, uploadId, index, total, data }): parts wait under the upload's generation; the last one switches the template to it. */
defineTemplate('uploadTemplatePart', async ({ id, uploadId, index, total, data }, { permissions }) => {
  if (!isUuid(uploadId)) fail('bad-request');
  if (!Number.isInteger(total) || !isIndex(total - 1, TEMPLATE_MAX_PARTS) || !isIndex(index, total)) fail('bad-request');
  if (typeof data !== 'string' || data === '' || !BASE64.test(data)) fail('bad-request');
  const size = decodedSize(data);
  if (size > TEMPLATE_PART_BYTES) fail('too-large');
  const last = index === total - 1;
  if (!last && size !== TEMPLATE_PART_BYTES) fail('bad-request');
  const fileSize = (total - 1) * TEMPLATE_PART_BYTES + size;
  if (last && fileSize > TEMPLATE_MAX_BYTES) fail('too-large');
  const stored = await existing(id);
  if (!(await permissions.canManage(stored.scope, stored.scopeId))) fail('forbidden');
  if (stored.kind !== 'docx' || stored.gen === uploadId) fail('bad-request');
  await store.putPart(id, uploadId, index, data);
  if (last) {
    const present = new Set(await store.partIndexes(id, uploadId));
    if (!Array.from({ length: total }, (_, i) => i).every((i) => present.has(i))) fail('bad-request');
    await store.save({ ...stored, gen: uploadId, parts: total, size: fileSize, updatedAt: new Date().toISOString() });
    if (stored.gen) await store.removeGeneration(id, stored.gen);
  }
  return { stored: index };
});

defineTemplate('getTemplatePart', async ({ id, index }, { permissions }) => {
  if (!isIndex(index, TEMPLATE_MAX_PARTS)) fail('bad-request');
  const stored = await existing(id);
  if (!(await permissions.canView(stored))) fail('forbidden');
  if (!stored.gen || index >= (stored.parts ?? 0)) fail('not-found');
  const data = await store.getPart(id, stored.gen, index);
  if (typeof data !== 'string') fail('not-found');
  return { data };
});

defineTemplate('deleteTemplate', async ({ id }, { permissions }) => {
  const stored = await existing(id);
  if (!(await permissions.canManage(stored.scope, stored.scopeId))) fail('forbidden');
  await store.remove(id);
  return { deleted: true };
});

/** Forge resolver entry point. */
export const handler = resolver.getDefinitions();
