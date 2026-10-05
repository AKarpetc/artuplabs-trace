import { randomBytes } from 'node:crypto';
import { KVS_PAGE, POINTS_FLUSH, POINTS_KEY_MIN, POINTS_READ_MS } from '../core/limits.js';
import { HOUR_MS, hourKey } from '../core/points.js';

const PREFIX = 'q:pts:';

/** Points state of one process: its tag, its totals per hour and lane with the part already written, its reserved steps and its read memo. */
export function newProcessPoints(proc = randomBytes(8).toString('hex')) {
  return { proc, hours: new Map(), reserved: {}, memo: null, chain: Promise.resolve() };
}

const PROCESS = newProcessPoints();

const addTo = (map, lane, n) => ({ ...map, [lane]: (map[lane] ?? 0) + n });
const totalOf = (byLane) => Object.values(byLane).reduce((sum, n) => sum + n, 0);

/**
 * Ledger of the Jira points this process spends, per hour and lane: the process keeps a running total and overwrites its own key
 * `q:pts:<hour>:<lane>:<proc>` with it (one writer per key) once the unwritten part reaches POINTS_FLUSH, and at `flush` once it reaches
 * POINTS_KEY_MIN; the site's spending is the sum of every process's keys of the hour, read at most once per POINTS_READ_MS, plus the own
 * running totals and reserved steps. A failed write is logged and retried with the next write.
 */
export function createLedger({ kvs, beginsWith, clock = Date.now, own = PROCESS }) {
  const keyOf = (hour, lane) => `${PREFIX}${hour}:${lane}:${own.proc}`;

  function laneOf(hour, lane) {
    if (!own.hours.has(hour)) own.hours.set(hour, new Map());
    const lanes = own.hours.get(hour);
    if (!lanes.has(lane)) lanes.set(lane, { total: 0, written: 0 });
    return lanes.get(lane);
  }

  async function writeDue(min) {
    const keep = hourKey(clock() - HOUR_MS);
    for (const [hour, lanes] of own.hours) {
      for (const [lane, entry] of lanes) {
        const total = entry.total;
        if (total - entry.written < min) continue;
        try {
          await kvs.set(keyOf(hour, lane), total);
          entry.written = Math.max(entry.written, total);
        } catch (error) {
          console.error(`points ledger write failed: ${error?.name}`);
        }
      }
      if (hour < keep) own.hours.delete(hour);
    }
  }

  function flush(min = POINTS_KEY_MIN) {
    own.chain = own.chain.catch(() => null).then(() => writeDue(min)).catch((error) => {
      console.error(`points ledger write failed: ${error?.name}`);
    });
    return own.chain;
  }

  async function rows(prefix) {
    const out = [];
    let cursor;
    let pages = 0;
    do {
      const query = kvs.query().where('key', beginsWith(prefix)).limit(KVS_PAGE);
      const page = await (cursor ? query.cursor(cursor) : query).getMany();
      pages += 1;
      out.push(...(page.results ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return { rows: out, pages };
  }

  async function others(hour) {
    const memo = own.memo;
    if (memo && memo.hour === hour && clock() - memo.at < POINTS_READ_MS) return memo.byLane;
    const at = clock();
    const read = await rows(`${PREFIX}${hour}:`);
    if (read.pages > 1) console.log(`points ledger pages ${read.pages}`);
    const byLane = read.rows.reduce((acc, { key, value }) => {
      const [, , , lane, proc] = key.split(':');
      return proc === own.proc ? acc : addTo(acc, lane, Number(value) || 0);
    }, {});
    own.memo = { hour, at, byLane };
    return byLane;
  }

  return {
    /** Adds the points of one answer to a lane of the current hour; once the lane's unwritten part reaches POINTS_FLUSH it queues the write of its key without waiting for it (`flush` waits for every queued write). */
    async add(lane, points) {
      const entry = laneOf(hourKey(clock()), lane);
      entry.total += points;
      if (entry.total - entry.written >= POINTS_FLUSH) flush(POINTS_FLUSH);
    },
    flush,
    /** Points spent on the site in `hour` by lane and in total, with the steps this process has reserved. */
    async siteSpent(hour) {
      let byLane = { ...(await others(hour)) };
      for (const [lane, entry] of own.hours.get(hour) ?? []) byLane = addTo(byLane, lane, entry.total);
      for (const [lane, n] of Object.entries(own.reserved)) if (n) byLane = addTo(byLane, lane, n);
      return { byLane, total: totalOf(byLane) };
    },
    /** Counts the estimate of a step as spent on a lane until the returned release is called. */
    reserve(lane, points) {
      own.reserved = addTo(own.reserved, lane, points);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        own.reserved = addTo(own.reserved, lane, -points);
      };
    },
    /** Deletes the ledger keys of the hours before the past one; returns how many. */
    async prune() {
      const keep = hourKey(clock() - HOUR_MS);
      const old = (await rows(PREFIX)).rows.filter(({ key }) => key.split(':')[2] < keep);
      for (const { key } of old) await kvs.delete(key);
      return old.length;
    },
  };
}
