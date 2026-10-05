import { randomBytes } from 'node:crypto';
import { CLAIM_JITTER_MS, CLAIM_TRIES, KVS_PAGE, POINTS_FLUSH, POINTS_KEY_MIN, POINTS_READ_MS } from '../core/limits.js';
import { HOUR_MS, hourKey, totalOf } from '../core/points.js';

const PREFIX = 'q:pts:';

/** Points state of one process: its tag, its totals per hour and lane with the part already written, its reserved steps and its read memo. */
export function newProcessPoints(proc = randomBytes(8).toString('hex')) {
  return { proc, hours: new Map(), reserved: {}, memo: null, chain: Promise.resolve() };
}

const PROCESS = newProcessPoints();

const addTo = (map, lane, n) => ({ ...map, [lane]: (map[lane] ?? 0) + n });
const pause = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const outstanding = (entry) => entry.claims.reduce((sum, c) => sum + Math.max(0, c.points - (entry.total - c.base)), 0);
const valueOf = (entry) => entry.total + outstanding(entry);
const stored = (entry) => (outstanding(entry) > 0 ? { spent: entry.total, claim: outstanding(entry) } : entry.total);
const parsed = (value) => (value && typeof value === 'object' ? { spent: Number(value.spent) || 0, claim: Number(value.claim) || 0 } : { spent: Number(value) || 0, claim: 0 });

/**
 * Ledger of the Jira points this process spends, per hour and lane: the process keeps a running total and overwrites its own key
 * `q:pts:<hour>:<lane>:<proc>` with it (one writer per key) once the unwritten part reaches POINTS_FLUSH, and at `flush` once it reaches
 * POINTS_KEY_MIN; the site's spending is the sum of every process's keys of the hour, read at most once per POINTS_READ_MS, plus the own
 * running totals and reserved steps. A background step claims its room first: the claim goes into the process key at once, so every other
 * process counts it as spent until it is released. A failed write is logged and retried with the next write.
 */
export function createLedger({ kvs, beginsWith, clock = Date.now, own = PROCESS, sleep = pause, random = Math.random }) {
  const keyOf = (hour, lane) => `${PREFIX}${hour}:${lane}:${own.proc}`;

  function laneOf(hour, lane) {
    if (!own.hours.has(hour)) own.hours.set(hour, new Map());
    const lanes = own.hours.get(hour);
    if (!lanes.has(lane)) lanes.set(lane, { total: 0, written: 0, writtenSpent: 0, claims: [] });
    return lanes.get(lane);
  }

  async function writeDue(min) {
    const keep = hourKey(clock() - HOUR_MS);
    for (const [hour, lanes] of own.hours) {
      for (const [lane, entry] of lanes) {
        const value = valueOf(entry);
        const total = entry.total;
        const moved = Math.max(Math.abs(value - entry.written), Math.abs(total - entry.writtenSpent));
        if (!moved || moved < min) continue;
        try {
          await kvs.set(keyOf(hour, lane), stored(entry));
          entry.written = value;
          entry.writtenSpent = total;
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

  async function others(hour, fresh = false) {
    const memo = own.memo;
    if (!fresh && memo && memo.hour === hour && clock() - memo.at < POINTS_READ_MS) return memo.byLane;
    const at = clock();
    const read = await rows(`${PREFIX}${hour}:`);
    if (read.pages > 1) console.log(`points ledger pages ${read.pages}`);
    const byLane = read.rows.reduce((acc, { key, value }) => {
      const [, , , lane, proc] = key.split(':');
      const { spent, claim } = parsed(value);
      return proc === own.proc ? acc : addTo(acc, lane, spent + claim);
    }, {});
    own.memo = { hour, at, byLane };
    return byLane;
  }

  async function spentIn(hour, fresh = false) {
    let byLane = { ...(await others(hour, fresh)) };
    for (const [lane, entry] of own.hours.get(hour) ?? []) byLane = addTo(byLane, lane, valueOf(entry));
    for (const [lane, n] of Object.entries(own.reserved)) if (n) byLane = addTo(byLane, lane, n);
    return { byLane, total: totalOf(byLane) };
  }

  async function claimOnce(hour, lane, roomOf, fresh) {
    const entry = laneOf(hour, lane);
    const wanted = Math.max(0, roomOf((await spentIn(hour, fresh)).byLane));
    if (!wanted) return { limit: 0, wanted };
    const claim = { points: wanted, base: entry.total };
    entry.claims.push(claim);
    await flush(0);
    const seen = addTo((await spentIn(hour, true)).byLane, lane, -Math.max(0, claim.points - (entry.total - claim.base)));
    claim.points = Math.max(0, Math.min(wanted, roomOf(seen)));
    const drop = () => {
      entry.claims = entry.claims.filter((c) => c !== claim);
    };
    if (claim.points < wanted) {
      drop();
      await flush(0);
      return { limit: 0, wanted, collided: true };
    }
    let released = false;
    return {
      limit: claim.points,
      wanted,
      release: () => {
        if (released) return;
        released = true;
        drop();
      },
    };
  }

  return {
    /** Adds the points of one answer to a lane of the current hour; once the lane's unwritten part reaches POINTS_FLUSH it queues the write of its key without waiting for it (`flush` waits for every queued write). */
    async add(lane, points) {
      const entry = laneOf(hourKey(clock()), lane);
      entry.total += points;
      if (valueOf(entry) - entry.written >= POINTS_FLUSH || entry.total - entry.writtenSpent >= POINTS_FLUSH) flush(POINTS_FLUSH);
    },
    flush,
    /** Points spent on the site in `hour` by lane and in total, with the steps this process has reserved. */
    async siteSpent(hour) {
      return spentIn(hour);
    },
    /**
     * Claims for one step of a lane the room `roomOf(byLane)` leaves: writes the claim into the process key, reads the other keys again past
     * the memo and keeps the claim only if the room still holds it with every claim it sees, else drops it and, when the room was taken by
     * a claim made at the same moment, tries again after a random pause. Returns the points the step may spend (0 when none) and a release.
     */
    async claim(lane, roomOf) {
      const hour = hourKey(clock());
      for (let attempt = 1; ; attempt += 1) {
        const got = await claimOnce(hour, lane, roomOf, attempt > 1);
        if (!got.collided || attempt >= CLAIM_TRIES) return { limit: got.limit, release: got.release ?? (() => {}) };
        await sleep(Math.floor(random() * CLAIM_JITTER_MS));
      }
    },
    /** Releases every claim of this process, as each invocation ends. */
    releaseAll() {
      for (const lanes of own.hours.values()) for (const entry of lanes.values()) entry.claims = [];
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
    /** The site's spent points of the current hour by lane and in total (claims left out), read past the memo, with this process's unwritten points and the number of keys. */
    async snapshot() {
      const hour = hourKey(clock());
      const { rows: found } = await rows(`${PREFIX}${hour}:`);
      let byLane = found.reduce((acc, { key, value }) => {
        const [, , , lane, proc] = key.split(':');
        return proc === own.proc ? acc : addTo(acc, lane, parsed(value).spent);
      }, {});
      for (const [lane, entry] of own.hours.get(hour) ?? []) byLane = addTo(byLane, lane, entry.total);
      return { hour, byLane, total: totalOf(byLane), keys: found.length };
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
