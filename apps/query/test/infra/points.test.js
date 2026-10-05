import { describe, expect, it, vi } from 'vitest';
import { beginsWith, createFakeKvs } from '../fakeKvs.js';
import { createLedger, newProcessPoints } from '../../src/infra/points.js';
import { POINTS_FLUSH, POINTS_KEY_MIN, POINTS_READ_MS } from '../../src/core/limits.js';
import { laneRoom } from '../../src/core/points.js';

const AT = Date.parse('2026-10-05T07:10:00Z');
const HOUR = '2026100507';

function setup({ pageSize = 100, kvs = createFakeKvs({ pageSize }) } = {}) {
  let now = AT;
  const clock = () => now;
  const make = (tag) => createLedger({ kvs, beginsWith, clock, own: newProcessPoints(tag) });
  return { kvs, make, advance: (ms) => { now += ms; } };
}

describe('points ledger', () => {
  it('keeps points below the end-of-invocation minimum in the process', async () => {
    const { kvs, make } = setup();
    const ledger = make('a');
    await ledger.add('fn', POINTS_KEY_MIN - 1);
    await ledger.flush();
    expect([...kvs.data.keys()]).toEqual([]);
  });
  it('writes the process total of a lane at the end of an invocation once it reaches the minimum', async () => {
    const { kvs, make } = setup();
    const ledger = make('a');
    await ledger.add('fn', POINTS_KEY_MIN - 1);
    await ledger.flush();
    await ledger.add('fn', 1);
    await ledger.flush();
    expect(Object.fromEntries(kvs.data)).toEqual({ [`q:pts:${HOUR}:fn:a`]: POINTS_KEY_MIN });
  });
  it('rewrites the key of a lane during an invocation once the unwritten points reach the flush size', async () => {
    const { kvs, make } = setup();
    const ledger = make('a');
    await ledger.add('refresh', POINTS_FLUSH - 1);
    expect(kvs.data.size).toEqual(0);
    await ledger.add('refresh', 1);
    await ledger.flush(Infinity);
    expect(Object.fromEntries(kvs.data)).toEqual({ [`q:pts:${HOUR}:refresh:a`]: POINTS_FLUSH });
  });
  it('overwrites its key with the running total instead of adding to it', async () => {
    const { kvs, make } = setup();
    const ledger = make('a');
    await ledger.add('fn', 30);
    await ledger.flush();
    await ledger.add('fn', 25);
    await ledger.flush();
    expect(kvs.data.get(`q:pts:${HOUR}:fn:a`)).toEqual(55);
  });
  it('sums the lanes of every process for the hour', async () => {
    const { make } = setup();
    const a = make('a');
    const b = make('b');
    await a.add('fn', 40);
    await a.add('refresh', 300);
    await a.flush();
    await b.add('fn', 25);
    await b.flush();
    expect(await make('c').siteSpent(HOUR)).toEqual({ byLane: { fn: 65, refresh: 300 }, total: 365 });
  });
  it('counts the unwritten points of its own process', async () => {
    const { make } = setup();
    const a = make('a');
    await a.add('fn', 5);
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: { fn: 5 }, total: 5 });
  });
  it('reads the other processes once per memo period', async () => {
    const { kvs, make, advance } = setup();
    const a = make('a');
    const b = make('b');
    await a.siteSpent(HOUR);
    await b.add('fn', 50);
    await b.flush();
    const queries = kvs.calls.queries;
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: {}, total: 0 });
    expect(kvs.calls.queries).toEqual(queries);
    advance(POINTS_READ_MS);
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: { fn: 50 }, total: 50 });
  });
  it('counts its own points written after the memo was read', async () => {
    const { make } = setup();
    const a = make('a');
    await a.siteSpent(HOUR);
    await a.add('fn', 60);
    await a.flush();
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: { fn: 60 }, total: 60 });
  });
  it('reads every page of the hour and logs how many it read', async () => {
    const { make } = setup({ pageSize: 2 });
    for (const tag of ['a', 'b', 'c']) {
      const ledger = make(tag);
      await ledger.add('fn', 20);
      await ledger.flush();
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await make('d').siteSpent(HOUR)).toEqual({ byLane: { fn: 60 }, total: 60 });
    expect(log.mock.calls).toEqual([['points ledger pages 2']]);
    log.mockRestore();
  });
  it('leaves out other hours', async () => {
    const { make, advance } = setup();
    const a = make('a');
    await a.add('fn', 30);
    await a.flush();
    advance(60 * 60 * 1000);
    await a.add('fn', 7);
    expect(await make('b').siteSpent('2026100508')).toEqual({ byLane: {}, total: 0 });
    expect(await a.siteSpent('2026100508')).toEqual({ byLane: { fn: 7 }, total: 7 });
  });
  it('writes the rest of the past hour under that hour', async () => {
    const { kvs, make, advance } = setup();
    const a = make('a');
    await a.add('fn', 25);
    advance(60 * 60 * 1000);
    await a.add('fn', 30);
    await a.flush();
    expect(Object.fromEntries(kvs.data)).toEqual({ [`q:pts:${HOUR}:fn:a`]: 25, 'q:pts:2026100508:fn:a': 30 });
  });
  it('counts a reserved step as spent until it is released', async () => {
    const { make } = setup();
    const a = make('a');
    const release = a.reserve('refresh', 400);
    a.reserve('heavy', 10)();
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: { refresh: 400 }, total: 400 });
    release();
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: {}, total: 0 });
  });
  it('keeps the points when a write fails and writes them the next time', async () => {
    const kvs = createFakeKvs();
    const set = kvs.set;
    kvs.set = async () => { throw new Error('kvs down'); };
    const { make } = setup({ kvs });
    const a = make('a');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await a.add('fn', 30);
    await a.flush();
    expect(error.mock.calls).toEqual([['points ledger write failed: Error']]);
    error.mockRestore();
    kvs.set = set;
    await a.flush();
    expect(kvs.data.get(`q:pts:${HOUR}:fn:a`)).toEqual(30);
  });
  it('deletes the keys of hours before the past one', async () => {
    const { kvs, make } = setup();
    await kvs.set('q:pts:2026100505:fn:a', 1);
    await kvs.set('q:pts:2026100506:fn:a', 2);
    await kvs.set(`q:pts:${HOUR}:fn:b`, 3);
    expect(await make('a').prune()).toEqual(1);
    expect([...kvs.data.keys()].sort()).toEqual(['q:pts:2026100506:fn:a', `q:pts:${HOUR}:fn:b`]);
  });
  it('tags each process with its own hex tag', () => {
    expect(newProcessPoints().proc).toMatch(/^[0-9a-f]{16}$/);
    expect(newProcessPoints().proc).not.toEqual(newProcessPoints().proc);
  });
  it('adds points without waiting for the write the flush size starts, which the end-of-invocation flush waits for', async () => {
    const kvs = createFakeKvs();
    const set = kvs.set;
    let open;
    kvs.set = (key, value) => new Promise((resolve) => { open = () => resolve(set(key, value)); });
    const { make } = setup({ kvs });
    const a = make('a');
    await a.add('fn', POINTS_FLUSH);
    expect(kvs.data.size).toEqual(0);
    const flushed = a.flush();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    open();
    await flushed;
    expect(kvs.data.get(`q:pts:${HOUR}:fn:a`)).toEqual(POINTS_FLUSH);
  });
  it('keeps writing after a write step failed unexpectedly', async () => {
    const kvs = createFakeKvs();
    const own = newProcessPoints('a');
    own.chain = Promise.reject(new Error('broken'));
    const a = createLedger({ kvs, beginsWith, clock: () => AT, own });
    await a.add('fn', 30);
    await a.flush();
    expect(kvs.data.get(`q:pts:${HOUR}:fn:a`)).toEqual(30);
  });
});

