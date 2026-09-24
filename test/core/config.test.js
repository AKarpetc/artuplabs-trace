import { describe, it, expect } from 'vitest';
import { normalizeConfig, validateConfig, isConfigured, diffConfig, DEFAULT_FINGERPRINT_FIELDS } from '../../src/core/config';

describe('normalizeConfig', () => {
  it('fills defaults for missing input', () => {
    expect(normalizeConfig(undefined)).toEqual({
      requirementTypeIds: [],
      verificationTypeIds: [],
      linkTypeIds: [],
      fingerprintFieldIds: DEFAULT_FINGERPRINT_FIELDS,
    });
  });

  it('dedupes and stringifies ids', () => {
    expect(normalizeConfig({ requirementTypeIds: [10001, '10001'] }).requirementTypeIds).toEqual(['10001']);
  });
});

describe('validateConfig', () => {
  it('requires at least one requirement and one verification type', () => {
    expect(validateConfig(normalizeConfig({}))).toEqual([
      'Choose at least one requirement issue type.',
      'Choose at least one verification issue type.',
    ]);
  });

  it('rejects the same type as requirement and verification', () => {
    const errors = validateConfig(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['1'] }));
    expect(errors).toEqual(['An issue type cannot be both requirement and verification.']);
  });

  it('requires summary in fingerprint fields', () => {
    const errors = validateConfig(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'], fingerprintFieldIds: ['description'] }));
    expect(errors).toEqual(['Fingerprint fields must include summary.']);
  });

  it('rejects a type or link id that is not a numeric Jira id (JQL injection guard)', () => {
    const injected = normalizeConfig({ requirementTypeIds: ['1) OR project = 99 OR issuetype in (1'], verificationTypeIds: ['2'] });
    expect(validateConfig(injected)).toContain('Issue type and link type ids must be numeric Jira ids.');
    expect(validateConfig(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2 '] }))).toContain('Issue type and link type ids must be numeric Jira ids.');
    expect(validateConfig(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'], linkTypeIds: ['x'] }))).toContain('Issue type and link type ids must be numeric Jira ids.');
    expect(isConfigured(injected)).toBe(false);
  });
});

describe('isConfigured', () => {
  it('is false until valid', () => {
    expect(isConfigured(normalizeConfig({}))).toBe(false);
    expect(isConfigured(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'] }))).toBe(true);
  });
});

describe('diffConfig', () => {
  const a = normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'] });

  it('no change needs nothing', () => {
    expect(diffConfig(a, a)).toEqual({ needsResync: false, needsReanchor: false });
  });

  it('requirement or verification or link types change requires resync', () => {
    expect(diffConfig(a, { ...a, requirementTypeIds: ['1', '3'] }).needsResync).toBe(true);
    expect(diffConfig(a, { ...a, linkTypeIds: ['9'] }).needsResync).toBe(true);
  });

  it('fingerprint fields change requires re-anchoring', () => {
    expect(diffConfig(a, { ...a, fingerprintFieldIds: ['summary'] })).toEqual({ needsResync: true, needsReanchor: true });
  });

  it('order of ids does not count as a change', () => {
    const b = { ...a, fingerprintFieldIds: ['description', 'summary'] };
    expect(diffConfig(a, b)).toEqual({ needsResync: false, needsReanchor: false });
  });
});
