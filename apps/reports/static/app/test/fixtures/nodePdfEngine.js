import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** PDF engine on the Node entry of pdfmake: fonts go to a temp dir that is the only readable place. */
export function createNodePdfEngine() {
  const pdfmake = require('pdfmake');
  return {
    async render(definition, fonts) {
      const dir = await mkdtemp(join(tmpdir(), 'artup-pdf-'));
      try {
        await Promise.all(Object.entries(fonts.files).map(([name, bytes]) => writeFile(join(dir, name), bytes)));
        const families = Object.fromEntries(Object.entries(fonts.families).map(([family, faces]) => [
          family,
          Object.fromEntries(Object.entries(faces).map(([face, name]) => [face, join(dir, name)])),
        ]));
        pdfmake.setFonts(families);
        pdfmake.setLocalAccessPolicy((path) => path.startsWith(dir));
        pdfmake.setUrlAccessPolicy(() => false);
        return new Uint8Array(await pdfmake.createPdf(definition).getBuffer());
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
