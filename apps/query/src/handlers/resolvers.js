import { decideLicence } from '../access.js';
import { shippedFunctions, usage } from '../core/catalog.js';
import { LEASE_MS } from '../core/limits.js';

const licensed = (context) => decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed;

/** Resolver functions by key: the licence check and the reference and refresh status of the app page. */
export function createResolverDefinitions(deps) {
  return {
    getAccess: ({ context }) => ({
      ...decideLicence({ environmentType: context?.environmentType, license: context?.license }),
      environmentType: context?.environmentType ?? '',
    }),
    getStatus: async ({ context }) => {
      if (!licensed(context)) throw new Error('unlicensed');
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
