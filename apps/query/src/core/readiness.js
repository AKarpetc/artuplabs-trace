import { ERR } from './errors.js';

const PART_OF_GROUP = { sprint: 'sprint', comment: 'comments', attachment: 'comments' };

/** The index part a function group reads, or null. */
export function indexPartOf(group) {
  return PART_OF_GROUP[group] ?? null;
}

/** Journal change kind written when an index part finishes building, so the groups that read it are recomputed. */
export const indexReadyKind = (part) => `index-${part}`;

/** "Index is building" until the part a group needs was built once (a later reindex keeps it ready); null when not needed. */
export function readinessError(progress, group) {
  const part = indexPartOf(group);
  if (!part || progress?.[part]?.readyAt) return null;
  return ERR.indexBuilding(progress?.[part]?.done ?? 0, progress?.[part]?.total ?? 0);
}
