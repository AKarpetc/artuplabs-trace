import { describe, it, expect } from 'vitest';
import { decide, isJiraId, isBaselineId } from '../../src/core/access';

describe('decide', () => {
  it('denies without Jira permission', () => {
    expect(decide({ environmentType: 'PRODUCTION', license: { isActive: true }, havePermission: false })).toEqual({ allowed: false, reason: 'no-permission' });
  });

  it('denies an inactive license in production', () => {
    expect(decide({ environmentType: 'PRODUCTION', license: { isActive: false }, havePermission: true })).toEqual({ allowed: false, reason: 'unlicensed' });
  });

  it('allows development without a license object', () => {
    expect(decide({ environmentType: 'DEVELOPMENT', license: undefined, havePermission: true })).toEqual({ allowed: true, reason: 'ok' });
  });

  it('allows active license', () => {
    expect(decide({ environmentType: 'PRODUCTION', license: { isActive: true }, havePermission: true })).toEqual({ allowed: true, reason: 'ok' });
  });
});

describe('isJiraId', () => {
  it('accepts a plain digit string', () => {
    expect(isJiraId('10001')).toBe(true);
  });

  it('accepts a number', () => {
    expect(isJiraId(10001)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isJiraId('')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isJiraId('1000a')).toBe(false);
  });

  it('rejects a string longer than 32 characters', () => {
    expect(isJiraId('1'.repeat(33))).toBe(false);
  });

  it('accepts a string exactly 32 characters', () => {
    expect(isJiraId('1'.repeat(32))).toBe(true);
  });

  it('rejects null and undefined', () => {
    expect(isJiraId(null)).toBe(false);
    expect(isJiraId(undefined)).toBe(false);
  });

  it('rejects objects and arrays', () => {
    expect(isJiraId({ id: '1' })).toBe(false);
    expect(isJiraId(['1'])).toBe(false);
  });
});

describe('isBaselineId', () => {
  it('accepts a numeric string', () => {
    expect(isBaselineId('42')).toBe(true);
  });

  it('accepts a positive integer', () => {
    expect(isBaselineId(42)).toBe(true);
  });

  it('rejects a non-integer number', () => {
    expect(isBaselineId(4.2)).toBe(false);
  });

  it('rejects zero and negative numbers', () => {
    expect(isBaselineId(0)).toBe(false);
    expect(isBaselineId(-1)).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(isBaselineId('abc')).toBe(false);
  });

  it('rejects null, undefined, booleans, objects and arrays', () => {
    expect(isBaselineId(null)).toBe(false);
    expect(isBaselineId(undefined)).toBe(false);
    expect(isBaselineId(true)).toBe(false);
    expect(isBaselineId({ id: 1 })).toBe(false);
    expect(isBaselineId([1])).toBe(false);
  });
});
