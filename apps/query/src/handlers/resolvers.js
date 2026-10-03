import { decideLicence } from '../access.js';

/** Resolver functions by key; `deps` carries state and clients for the keys added later. */
export function createResolverDefinitions(deps) {
  return {
    getAccess: ({ context }) => ({
      ...decideLicence({ environmentType: context?.environmentType, license: context?.license }),
      environmentType: context?.environmentType ?? '',
    }),
  };
}
