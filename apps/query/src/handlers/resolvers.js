import { decideLicence } from '../access.js';
import { shippedFunctions, usage } from '../core/catalog.js';
import { CODE } from '../core/errors.js';
import { LEASE_MS } from '../core/limits.js';
import { createAdminActions } from './admin.js';

const ADMIN_ACTIONS = ['adminStatus', 'setExcluded', 'reindexProject', 'resetIndex'];
const PASSED = new Set([CODE.unlicensed, CODE.forbidden, CODE.badRequest, CODE.notFound, CODE.busy]);

const licensed = (context) => decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed;

/** An admin action as a resolver: its known error codes pass through, anything else is logged without values and answered `internal`. */
const adminResolver = (actions, key) => async ({ payload, context }) => {
  try {
    return await actions[key](payload ?? {}, context);
  } catch (error) {
    if (PASSED.has(error?.message)) throw error;
    console.error(`${key} failed: ${error?.name}`);
    throw new Error(CODE.internal);
  }
};

/** Resolver functions by key: the licence check, the reference and refresh status of the app page and the admin page actions. */
export function createResolverDefinitions(deps) {
  const actions = createAdminActions(deps);
  return {
    ...Object.fromEntries(ADMIN_ACTIONS.map((key) => [key, adminResolver(actions, key)])),
    getAccess: ({ context }) => ({
      ...decideLicence({ environmentType: context?.environmentType, license: context?.license }),
      environmentType: context?.environmentType ?? '',
    }),
    getStatus: async ({ context }) => {
      if (!licensed(context)) throw new Error(CODE.unlicensed);
      const [pending, lease, lastRefresh, errors, progress, excluded] = await Promise.all([
        deps.state.pending.get(), deps.state.lease.get(), deps.state.lastRefresh.get(), deps.state.errors(), deps.state.progress.get(), deps.state.excluded(),
      ]);
      return {
        functions: shippedFunctions().map((f) => ({ name: f.name, group: f.group, usage: usage(f), examples: f.examples })),
        queue: { pending: pending !== null, running: lease !== null && deps.now() - lease < LEASE_MS },
        lastRefresh,
        errors,
        progress,
        excluded,
      };
    },
  };
}
