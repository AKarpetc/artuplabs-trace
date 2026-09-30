#!/usr/bin/env node
/**
 * Load acceptance on the dev site: runs the real export pipeline in Node against artuplabs-dev.
 *
 * Usage (from apps/reports, after sourcing the .env):
 *   node scripts/acceptance.mjs xlsx --jql "project = RPT" --template xlsx-issues --out data/rpt-10k.xlsx
 *   node scripts/acceptance.mjs docx --jql "project = RPT AND attachments is not EMPTY" --limit 500 --template docx-single --out data/rpt-500.docx
 *   node scripts/acceptance.mjs pdf --jql "..." --limit 500 --template pdf-single --out data/rpt-500.pdf
 *   node scripts/acceptance.mjs docx-template --jql "project = RPT" --limit 100 --template-file data/example.docx --out data/rpt-template.docx
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { clientFactory, clock, exportMeta, fileFormats, fileLabels, load, mb, nodeRenderers, sampleMemory, siteCatalog } from './lib/node-env.mjs';

const require = createRequire(new URL('../static/app/package.json', import.meta.url));
const CJK = /[぀-ヿ㐀-鿿]/u;

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];
  return { command, options };
}

async function templateOf(command, options) {
  if (command === 'docx-template') {
    const bytes = new Uint8Array(readFileSync(options['template-file']));
    const [{ default: PizZip }, { default: Docxtemplater }, { default: InspectModule }, { inspectTemplate }] = await Promise.all([
      import(require.resolve('pizzip')), import(require.resolve('docxtemplater')), import(require.resolve('docxtemplater/js/inspect-module.js')),
      load('src/infra/templateInspect.js'),
    ]);
    const inspected = inspectTemplate(bytes, { PizZip, Docxtemplater, InspectModule });
    if (inspected.errors.length) throw new Error(`template errors: ${JSON.stringify(inspected.errors)}`);
    return { id: 'example', format: 'docx', kind: 'docx', placeholders: inspected.tags, bytes };
  }
  const { builtinById } = await load('src/core/builtins.js');
  const template = builtinById(options.template ?? { xlsx: 'xlsx-issues', docx: 'docx-single', pdf: 'pdf-single' }[command]);
  if (!template) throw new Error(`unknown template ${options.template}`);
  return template;
}

async function checkXlsx(bytes, template, jql) {
  const { default: ExcelJS } = await import(require.resolve('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets.reduce((a, b) => (b.rowCount > a.rowCount ? b : a));
  let links = 0;
  let dataRows = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    dataRows += 1;
    const cell = row.getCell(1);
    if (cell.hyperlink || cell.value?.hyperlink) links += 1;
  });
  const sample = ws.getRow(2);
  const dateCells = ws.getRow(1).values.map((_, i) => i).filter((i) => sample.getCell(i).value instanceof Date).length;
  const summarySheet = wb.worksheets.find((sheet) => sheet !== ws);
  const summaryText = summarySheet ? JSON.stringify(summarySheet.getSheetValues()) : JSON.stringify(wb.description);
  return {
    sheets: wb.worksheets.map((s) => `${s.name}:${s.rowCount}`), dataRows, links, template: template.id,
    frozenHeader: ws.views?.[0]?.state === 'frozen', autoFilter: Boolean(ws.autoFilter), dateCells, evidenceJql: summaryText.includes(jql) || String(wb.description).includes(jql),
  };
}

async function checkDocx(bytes, jql) {
  const { default: PizZip } = await import(require.resolve('pizzip'));
  const zip = new PizZip(bytes);
  const xmlNames = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  const leftover = xmlNames.reduce((sum, n) => sum + (zip.file(n).asText().match(/\{\{/g) ?? []).length, 0);
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/')).length;
  const drawings = (zip.file('word/document.xml').asText().match(/<w:drawing>/g) ?? []).length;
  const allText = xmlNames.map((n) => zip.file(n).asText()).join('');
  const headerRows = (zip.file('word/document.xml').asText().match(/<w:tblHeader/g) ?? []).length;
  return { media, drawings, leftoverTags: leftover, repeatedHeaderRows: headerRows, pageNumberField: /PAGE/.test(allText), evidenceJql: allText.includes(jql.replace(/&/g, '&amp;')) };
}

async function checkPdf(bytes, jql) {
  const { getDocument } = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    texts.push((await page.getTextContent()).items.map((item) => item.str).join(''));
    if (n >= 60 && !texts.slice(1).some((t) => CJK.test(t))) break;
  }
  return { pages: doc.numPages, evidenceJql: texts[0].includes('JQL') && texts[0].includes(jql.slice(0, 20)), page1Cjk: CJK.test(texts[0]), anyCjkInFirst: texts.findIndex((t) => CJK.test(t)) + 1, page1: texts[0].slice(0, 160) };
}

const suffixOf = (id, copy) => `${id}${copy}`;

/** Client that serves each real issue `times` times under new issue and attachment ids, capped at `cap` issues; image bytes are real, downloaded once and copied on every read. */
function multiplied(factory, times, cap, counter) {
  const realOf = new Map();
  const bytesCache = new Map();
  return (args) => {
    const inner = factory(args);
    return {
      ...inner,
      approximateCount: async () => cap,
      async searchIds(jql, opts) {
        const ids = await inner.searchIds(jql, opts);
        const out = [];
        for (let copy = 0; copy < times; copy += 1) {
          for (const id of ids) {
            const fake = copy === 0 ? id : suffixOf(`9${id}`, copy);
            realOf.set(fake, { id, copy });
            out.push(fake);
          }
        }
        return out.slice(0, cap);
      },
      async bulkFetch(ids, options) {
        const wanted = ids.map((id) => realOf.get(id));
        const page = await inner.bulkFetch([...new Set(wanted.map((w) => w.id))], options);
        const byId = new Map(page.issues.map((issue) => [issue.id, issue]));
        const issues = ids.map((fake, i) => {
          const { id, copy } = wanted[i];
          const issue = byId.get(id);
          if (!issue || copy === 0) return issue;
          let text = JSON.stringify(issue);
          for (const a of issue.fields.attachment ?? []) {
            const fakeAtt = suffixOf(`9${a.id}`, copy);
            realOf.set(`att:${fakeAtt}`, { id: a.id });
            text = text.replaceAll(a.id, fakeAtt);
          }
          return { ...JSON.parse(text), id: fake };
        });
        return { issues: issues.filter(Boolean), errors: page.errors };
      },
      async attachmentBytes(id) {
        const real = realOf.get(`att:${id}`)?.id ?? id;
        if (!bytesCache.has(real)) bytesCache.set(real, Buffer.from(await inner.attachmentBytes(real)));
        const copy = bytesCache.get(real);
        counter.bytes += copy.length;
        counter.images += 1;
        return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.length);
      },
    };
  };
}

