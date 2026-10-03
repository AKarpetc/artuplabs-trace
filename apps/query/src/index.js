import Resolver from '@forge/resolver';
import { createResolverDefinitions } from './handlers/resolvers.js';

const resolver = new Resolver();
for (const [key, fn] of Object.entries(createResolverDefinitions({}))) resolver.define(key, fn);

/** Forge resolver entry point. */
export const resolverHandler = resolver.getDefinitions();
