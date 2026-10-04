import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const appDir = resolve(rootDir, '../..');

const pageDirs = { 'global-page': 'global-page', 'admin-page': 'admin-page', preview: 'preview' };

/**
 * Vendor code in chunks under the 500 kB warning, split by whole packages: a size cap (`maxSize`) splits
 * Atlaskit modules apart and breaks their init order at runtime.
 */
const codeSplitting = {
  groups: [
    { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
    { name: 'atlaskit-tokens', test: /node_modules[\\/]@atlaskit[\\/]tokens[\\/]/, priority: 3 },
    { name: 'atlaskit-select', test: /node_modules[\\/](@atlaskit[\\/](select|react-select)|react-select)[\\/]/, priority: 3 },
    { name: 'atlaskit-table', test: /node_modules[\\/]@atlaskit[\\/](dynamic-table|pragmatic-drag-and-drop[^\\/]*|pagination)[\\/]/, priority: 3 },
    { name: 'atlaskit', test: /node_modules[\\/]@atlaskit[\\/]/, priority: 2 },
    { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
  ],
};

/**
 * Builds each Custom UI page from its own Vite root so its bundled output is
 * self-contained inside dist/<page>/, matching the Forge resource layout.
 * `--mode preview` serves the screenshot stand with a local `@forge/bridge`.
 *
 * `legacy.inconsistentCjsInterop`: Rolldown shares one interop wrapper per CommonJS module across
 * importers; `@atlaskit/icon/core/*` imported in Node mode otherwise hands other Atlaskit packages
 * the exports object instead of the icon, and React throws #130.
 */
export default defineConfig(({ mode }) => {
  const page = pageDirs[mode];
  return {
    root: page ? resolve(rootDir, page) : rootDir,
    base: './',
    plugins: [react()],
    legacy: { inconsistentCjsInterop: true },
    resolve: mode === 'preview'
      ? { alias: { '@forge/bridge': resolve(rootDir, 'preview/bridgeMock.js') } }
      : {},
    server: mode === 'preview' ? { fs: { allow: [appDir] } } : {},
    build: page
      ? { outDir: resolve(rootDir, 'dist', page), emptyOutDir: true, rolldownOptions: { output: { codeSplitting } } }
      : {},
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{js,jsx}'],
      setupFiles: ['./test/setup.js'],
    },
  };
});
