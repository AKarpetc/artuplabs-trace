import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Renders page 1 of each built-in Word/PDF layout from the preview fixtures with the PDF engine and
 * rasterises it to preview thumbnails (`preview/thumbs/<layout>.png`, 400 px wide) with `pdftoppm`.
 * Usage: node scripts/make-thumbs.mjs
 */

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => import(pathToFileURL(resolve(appDir, path)).href);
const OUT = resolve(appDir, 'preview', 'thumbs');
const FONTS = resolve(appDir, 'fonts');
const WIDTH = 400;
const ISSUE_COUNT = 8;

const FACES = {
  latin: { family: 'Sans', normal: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
  cjk: { family: 'CJK', normal: 'NotoSansSC-Regular.otf', bold: 'NotoSansSC-Bold.otf' },
  korean: { family: 'KR', normal: 'NotoSansKR-Regular.otf', bold: 'NotoSansKR-Bold.otf' },
};

function fontsFor(scripts) {
  const files = {};
  const families = {};
  for (const script of ['latin', ...['cjk', 'korean'].filter((s) => scripts.has(s))]) {
    const face = FACES[script];
    files[face.normal] = new Uint8Array(readFileSync(join(FONTS, face.normal)));
    files[face.bold] = new Uint8Array(readFileSync(join(FONTS, face.bold)));
    families[face.family] = { normal: face.normal, bold: face.bold, italics: face.normal, bolditalics: face.bold };
  }
  return { files, families };
}

async function main() {
  const [{ ISSUES, FIELDS, SITE }, { buildFieldCatalog }, { prepareIssue }, { buildLayout }, { buildPdfDefinition }, { labelsFor, formatsFor }, { createNodePdfEngine }, { LAYOUTS }] = await Promise.all([
    load('preview/fixtures.js'), load('src/core/fields.js'), load('src/core/prepare.js'), load('src/core/layouts.js'),
    load('src/render/pdf.js'), load('src/wizard/labels.js'), load('test/fixtures/nodePdfEngine.js'), load('src/core/builtins.js'),
  ]);
  const dictionary = JSON.parse(readFileSync(join(appDir, 'src/i18n/locales/en-US.json'), 'utf8'));
  const labels = labelsFor((key) => dictionary[key]);
  const formats = formatsFor('en-US');
  const catalog = buildFieldCatalog([...FIELDS, { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } }]);
  const issues = ISSUES.slice(0, ISSUE_COUNT).map((issue) => prepareIssue({
    ...issue,
    fields: { ...issue.fields, fixVersions: [{ name: '2026.10' }], customfield_10020: [{ name: 'Sprint 42' }] },
  }, { catalog, siteUrl: SITE, formats }));
  const meta = { jql: 'project = RPT ORDER BY key ASC', exportedAt: '30 Sep 2026, 10:00', exportedBy: 'Ann Lee' };
  const engine = createNodePdfEngine();
  mkdirSync(OUT, { recursive: true });
  for (const name of readdirSync(OUT)) if (name.endsWith('.png')) rmSync(join(OUT, name));
  const work = join(tmpdir(), `artup-thumbs-${process.pid}`);
  mkdirSync(work, { recursive: true });
  for (const layout of LAYOUTS) {
    const shown = layout === 'single' ? issues.slice(0, 1) : issues;
    const spec = buildLayout({ layout, issues: shown, meta: { ...meta, count: shown.length }, labels, paper: 'A4' });
    const { definition, scripts } = buildPdfDefinition({ spec, images: new Map(), labels, meta: { ...meta, count: shown.length } });
    const bytes = await engine.render(definition, fontsFor(scripts));
    const pdf = join(work, `${layout}.pdf`);
    writeFileSync(pdf, bytes);
    execFileSync('pdftoppm', ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to-x', String(WIDTH), '-scale-to-y', '-1', pdf, join(OUT, layout)]);
    console.log(`thumbs/${layout}.png`);
  }
  rmSync(work, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
