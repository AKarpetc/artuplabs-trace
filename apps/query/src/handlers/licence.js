import { decideLicence } from '../access.js';
import { REWRITE_ALL_KIND } from '../core/affected.js';
import { ERR } from '../core/errors.js';
import { listPrecomputations } from './groups.js';

const appOf = (deps) => deps.appContext?.() ?? null;

/** Whether the background may work for the site: the app context's licence by the rule of function calls; with no app context it works. */
export function backgroundLicensed(deps) {
  const app = appOf(deps);
  if (app === null) return true;
  return decideLicence({ environmentType: app.environmentType, license: app.license }).licensed;
}

/**
 * Licence gate of a background run: an unlicensed one marks the start of the unlicensed spell in `q:licence` and stops; the first licensed
 * run after a spell marks the cached precomputation list stale, queues a rewrite of every precomputation and clears the mark. Only a
 * production run reads the mark.
 */
export async function backgroundAllowed(deps) {
  const app = appOf(deps);
  if (app === null || app.environmentType !== 'PRODUCTION') return backgroundLicensed(deps);
  const spell = await deps.state.licence.get();
  if (!backgroundLicensed(deps)) {
    if (!spell) await deps.state.licence.set({ since: deps.now(), written: false });
    return false;
  }
  if (spell) {
    await deps.pcList?.markDirty?.();
    await deps.journal.append({ ids: [], kinds: [REWRITE_ALL_KIND] }, deps.now());
    await deps.state.licence.clear();
  }
  return true;
}

/** Stores the licence error in every precomputation once per unlicensed spell, so saved filters stop answering; the count written. */
export async function withdrawResults(deps) {
  const spell = (await deps.state.licence.get()) ?? { since: deps.now(), written: false };
  if (spell.written) return 0;
  const updates = (await listPrecomputations(deps)).map((pc) => ({ id: pc.id, error: ERR.unlicensed() }));
  if (updates.length) await deps.jira.writePrecomputations(updates);
  await deps.pcList?.markDirty?.();
  await deps.state.licence.set({ ...spell, written: true });
  return updates.length;
}
