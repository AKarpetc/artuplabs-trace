import { loadFonts } from '../src/infra/fonts.js';
import { createBrowserPdfEngine } from '../src/infra/pdfEngine.js';
import { buildPdfDefinition } from '../src/render/pdf.js';

const spec = {
  paper: 'A4',
  title: 'PDF probe',
  metaLines: ['Report 報告 한국 отчёт'],
  blocks: [{ type: 'para', runs: [{ text: 'Report 報告 한국 отчёт' }] }],
};

/** Renders one mixed-script document with the browser engine and reports the outcome in the page title. */
async function probe() {
  const { definition, scripts } = buildPdfDefinition({ spec, images: new Map(), labels: { imageUnavailable: 'Image unavailable' }, meta: { jql: '', exportedBy: '' } });
  const [engine, fonts] = await Promise.all([createBrowserPdfEngine(), loadFonts(scripts)]);
  const bytes = await engine.render(definition, fonts);
  return { ok: bytes.length > 1000, size: bytes.length, head: new TextDecoder().decode(bytes.slice(0, 4)), scripts: [...scripts].sort() };
}

probe()
  .then((result) => { document.title = JSON.stringify(result); })
  .catch((error) => { document.title = JSON.stringify({ ok: false, error: String(error?.stack ?? error) }); });
