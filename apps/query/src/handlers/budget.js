import { POINTS_OVERHEAD } from '../core/limits.js';
import { laneRoom, retryAfter, stepClaim } from '../core/points.js';

/**
 * Claims for one step of `lane` the points the lane has left as of now, at most `most` (a number or a function of the points by lane), so
 * that parallel processes cannot spend the same room: `{ limit, release, capped }` (`capped` when `most` cut the room), or `{ waitUntil,
 * limit }` with nothing claimed when less than `least` is left (just after half past or the hour).
 */
export async function claimRoom(deps, lane, { least = POINTS_OVERHEAD, most = Infinity } = {}) {
  const at = deps.now();
  const capOf = typeof most === 'function' ? most : () => most;
  let capped = false;
  const claim = await deps.points.claim(lane, (byLane) => {
    const room = laneRoom(lane, byLane, at, deps.siteCap);
    const top = capOf(byLane);
    capped = room > top;
    return Math.min(top, room);
  });
  if (claim.limit >= least) return { ...claim, capped };
  claim.release();
  return { waitUntil: retryAfter(at), limit: claim.limit };
}

/** The cap of a background step's claim: what is left of the lane's own reserve, or the group limit when that is more. */
export const stepCap = (deps, lane) => (byLane) => stepClaim(lane, byLane, deps.siteCap);
