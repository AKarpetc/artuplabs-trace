import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const pageDirs = { 'space-page': 'space-page', 'content-action': 'content-action', preview: 'preview' };

/**
 * Builds each Custom UI page from its own Vite root so its bundled output is
 * self-contained inside dist/<page>/, matching the Forge resource layout.
 */
export default defineConfig(({ mode }) => {
  const page = pageDirs[mode];
  return {
    root: page ? resolve(rootDir, page) : rootDir,
    base: './',
    plugins: [react()],
    resolve: mode === 'preview'
      ? { alias: { '@forge/bridge': resolve(rootDir, 'preview/bridgeMock.js') } }
      : {},
    server: mode === 'preview' ? { fs: { allow: [rootDir] } } : {},
    build: page
      ? { outDir: resolve(rootDir, 'dist', page), emptyOutDir: true }
      : {},
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{js,jsx}'],
      setupFiles: ['./test/setup.js'],
    },
  };
});
