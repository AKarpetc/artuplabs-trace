// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../vite.config.js';

describe('page build', () => {
  it.each(['global-page', 'admin-page'])('%s splits vendor code by package instead of raising the chunk warning limit', (mode) => {
    const { build } = config({ mode });
    const groups = build.rolldownOptions.output.codeSplitting.groups;
    expect(build.chunkSizeWarningLimit).toBeUndefined();
    expect(groups.map((g) => g.name)).toEqual(expect.arrayContaining(['react', 'atlaskit-tokens', 'atlaskit', 'vendor']));
    expect(groups.some((g) => 'maxSize' in g)).toBe(false);
  });
  it('serves the preview stand with the local bridge', () => {
    const { resolve } = config({ mode: 'preview' });
    expect(resolve.alias['@forge/bridge']).toMatch(/preview[\\/]bridgeMock\.js$/);
  });
});
