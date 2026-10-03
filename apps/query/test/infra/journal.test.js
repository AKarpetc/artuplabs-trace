import { describe, expect, it } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createJournal } from '../../src/infra/journal.js';

describe('journal', () => {
  it('writes one key per event so parallel events never overwrite each other', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    let n = 0;
    const journal = createJournal({ kvs, beginsWith, random: () => `r${(n += 1)}` });
    await Promise.all([journal.append({ ids: ['1'], kinds: ['link'] }, 5), journal.append({ ids: ['2'], kinds: ['link'] }, 5)]);
    expect(await journal.read(10)).toEqual([
      { key: 't:000000000000005:r1', value: { ids: ['1'], kinds: ['link'] } },
      { key: 't:000000000000005:r2', value: { ids: ['2'], kinds: ['link'] } },
    ]);
  });
  it('reads the oldest rows first and removes the given keys', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const journal = createJournal({ kvs, beginsWith, random: () => 'x' });
    await journal.append({ ids: [], kinds: ['sprint'] }, 20);
    await journal.append({ ids: ['1'], kinds: ['link'] }, 10);
    const rows = await journal.read(1);
    expect(rows.map((r) => r.key)).toEqual(['t:000000000000010:x']);
    await journal.remove(rows.map((r) => r.key));
    expect((await journal.read(10)).map((r) => r.key)).toEqual(['t:000000000000020:x']);
  });
  it('reads only journal rows, not other keys', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    await kvs.set('q:pending', { at: 1 });
    const journal = createJournal({ kvs, beginsWith, random: () => 'x' });
    await journal.append({ ids: ['1'], kinds: ['link'] }, 3);
    expect((await journal.read(10)).map((r) => r.key)).toEqual(['t:000000000000003:x']);
  });
  it('tags keys with a random suffix by default', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const journal = createJournal({ kvs, beginsWith });
    await journal.append({ ids: [], kinds: ['sprint'] }, 1);
    expect([...kvs.data.keys()][0]).toMatch(/^t:000000000000001:[0-9a-z]+$/);
  });
});
