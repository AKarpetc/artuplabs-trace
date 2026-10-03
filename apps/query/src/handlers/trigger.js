import { eventRecord } from '../core/events.js';
import { LEASE_MS, PENDING_STALE_MS } from '../core/limits.js';
import { pushRefresh } from './refresh.js';

/** Idempotency key of a product event: issue id, event time and the changed items; never the changelog id, which Forge does not document. */
export function changeId(event, hash) {
  const items = Array.isArray(event?.changelog?.items) ? event.changelog.items : [];
  return hash(JSON.stringify([event?.eventType ?? null, event?.issue?.id ?? null, event?.timestamp ?? null, items]));
}

/** Product event → index rows, one journal record, and a refresh job unless one is pending or running. */
export async function onEvent(deps, event) {
  const record = eventRecord(event);
  if (deps.debugEvents) {
    console.log(JSON.stringify({ event: event?.eventType, keys: Object.keys(event ?? {}), items: (Array.isArray(event?.changelog?.items) ? event.changelog.items : []).map((i) => [i?.field, i?.fieldId]), record }));
  }
  await deps.indexEvent(event, { changeId: changeId(event, deps.hash) });
  const ts = deps.now();
  await deps.journal.append(record, ts);
  const [pending, running] = await Promise.all([deps.state.pending.get(), deps.state.lease.get()]);
  if (ts - (pending ?? 0) > PENDING_STALE_MS && ts - (running ?? 0) > LEASE_MS) await pushRefresh(deps, ts);
  return record;
}
