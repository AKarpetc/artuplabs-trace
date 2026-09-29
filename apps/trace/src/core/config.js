import { isJiraId } from './access';

export const DEFAULT_FINGERPRINT_FIELDS = ['summary', 'description'];

function ids(list) {
  return [...new Set((list ?? []).map(String))];
}

/** Returns a complete config object with defaults applied. */
export function normalizeConfig(raw) {
  const input = raw ?? {};
  const fingerprintFieldIds = ids(input.fingerprintFieldIds);
  return {
    requirementTypeIds: ids(input.requirementTypeIds),
    verificationTypeIds: ids(input.verificationTypeIds),
    linkTypeIds: ids(input.linkTypeIds),
    fingerprintFieldIds: fingerprintFieldIds.length ? fingerprintFieldIds : DEFAULT_FINGERPRINT_FIELDS,
  };
}

/** Human-readable validation errors; empty array when the config is usable. */
export function validateConfig(config) {
  const errors = [];
  if (!config.requirementTypeIds.length) {
    errors.push('Choose at least one requirement issue type.');
  }
  if (!config.verificationTypeIds.length) {
    errors.push('Choose at least one verification issue type.');
  }
  if (config.requirementTypeIds.some((id) => config.verificationTypeIds.includes(id))) {
    errors.push('An issue type cannot be both requirement and verification.');
  }
  if ([...config.requirementTypeIds, ...config.verificationTypeIds, ...config.linkTypeIds].some((id) => !isJiraId(id))) {
    errors.push('Issue type and link type ids must be numeric Jira ids.');
  }
  if (!config.fingerprintFieldIds.includes('summary')) {
    errors.push('Fingerprint fields must include summary.');
  }
  return errors;
}

/** True when the project has a valid configuration. */
export function isConfigured(config) {
  return validateConfig(config).length === 0;
}

function sameSet(a, b) {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

/** Tells which background work a config change requires. */
export function diffConfig(oldConfig, newConfig) {
  const needsReanchor = !sameSet(oldConfig.fingerprintFieldIds, newConfig.fingerprintFieldIds);
  const needsResync = needsReanchor
    || !sameSet(oldConfig.requirementTypeIds, newConfig.requirementTypeIds)
    || !sameSet(oldConfig.verificationTypeIds, newConfig.verificationTypeIds)
    || !sameSet(oldConfig.linkTypeIds, newConfig.linkTypeIds);
  return { needsResync, needsReanchor };
}
