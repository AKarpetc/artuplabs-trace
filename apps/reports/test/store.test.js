import { describe, expect, it } from 'vitest';
import { createTemplateStore } from '../src/templates/store.js';
import { TEMPLATE_MAX_PARTS } from '../src/templates/limits.js';
import { beginsWith, createFakeKvs } from './fakeKvs.js';

const ID = '11111111-1111-4111-8111-111111111111';
const GEN = '22222222-2222-4222-8222-222222222222';
const OLD = '33333333-3333-4333-8333-333333333333';

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

  it('writes the id index before the metadata', async () => {
    const { kvs, store } = setup();
    await store.save(meta({ id: ID }));
    expect(kvs.calls.ops).toEqual([`set tplid:${ID}`, `set tpl:user:acc:${ID}`]);
  });

  it('skips a listed record whose stored scope does not match the key', async () => {
    const { kvs, store } = setup();
    await store.save(meta({ id: 'a' }));
    kvs.data.set('tpl:user:acc:b', meta({ id: 'b', scopeId: 'intruder' }));
    kvs.data.set('tpl:user:acc:c', meta({ id: 'c', scope: 'site' }));
    expect((await store.list('user', 'acc')).map((m) => m.id)).toEqual(['a']);
  });

  it('stores and reads parts under tplbin:<id>:<gen>:<n>', async () => {
    const { kvs, store } = setup();
    await store.putPart(ID, GEN, 3, 'QUJD');
    expect([kvs.data.get(`tplbin:${ID}:${GEN}:3`), await store.getPart(ID, GEN, 3), await store.getPart(ID, GEN, 4), await store.getPart(ID, OLD, 3)])
      .toEqual(['QUJD', 'QUJD', undefined, undefined]);
  });

  it('lists the part indexes stored for one generation', async () => {
    const { store } = setup();
    for (const n of [4, 0, 2]) await store.putPart(ID, GEN, n, 'QQ==');
    await store.putPart(ID, OLD, 1, 'QQ==');
    expect(await store.partIndexes(ID, GEN)).toEqual([0, 2, 4]);
  });

  it('removes one generation of parts and keeps the others', async () => {
    const { kvs, store } = setup();
    for (let i = 0; i < TEMPLATE_MAX_PARTS; i += 1) await store.putPart(ID, OLD, i, 'QQ==');
    await store.putPart(ID, GEN, 0, 'QQ==');
    await store.removeGeneration(ID, OLD);
    expect([...kvs.data.keys()]).toEqual([`tplbin:${ID}:${GEN}:0`]);
  });

  it('removes the metadata, every generation of parts and then the index', async () => {
    const { kvs, store } = setup();
    await store.save(meta({ id: ID, kind: 'docx', format: 'docx' }));
    for (let i = 0; i < 3; i += 1) await store.putPart(ID, GEN, i, 'QQ==');
    await store.putPart(ID, OLD, 0, 'QQ==');
    await store.save(meta({ id: 'keep' }));
    kvs.calls.ops.length = 0;
    await store.remove(ID);
    expect([[...kvs.data.keys()], kvs.calls.ops.at(-1)]).toEqual([['tplid:keep', 'tpl:user:acc:keep'], `delete tplid:${ID}`]);
  });
});
