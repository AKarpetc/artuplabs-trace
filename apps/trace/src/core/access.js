/** Access decision for a resolver call: Jira permission first, then license in production. */
export function decide({ environmentType, license, havePermission }) {
  if (!havePermission) {
    return { allowed: false, reason: 'no-permission' };
  }
  if (environmentType === 'PRODUCTION' && license?.isActive !== true) {
    return { allowed: false, reason: 'unlicensed' };
  }
  return { allowed: true, reason: 'ok' };
}

/** True when a license object says it is active; resolver context uses `active`, the backend License type `isActive`. */
export function isLicenseActive(license) {
  return (license?.active ?? license?.isActive) === true;
}

/** True when value is a Jira id: a 1-32 character digit string (numbers are coerced first). */
export function isJiraId(value) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text.length > 0 && text.length <= 32 && /^[0-9]+$/.test(text);
}

/** True when value converts to a positive integer baseline id. */
export function isBaselineId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false;
  }
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}
