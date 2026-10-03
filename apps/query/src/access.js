/** Licence decision: production (and an unknown environment) needs an active licence, other environments are always licensed. */
export function decideLicence({ environmentType, license }) {
  if (environmentType && environmentType !== 'PRODUCTION') {
    return { licensed: true };
  }
  return { licensed: (license?.active ?? license?.isActive) === true };
}
