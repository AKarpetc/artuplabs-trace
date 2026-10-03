import { JOURNAL_TS_DIGITS } from '../core/limits.js';

const randomTag = () => Math.random().toString(36).slice(2);

/** Journal of touched issues in KVS: one key per event, so concurrent events never overwrite each other. */
export function createJournal({ kvs, beginsWith, random = randomTag }) {
  return {
    append: (record, ts) => kvs.set(`t:${String(ts).padStart(JOURNAL_TS_DIGITS, '0')}:${random()}`, record),
    read: async (limit) => (await kvs.query().where('key', beginsWith('t:')).limit(limit).getMany()).results ?? [],
    remove: async (keys) => {
      for (const key of keys) await kvs.delete(key);
    },
  };
}
