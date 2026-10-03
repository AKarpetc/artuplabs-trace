import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { shippedFunctions } from '../src/core/catalog.js';

const manifest = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
const indexText = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const declared = manifest.modules['jira:jqlFunction'];
const FORGE_FUNCTION_KEY_MAX = 23;

describe('manifest JQL functions', () => {
  it('declares exactly the shipped functions in catalog order', () => {
    expect(declared.map((m) => [m.key, m.name])).toEqual(shippedFunctions().map((f) => [f.key, f.name]));
  });
  it('declares the user arguments plus the hidden page argument, issue type, in and not in', () => {
    for (const f of shippedFunctions()) {
      const m = declared.find((x) => x.name === f.name);
      expect(m.arguments, f.name).toEqual([...f.args.map((a) => ({ name: a.name, required: a.required })), { name: 'page', required: false }]);
      expect([m.types, m.operators]).toEqual([['issue'], ['in', 'not in']]);
    }
  });
  it('points every function at an exported handler', () => {
    const handlers = new Map(manifest.modules.function.map((x) => [x.key, x.handler]));
    for (const m of declared) {
      expect(handlers.get(m.function), m.name).toBe(`index.${m.name}`);
      expect(indexText).toMatch(new RegExp(`\\b${m.name}\\b`));
    }
  });
  it('keeps every function key unique and within the Forge key length', () => {
    const keys = manifest.modules.function.map((x) => x.key);
    expect([new Set(keys).size, keys.filter((k) => k.length > FORGE_FUNCTION_KEY_MAX)]).toEqual([keys.length, []]);
  });
  it('asks for no write scope except app data and no egress', () => {
    expect(manifest.permissions.scopes.filter((s) => s.startsWith('write:') && s !== 'write:app-data:jira')).toEqual([]);
    expect(manifest.permissions.external).toBeUndefined();
  });
});
