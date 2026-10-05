import { POINTS_OVERHEAD } from '../core/limits.js';
import { laneRoom, retryAfter } from '../core/points.js';

/**
 * Claims for one step of `lane` the points the lane has left as of now, at most `most`, so that parallel processes cannot spend the same
 * room: `{ limit, release }`, or `{ waitUntil, limit }` with nothing claimed when less than `least` is left (just after half past or the hour).
 */
export async function claimRoom(deps, lane, { least = POINTS_OVERHEAD, most = Infinity } = {}) {
  const at = deps.now();
  const claim = await deps.points.claim(lane, (byLane) => Math.min(most, laneRoom(lane, byLane, at, deps.siteCap)));
  if (claim.limit >= least) return claim;
  claim.release();
  return { waitUntil: retryAfter(at), limit: claim.limit };
}
