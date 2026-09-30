import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const thumbsDir = resolve(rootDir, 'preview/thumbs');

/**
 * Serves the layout thumbnails (`preview/thumbs/*.png`) at `thumbs/<name>` in the dev server and emits them
 * into every page build, where the wizard loads them by that relative path.
 */
function layoutThumbs() {
  return {
    name: 'layout-thumbs',
    configureServer(server) {
      server.middlewares.use('/thumbs', (request, response, next) => {
        const file = join(thumbsDir, basename(request.url.split('?')[0]));
        if (!existsSync(file)) return next();
        response.setHeader('content-type', 'image/png');
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const name of readdirSync(thumbsDir).filter((file) => file.endsWith('.png'))) {
        this.emitFile({ type: 'asset', fileName: `thumbs/${name}`, source: readFileSync(join(thumbsDir, name)) });
      }
    },
  };
}

const pageDirs = { 'global-page': 'global-page', action: 'action', preview: 'preview' };

/**
 * Builds each Custom UI page from its own Vite root so its bundled output is
 * self-contained inside dist/<page>/, matching the Forge resource layout.
 *
 * `legacy.inconsistentCjsInterop`: Rolldown shares one interop wrapper per CommonJS module across
 * importers. Our `"type": "module"` files import `@atlaskit/icon/core/*` in Node mode, which then
 * hands `@atlaskit/pagination` and `@atlaskit/select` the exports object instead of the icon, and
 * React throws #130 (the result screen goes blank once the warnings table paginates).
 */
export default defineConfig(({ mode }) => {
  const page = pageDirs[mode];
  return {
    root: page ? resolve(rootDir, page) : rootDir,
    base: './',
    plugins: [react(), layoutThumbs()],
    legacy: { inconsistentCjsInterop: true },
    assetsInclude: ['**/*.ttf', '**/*.otf', '**/*.docx'],
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
