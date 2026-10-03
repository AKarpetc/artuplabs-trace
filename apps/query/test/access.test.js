import { describe, expect, it } from 'vitest';
import { decideLicence } from '../src/access.js';

describe('decideLicence', () => {
  it('allows any non-production environment', () => {
    expect(decideLicence({ environmentType: 'DEVELOPMENT' })).toEqual({ licensed: true });
  });
  it('allows production with an active licence (active or isActive)', () => {
    expect(decideLicence({ environmentType: 'PRODUCTION', license: { active: true } })).toEqual({ licensed: true });
    expect(decideLicence({ environmentType: 'PRODUCTION', license: { isActive: true } })).toEqual({ licensed: true });
  });
  it('treats a call with no environment as production', () => {
    expect([decideLicence({}), decideLicence({ license: { active: true } })]).toEqual([{ licensed: false }, { licensed: true }]);
  });
  it('denies production with a missing or inactive licence', () => {
    expect(decideLicence({ environmentType: 'PRODUCTION' })).toEqual({ licensed: false });
    expect(decideLicence({ environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ licensed: false });
  });
});
