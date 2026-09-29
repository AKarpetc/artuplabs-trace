import Resolver from '@forge/resolver';
import { decideLicence } from './access.js';

const resolver = new Resolver();

resolver.define('getAccess', ({ context }) => ({
  ...decideLicence({ environmentType: context.environmentType, license: context.license }),
  environmentType: context.environmentType ?? '',
}));

/** Forge resolver entry point. */
export const handler = resolver.getDefinitions();
