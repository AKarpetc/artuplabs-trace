/** Licence decision: production (and an unknown environment) needs an active licence, other environments are always licensed. */
export function decideLicence({ environmentType, license }) {
  if (environmentType && environmentType !== 'PRODUCTION') {
    return { licensed: true };
  }
  return { licensed: (license?.active ?? license?.isActive) === true };
}

/** State a licence object tells: 'active', 'inactive' only for an explicit false (`active`, else the older `isActive`), 'unknown' without one. */
export function licenceState(license) {
  const active = license?.active ?? license?.isActive;
  if (active === true) return 'active';
  return active === false ? 'inactive' : 'unknown';
}