const LIMIT_SECONDS = { xlsx: 60, docx: 120, pdf: 120 };

function failuresOf({ command, options, result, check }) {
  const failures = [];
  const limit = options['max-seconds'] ? Number(options['max-seconds']) : LIMIT_SECONDS[command];
  if (limit && result.seconds > limit) failures.push(`took ${result.seconds} s, limit ${limit} s`);
  if (command === 'xlsx' && (check.dataRows !== result.stats.issues && result.template === 'xlsx-issues')) failures.push(`rows ${check.dataRows} != issues ${result.stats.issues}`);
  if (command === 'xlsx' && check.links !== check.dataRows) failures.push(`links ${check.links} != rows ${check.dataRows}`);
  if (options['min-rows'] && check.dataRows < Number(options['min-rows'])) failures.push(`rows ${check.dataRows} < ${options['min-rows']}`);
  if (command !== 'xlsx' && result.stats.imagesMissing > 0) failures.push(`images missing ${result.stats.imagesMissing}`);
  if (command === 'pdf' && !check.page1Cjk) failures.push('page 1 has no CJK text');
  if (command === 'docx-template' && check.leftoverTags > 0) failures.push(`${check.leftoverTags} tags left`);
  return failures;
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  const format = command === 'docx-template' ? 'docx' : command;
  const counter = { bytes: 0, images: 0 };
  const plain = await clientFactory();
  const factory = options.multiply ? multiplied(plain, Number(options.multiply), Number(options.limit), counter) : plain;
  const { createExportRun } = await load('src/export/pipeline.js');
  const template = await templateOf(command, options);
  const catalog = await siteCatalog(factory);
  const renderers = await nodeRenderers();
  const meta = await exportMeta();
  const labels = await fileLabels();
  const formats = await fileFormats();
  const phases = {};
  const memory = sampleMemory();
  const started = clock();
  const exportRun = createExportRun({
    client: factory,
    entry: { kind: 'jql', jql: options.jql ?? 'project = RPT' },
    jql: options.jql ?? 'project = RPT',
    template, catalog, meta, labels, formats, renderers, clock,
    limit: options.limit ? Number(options.limit) : undefined,
    onProgress: (p) => {
      phases[p.phase] ??= clock();
      if (p.done === p.total || p.done % 2000 === 0) process.stderr.write(`\r${p.phase} ${p.done}/${p.total}      `);
    },
  });
  const outcome = await exportRun.start();
  const wall = (clock() - started) / 1000;
  const peak = memory.stop();
  process.stderr.write('\n');
  if (outcome.status !== 'done') throw new Error(`run ended ${JSON.stringify(outcome)}`);
  const { file } = outcome;
  const out = options.out;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, file.bytes);
  }
  const check = format === 'xlsx' ? await checkXlsx(file.bytes, template, options.jql ?? 'project = RPT') : format === 'docx' ? await checkDocx(file.bytes, options.jql ?? 'project = RPT') : await checkPdf(file.bytes, options.jql ?? 'project = RPT');
  const result = {
    command, template: template.id, fileName: file.fileName, jql: options.jql ?? 'project = RPT', out: out ?? null,
    seconds: Number(file.stats.seconds.toFixed(1)), wallSeconds: Number(wall.toFixed(1)),
    stats: { ...file.stats, seconds: undefined }, warnings: file.warnings.length,
    fileBytes: file.bytes.length, fileMB: Number((file.bytes.length / 1048576).toFixed(2)),
    peakRssMB: mb(peak.rss), peakHeapMB: mb(peak.heapUsed), imagesDownloaded: counter.images, imageMB: mb(counter.bytes), check,
  };
  const failures = failuresOf({ command, options, result, check });
  console.log(JSON.stringify({ ...result, pass: failures.length === 0, failures }));
  if (failures.length) process.exitCode = 1;
  if (options.result) writeFileSync(options.result, `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
