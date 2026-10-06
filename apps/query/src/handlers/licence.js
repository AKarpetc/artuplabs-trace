import { licenceState } from '../access.js';
import { REWRITE_ALL_KIND } from '../core/affected.js';
import { ERR } from '../core/errors.js';
import { listPrecomputations } from './groups.js';

/**
 * Keeps the last licence state a handler was told explicitly in `q:licence:seen` (`{ active, at }`), written only when it changes; a
 * missing licence is not noted, and a failed note is logged without values.
 */
export async function noteLicence(deps, license) {
  const told = licenceState(license);
  if (told === 'unknown' || !deps.state?.licenceSeen) return;
  const active = told === 'active';
  try {
    if ((await deps.state.licenceSeen.get())?.active !== active) await deps.state.licenceSeen.set({ active, at: deps.now() });
  } catch (error) {
    console.error(`licence note failed: ${error?.name}`);
  }
}

/**
 * Licence state of a background run: 'active' outside production; the licence of the handler context, else of the app context; without
 * either, the state last seen (logged in production), and 'active' when none was seen.
 */
async function backgroundState(deps, context) {
  const app = deps.appContext?.() ?? null;
  const environment = app?.environmentType ?? context?.environmentType;
  if (environment && environment !== 'PRODUCTION') return { state: 'active', production: false };
  const license = context?.license ?? app?.license;
  const told = licenceState(license);
  if (told !== 'unknown') {
    await noteLicence(deps, license);
    return { state: told, production: true };
  }
  if (environment === 'PRODUCTION') console.log('licence: none in the background context');
  const seen = await deps.state.licenceSeen.get();
  return { state: seen?.active === false ? 'inactive' : 'active', production: true };
}

/**
 * Licence gate of a background run: stops only on an inactive licence, told or last seen, and marks the start of that spell in
 * `q:licence`; the first run allowed after a spell marks the cached precomputation list stale, queues a rewrite of every precomputation
 * and clears the mark.
 */
export async function backgroundAllowed(deps, context) {
  const { state, production } = await backgroundState(deps, context);
  if (!production) return true;
  const spell = await deps.state.licence.get();
  if (state === 'inactive') {
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

/** Stores the licence error in every precomputation once per inactive spell, so saved filters stop answering; the count written. */
export async function withdrawResults(deps) {
  const spell = (await deps.state.licence.get()) ?? { since: deps.now(), written: false };
  if (spell.written) return 0;
  const updates = (await listPrecomputations(deps)).map((pc) => ({ id: pc.id, error: ERR.unlicensed() }));
  if (updates.length) await deps.jira.writePrecomputations(updates);
  await deps.pcList?.markDirty?.();
  await deps.state.licence.set({ ...spell, written: true });
  return updates.length;
}
