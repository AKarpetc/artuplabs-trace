import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ defs: {} }));

vi.mock('@forge/resolver', () => ({
  default: class {
    define(key, fn) {
      h.defs[key] = fn;
    }

    getDefinitions() {
      return h.defs;
    }
  },
}));

const { resolverHandler } = await import('../src/index.js');

describe('getAccess', () => {
  it('denies an unlicensed production context', () => {
    const result = resolverHandler.getAccess({ context: { environmentType: 'PRODUCTION' } });
    expect(result).toEqual({ licensed: false, environmentType: 'PRODUCTION' });
  });

  it('allows a non-production context', () => {
    const result = resolverHandler.getAccess({ context: { environmentType: 'DEVELOPMENT' } });
    expect(result).toEqual({ licensed: true, environmentType: 'DEVELOPMENT' });
  });
});
