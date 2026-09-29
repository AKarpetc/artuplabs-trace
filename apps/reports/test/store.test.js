import { describe, expect, it } from 'vitest';
import { createTemplateStore } from '../src/templates/store.js';
import { TEMPLATE_MAX_PARTS } from '../src/templates/limits.js';
import { beginsWith, createFakeKvs } from './fakeKvs.js';

const ID = '11111111-1111-4111-8111-111111111111';

function setup() {
  const kvs = createFakeKvs({ pageSize: 2 });
  let n = 0;
  const newId = () => `00000000-0000-4000-8000-00000000000${n++}`;
  return { kvs, store: createTemplateStore({ kvs, beginsWith, newId }) };
}

const meta = (extra = {}) => ({ scope: 'user', scopeId: 'acc', name: 'N', format: 'xlsx', kind: 'columns', columns: ['key'], ...extra });

describe('createTemplateStore', () => {
  it('saves a new template under its scope key and an id index', async () => {
    const { kvs, store } = setup();
    const saved = await store.save(meta());
    expect([saved, Object.fromEntries(kvs.data)]).toEqual([
      meta({ id: '00000000-0000-4000-8000-000000000000' }),
      {
        'tpl:user:acc:00000000-0000-4000-8000-000000000000': meta({ id: '00000000-0000-4000-8000-000000000000' }),
        'tplid:00000000-0000-4000-8000-000000000000': { scope: 'user', scopeId: 'acc' },
      },
    ]);
  });

  it('keeps the id of an existing template on save', async () => {
    const { kvs, store } = setup();
    await store.save(meta({ id: ID, name: 'Renamed' }));
    expect(kvs.data.get(`tpl:user:acc:${ID}`)).toEqual(meta({ id: ID, name: 'Renamed' }));
  });

  it('lists a scope by key prefix and pages through the cursor', async () => {
    const { kvs, store } = setup();
    await store.save(meta({ id: 'a' }));
    await store.save(meta({ id: 'b' }));
    await store.save(meta({ id: 'c' }));
    await store.save(meta({ scopeId: 'acc2', id: 'd' }));
    const listed = await store.list('user', 'acc');
    expect([listed.map((m) => m.id), kvs.calls.queries]).toEqual([['a', 'b', 'c'], 2]);
  });

  it('does not list another project whose key starts with the same letters', async () => {
    const { store } = setup();
    await store.save(meta({ scope: 'project', scopeId: 'AB', id: 'x' }));
    await store.save(meta({ scope: 'project', scopeId: 'ABC', id: 'y' }));
    expect((await store.list('project', 'AB')).map((m) => m.id)).toEqual(['x']);
  });

  it('gets a template by id through the index', async () => {
    const { store } = setup();
    await store.save(meta({ scope: 'site', scopeId: 'site', id: ID }));
    expect(await store.get(ID)).toEqual(meta({ scope: 'site', scopeId: 'site', id: ID }));
  });

  it('returns undefined for an unknown id', async () => {
    const { store } = setup();
    expect(await store.get(ID)).toEqual(undefined);
  });

  it('stores and reads parts under tplbin:<id>:<n>', async () => {
    const { kvs, store } = setup();
    await store.putPart(ID, 3, 'QUJD');
    expect([kvs.data.get(`tplbin:${ID}:3`), await store.getPart(ID, 3), await store.getPart(ID, 4)]).toEqual(['QUJD', 'QUJD', undefined]);
  });

  it('removes parts from a given index up to the maximum', async () => {
    const { kvs, store } = setup();
    for (let i = 0; i < TEMPLATE_MAX_PARTS; i += 1) await store.putPart(ID, i, 'QQ==');
    await store.removePartsFrom(ID, 2);
    expect([...kvs.data.keys()]).toEqual([`tplbin:${ID}:0`, `tplbin:${ID}:1`]);
  });

  it('removes the metadata, the index and every part', async () => {
    const { kvs, store } = setup();
    await store.save(meta({ id: ID, kind: 'docx', format: 'docx' }));
    for (let i = 0; i < TEMPLATE_MAX_PARTS; i += 1) await store.putPart(ID, i, 'QQ==');
    await store.save(meta({ id: 'keep' }));
    await store.remove(ID);
    expect([...kvs.data.keys()]).toEqual(['tpl:user:acc:keep', 'tplid:keep']);
  });
});
