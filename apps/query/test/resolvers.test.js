import { describe, expect, it } from 'vitest';
import { createResolverDefinitions } from '../src/handlers/resolvers.js';

const run = (defs, key, context, payload) => defs[key]({ context, payload });

describe('getAccess', () => {
  const defs = createResolverDefinitions({});
  it('is unlicensed in production without an active licence', async () => {
    expect(await run(defs, 'getAccess', { environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ licensed: false, environmentType: 'PRODUCTION' });
  });
  it('is licensed in development', async () => {
    expect(await run(defs, 'getAccess', { environmentType: 'DEVELOPMENT' })).toEqual({ licensed: true, environmentType: 'DEVELOPMENT' });
  });
});