describe('points ledger snapshot', () => {
  it('reads the site points of the current hour by lane with its key count, past the read memo and with the own unwritten points', async () => {
    const { make } = setup();
    const a = make('a');
    const b = make('b');
    await b.add('refresh', POINTS_FLUSH);
    await b.flush();
    await a.siteSpent(HOUR);
    await b.add('heavy', POINTS_KEY_MIN);
    await b.flush();
    await a.add('fn', 5);
    expect(await a.snapshot()).toEqual({ hour: HOUR, byLane: { refresh: POINTS_FLUSH, heavy: POINTS_KEY_MIN, fn: 5 }, total: POINTS_FLUSH + POINTS_KEY_MIN + 5, keys: 2 });
  });
});

describe('points ledger claims', () => {
  const CAP = 9000;
  const LATE = Date.parse('2026-10-05T07:40:00Z');
  const ticks = async (ms) => { for (let i = 0; i < ms; i += 1) await null; };
  function shared({ at = AT } = {}) {
    const kvs = createFakeKvs({ pageSize: 100 });
    let n = 0;
    const make = (tag) => createLedger({ kvs, beginsWith, clock: () => at, own: newProcessPoints(tag), sleep: ticks, random: () => [0.1, 0.9, 0.5, 0.3][n++ % 4] });
    return { kvs, make };
  }
  const roomOf = (lane, at = AT) => (byLane) => laneRoom(lane, byLane, at, CAP);

  it('claims what the lane has left and writes it under the process key before any request', async () => {
    const { kvs, make } = shared();
    const claim = await make('a').claim('backfill', roomOf('backfill'));
    expect(claim.limit).toEqual(900);
    expect(Object.fromEntries(kvs.data)).toEqual({ [`q:pts:${HOUR}:backfill:a`]: { spent: 0, claim: 900 } });
  });
  it('lets two processes claiming one lane at once take no more than its room together, and one of them all of it', async () => {
    const { make } = shared();
    const claims = await Promise.all([make('a').claim('backfill', roomOf('backfill')), make('b').claim('backfill', roomOf('backfill'))]);
    expect(claims.map((c) => c.limit).sort((x, y) => x - y)).toEqual([0, 900]);
  });
  it('counts the points spent within a claim once, for this process and the others', async () => {
    const { make } = shared();
    const a = make('a');
    await a.claim('backfill', roomOf('backfill'));
    await a.add('backfill', 300);
    await a.flush();
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: { backfill: 900 }, total: 900 });
    expect(await make('b').siteSpent(HOUR)).toEqual({ byLane: { backfill: 900 }, total: 900 });
  });
  it('adds the points a step spends past its claim', async () => {
    const { make } = shared();
    const a = make('a');
    await a.claim('backfill', roomOf('backfill'));
    await a.add('backfill', 1000);
    expect(await a.siteSpent(HOUR)).toEqual({ byLane: { backfill: 1000 }, total: 1000 });
  });
  it('leaves only the spent points under the key once the claim is released', async () => {
    const { kvs, make } = shared();
    const a = make('a');
    const claim = await a.claim('backfill', roomOf('backfill'));
    await a.add('backfill', 300);
    claim.release();
    claim.release();
    await a.flush();
    expect(kvs.data.get(`q:pts:${HOUR}:backfill:a`)).toEqual(300);
    expect(await make('b').siteSpent(HOUR)).toEqual({ byLane: { backfill: 300 }, total: 300 });
  });
  it('releases every claim of the process at the end of an invocation', async () => {
    const { kvs, make } = shared();
    const a = make('a');
    await a.claim('refresh', roomOf('refresh'));
    await a.add('refresh', 40);
    a.releaseAll();
    await a.flush();
    expect(kvs.data.get(`q:pts:${HOUR}:refresh:a`)).toEqual(40);
  });
  it('leaves the claims of other processes out of the snapshot, which reports spent points only', async () => {
    const { make } = shared();
    const a = make('a');
    await a.claim('backfill', roomOf('backfill'));
    await a.add('backfill', 300);
    await a.flush(0);
    expect((await make('b').snapshot()).byLane).toEqual({ backfill: 300 });
  });
  it('reads a ledger key an older version wrote as a plain number', async () => {
    const { kvs, make } = shared();
    await kvs.set(`q:pts:${HOUR}:refresh:old`, 250);
    const b = make('b');
    expect([await b.siteSpent(HOUR), (await b.snapshot()).byLane]).toEqual([{ byLane: { refresh: 250 }, total: 250 }, { refresh: 250 }]);
  });
  it('claims nothing and writes nothing when the lane has no room', async () => {
    const { kvs, make } = shared();
    const a = make('a');
    await a.add('backfill', 900);
    await a.flush();
    const ops = kvs.calls.ops.length;
    expect((await a.claim('backfill', roomOf('backfill'))).limit).toEqual(0);
    expect(kvs.calls.ops.length).toEqual(ops);
  });
  it('keeps the function reserve when every other lane claims and spends its room in parallel processes after half past', async () => {
    const { make } = shared({ at: LATE });
    const lanes = ['refresh', 'heavy', 'reconcile', 'backfill', 'backfill', 'index-event', 'refresh', 'heavy'];
    const ledgers = lanes.map((lane, i) => [lane, make(`p${i}`)]);
    await Promise.all(ledgers.map(async ([lane, ledger]) => {
      const claim = await ledger.claim(lane, roomOf(lane, LATE));
      await ledger.add(lane, claim.limit);
      claim.release();
      await ledger.flush();
    }));
    const { byLane, total } = await make('fn').siteSpent(HOUR);
    expect(total).toBeLessThanOrEqual(CAP - 1350);
    expect(laneRoom('fn', byLane, LATE, CAP)).toBeGreaterThanOrEqual(1350);
  });
});
