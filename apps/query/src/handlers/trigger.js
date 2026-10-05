import { LOG } from '../core/errors.js';
import { eventRecord } from '../core/events.js';
import { LEASE_MS, PENDING_STALE_MS } from '../core/limits.js';
import { hourKey, laneRoom } from '../core/points.js';
import { brakeOf } from './brake.js';
import { pushRefresh } from './refresh.js';

/** Idempotency key of a product event: issue id, event time and the changed items; never the changelog id, which Forge does not document. */
export function changeId(event, hash) {
  const items = Array.isArray(event?.changelog?.items) ? event.changelog.items : [];
  return hash(JSON.stringify([event?.eventType ?? null, event?.issue?.id ?? null, event?.timestamp ?? null, items]));
}

/** Points the index work of one event may spend: what the index-event lane has left, none while Jira warns that the pool is nearly used. */
async function eventRoom(deps) {
  if (!deps.points || !deps.siteCap || !deps.withPoints) return Infinity;
  const at = deps.now();
  const [pause, { byLane }] = await Promise.all([brakeOf(deps), deps.points.siteSpent(hourKey(at))]);
  return pause?.reason === 'near' ? 0 : laneRoom('index-event', byLane, at, deps.siteCap);
}

async function indexWithin(deps, event) {
  const room = await eventRoom(deps);
  const task = () => deps.indexEvent(event, { changeId: changeId(event, deps.hash) });
  try {
    await (room === Infinity ? task() : deps.withPoints(room, task, { scope: 'pass' }));
  } catch (error) {
    if (error?.name !== 'PointsError') throw error;
  }
}

/**
 * Product event → index rows (writes that need a Jira request only within the index-event points; the hourly index check catches the rest),
 * one journal record, and a refresh job unless one is pending or running; a failed index write is logged without values and left to the
 * hourly gap filler, so the journal still gets the event.
 */
export async function onEvent(deps, event) {
  const record = eventRecord(event);
  if (deps.debugEvents) {
    console.log(JSON.stringify({ event: event?.eventType, keys: Object.keys(event ?? {}), items: (Array.isArray(event?.changelog?.items) ? event.changelog.items : []).map((i) => [i?.field, i?.fieldId]), record }));
  }
  try {
    await indexWithin(deps, event);
  } catch (error) {
    console.error(LOG.indexFailed(error?.status));
  }
  const ts = deps.now();
  await deps.journal.append(record, ts);
  const [pending, running] = await Promise.all([deps.state.pending.get(), deps.state.lease.get()]);
  if (ts - (pending ?? 0) > PENDING_STALE_MS && ts - (running ?? 0) > LEASE_MS) await pushRefresh(deps, ts);
  return record;
}
