/** Licence decision: production needs an active licence, other environments are always licensed. */
export function decideLicence({ environmentType, license }) {
  if (environmentType !== 'PRODUCTION') {
    return { licensed: true };
  }
  return { licensed: (license?.active ?? license?.isActive) === true };
}
