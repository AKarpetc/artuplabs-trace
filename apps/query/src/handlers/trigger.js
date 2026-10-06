import { LOG } from '../core/errors.js';
import { eventRecord } from '../core/events.js';
import { EVENT_POINTS_CLAIM, LEASE_MS, PENDING_STALE_MS } from '../core/limits.js';
import { claimRoom } from './budget.js';
import { brakeOf } from './brake.js';
import { pushRefresh } from './refresh.js';
import { backgroundAllowed } from './licence.js';

/** Idempotency key of a product event: issue id, event time and the changed items; never the changelog id, which Forge does not document. */
export function changeId(event, hash) {
  const items = Array.isArray(event?.changelog?.items) ? event.changelog.items : [];
  return hash(JSON.stringify([event?.eventType ?? null, event?.issue?.id ?? null, event?.timestamp ?? null, items]));
}

/** Points the index work of one event may spend, claimed from what the index-event lane has left (at most EVENT_POINTS_CLAIM); none while the background is paused (429 or near limit). */
async function eventRoom(deps) {
  if (!deps.points || !deps.siteCap || !deps.withPoints) return { limit: Infinity };
  if (await brakeOf(deps)) return { limit: 0 };
  return claimRoom(deps, 'index-event', { least: 1, most: EVENT_POINTS_CLAIM });
}

async function indexWithin(deps, event) {
  const room = await eventRoom(deps);
  const task = () => deps.indexEvent(event, { changeId: changeId(event, deps.hash) });
  try {
    await (room.limit === Infinity ? task() : deps.withPoints(room.limit, task, { scope: 'pass' }));
  } catch (error) {
    if (error?.name !== 'PointsError') throw error;
  } finally {
    room.release?.();
  }
}

/**
 * Product event → index rows (writes that need a Jira request only within the index-event points; the hourly index check catches the rest),
 * one journal record, and a refresh job unless one is pending or running; a failed index write is logged without values and left to the
 * hourly gap filler, so the journal still gets the event; an unlicensed site's event is dropped.
 */
export async function onEvent(deps, event) {
  if (!(await backgroundAllowed(deps))) return { unlicensed: true };
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
