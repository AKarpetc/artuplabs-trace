import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const pageDirs = { 'project-page': 'project-page', 'issue-panel': 'issue-panel' };

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
    build: page
      ? { outDir: resolve(rootDir, 'dist', page), emptyOutDir: true }
      : {},
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.jsx'],
      setupFiles: ['./test/setup.js'],
    },
  };
});
