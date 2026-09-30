#!/usr/bin/env node
/**
 * X-G5 feasibility measurement for ArtUp Reports (atlassian/22_app3_jira_reports.md §3, §6).
 * Makes the Jira REST calls a browser Custom UI would make, from Node 22 with basic auth, against
 * the seeded RPT project, then builds the files with the libraries a bundle would ship
 * (scratch install in atlassian/tools/g5/). Gate: 10 000 issues → .xlsx ≤ 120 s, peak RSS ≤ 1 GB;
 * 500 issues with images → .docx and PDF ≤ 120 s each.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/measure-reports-xg5.mjs [--issues 10000] [--docs 500]
 *
 * Writes atlassian/data/xg5-measurements.json and the produced files to atlassian/data/xg5/.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, 'g5', 'package.json'));
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const docx = require('docx');
const pdfmake = require('pdfmake');

const SITE = 'https://artuplabs-dev.atlassian.net';
const OUT = join(HERE, '..', 'data', 'xg5');
const FIELDS = ['summary', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'duedate', 'labels',
  'issuetype', 'timespent', 'fixVersions', 'components', 'issuelinks', 'attachment', 'comment', 'description'];

function parseArgs(argv) {
  const args = { issues: 10000, docs: 500, concurrency: 6 };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (name in args) args[name] = Number(argv[i + 1]);
  }
  return args;
}

const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { requests: 0, retries429: 0 };

/** Jira REST with retry on 429/5xx; returns JSON or an ArrayBuffer when binary is set. */
async function api(method, path, body, binary = false) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    stats.requests += 1;
    const res = await fetch(path.startsWith('http') ? path : `${SITE}${path}`, {
      method,
      headers: { Authorization: auth(), Accept: binary ? '*/*' : 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      if (res.status === 429) stats.retries429 += 1;
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return binary ? res.arrayBuffer() : res.json();
  }
  throw new Error(`${method} ${path} → gave up`);
}

async function pool(items, concurrency, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
    }
  }));
  return out;
}

let peakRss = 0;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);
const mb = (b) => Math.round(b / 1048576);

async function timed(label, fn) {
  const rss0 = process.memoryUsage().rss;
  peakRss = rss0;
  const t0 = performance.now();
  const value = await fn();
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  process.stderr.write(`${label}: ${seconds} s, peak RSS ${mb(peakRss)} MB\n`);
  return { value, seconds, peakRssMb: mb(peakRss) };
}

/** Sequential paging with full fields — the naive path. */
async function fetchPaged(limit) {
  const issues = [];
  let nextPageToken;
  do {
    const page = await api('POST', '/rest/api/3/search/jql', {
      jql: 'project = RPT ORDER BY key ASC', fields: FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}),
    });
    issues.push(...page.issues);
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < limit);
  return issues.slice(0, limit);
}

/** Ids first (5 000 per page), then parallel bulk fetch of 100 issues per call. */
async function fetchBulk(limit, concurrency) {
  const ids = [];
  let nextPageToken;
  do {
    const page = await api('POST', '/rest/api/3/search/jql', {
      jql: 'project = RPT ORDER BY key ASC', fields: ['id'], maxResults: 5000, ...(nextPageToken ? { nextPageToken } : {}),
    });
    ids.push(...page.issues.map((x) => x.id));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && ids.length < limit);
  const chunks = [];
  for (let i = 0; i < Math.min(limit, ids.length); i += 100) chunks.push(ids.slice(i, Math.min(i + 100, limit)));
  const pages = await pool(chunks, concurrency, (chunk) => api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: chunk, fields: FIELDS }));
  return pages.flatMap((p) => p.issues);
}

const COLUMNS = [
  ['Key', (x) => x.key], ['Summary', (x) => x.fields.summary], ['Type', (x) => x.fields.issuetype?.name],
  ['Status', (x) => x.fields.status?.name], ['Priority', (x) => x.fields.priority?.name],
  ['Assignee', (x) => x.fields.assignee?.displayName ?? ''], ['Reporter', (x) => x.fields.reporter?.displayName ?? ''],
  ['Created', (x) => new Date(x.fields.created)], ['Updated', (x) => new Date(x.fields.updated)],
  ['Due', (x) => (x.fields.duedate ? new Date(x.fields.duedate) : null)], ['Labels', (x) => x.fields.labels.join(', ')],
  ['Time spent (h)', (x) => (x.fields.timespent ?? 0) / 3600], ['Links', (x) => x.fields.issuelinks.length],
  ['Attachments', (x) => x.fields.attachment.length], ['Comments', (x) => x.fields.comment?.total ?? 0],
  ['Last comment', (x) => adfText(x.fields.comment?.comments?.at(-1)?.body).slice(0, 300)],
];

function adfText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  return (node.content ?? []).map(adfText).join(node.type === 'paragraph' ? '\n' : ' ').trim();
}

async function xlsxExcelJs(issues) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header], i) => ({ header, key: `c${i}`, width: i === 1 ? 60 : 16 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEEBFF' } };
  for (const x of issues) {
    const row = ws.addRow(COLUMNS.map(([, get]) => get(x)));
    row.getCell(1).value = { text: x.key, hyperlink: `${SITE}/browse/${x.key}` };
  }
  for (const c of [8, 9, 10]) ws.getColumn(c).numFmt = 'yyyy-mm-dd';
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
  const summary = wb.addWorksheet('Summary');
  const byStatus = new Map();
  for (const x of issues) byStatus.set(x.fields.status?.name, (byStatus.get(x.fields.status?.name) ?? 0) + 1);
  summary.addRows([['Status', 'Count'], ...byStatus]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function xlsxSheetJs(issues) {
  const rows = issues.map((x) => Object.fromEntries(COLUMNS.map(([h, get]) => [h, get(x)])));
  const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Issues');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Downloads the first image attachment of each issue that has one. */
async function images(issues, concurrency) {
  const withImg = issues.filter((x) => x.fields.attachment.some((a) => a.mimeType?.startsWith('image/')));
  const bufs = await pool(withImg, concurrency, async (x) => {
    const a = x.fields.attachment.find((y) => y.mimeType.startsWith('image/'));
    return [x.key, Buffer.from(await api('GET', `/rest/api/3/attachment/content/${a.id}`, null, true))];
  });
  return new Map(bufs);
}

function adfBlocksDocx(node) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = docx;
  const out = [];
  for (const b of node?.content ?? []) {
    if (b.type === 'paragraph') out.push(new Paragraph({ children: [new TextRun(adfText(b))] }));
    else if (b.type === 'bulletList') for (const li of b.content) out.push(new Paragraph({ text: adfText(li), bullet: { level: 0 } }));
    else if (b.type === 'codeBlock') out.push(new Paragraph({ children: [new TextRun({ text: adfText(b), font: 'Courier New' })] }));
    else if (b.type === 'table') {
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.content.map((r, ri) => new TableRow({
          tableHeader: ri === 0,
          children: r.content.map((c) => new TableCell({ columnSpan: c.attrs?.colspan ?? 1, children: [new Paragraph(adfText(c))] })),
        })),
      }));
    }
  }
  return out;
}

async function buildDocx(issues, imgs) {
  const { Document, Packer, Paragraph, HeadingLevel, ImageRun, TextRun, Header } = docx;
  const children = [];
  for (const x of issues) {
    children.push(new Paragraph({ text: `${x.key} ${x.fields.summary}`, heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ children: [new TextRun({ text: `${x.fields.issuetype?.name} · ${x.fields.status?.name} · ${x.fields.priority?.name}`, italics: true })] }));
    children.push(...adfBlocksDocx(x.fields.description));
    if (imgs.has(x.key)) children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: imgs.get(x.key), transformation: { width: 320, height: 200 } })] }));
    for (const c of x.fields.comment?.comments ?? []) children.push(new Paragraph({ text: `— ${adfText(c.body)}` }));
  }
  const doc = new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph('ArtUp Reports · project = RPT')] }) }, children }] });
  return Packer.toBuffer(doc);
}

const CJK_RUN = /([⺀-鿿가-힯豈-﫿＀-￯]+)/;

/** Splits text into inline runs so CJK characters get the CJK font and the rest the Latin/Cyrillic one. */
function runs(text) {
  return String(text).split(CJK_RUN).filter(Boolean).map((t) => ({ text: t, font: CJK_RUN.test(t) ? 'CJK' : 'Sans' }));
}

function adfBlocksPdf(node) {
  const out = [];
  for (const b of node?.content ?? []) {
    if (b.type === 'paragraph') out.push({ text: runs(adfText(b)), margin: [0, 2, 0, 2] });
    else if (b.type === 'bulletList') out.push({ ul: b.content.map((li) => ({ text: runs(adfText(li)) })) });
    else if (b.type === 'codeBlock') out.push({ text: runs(adfText(b)), fontSize: 8, background: '#f4f5f7' });
    else if (b.type === 'table') {
      const width = Math.max(...b.content.map((r) => r.content.reduce((s, c) => s + (c.attrs?.colspan ?? 1), 0)));
      out.push({
        table: {
          headerRows: 1,
          widths: Array(width).fill('*'),
          body: b.content.map((r) => r.content.flatMap((c) => {
            const span = c.attrs?.colspan ?? 1;
            return [{ text: runs(adfText(c)), colSpan: span }, ...Array(span - 1).fill({})];
          })),
        },
        margin: [0, 4, 0, 4],
      });
    }
  }
  return out;
}

async function buildPdf(issues, imgs) {
  const f = (name) => join(HERE, 'g5/fonts', name);
  pdfmake.setFonts({ Sans: { normal: f('NotoSans-Regular.ttf'), bold: f('NotoSans-Bold.ttf') },
    CJK: { normal: f('NotoSansSC-Regular.otf'), bold: f('NotoSansSC-Bold.otf') } });
  pdfmake.setLocalAccessPolicy((p) => p.startsWith(join(HERE, 'g5/fonts')));
  pdfmake.setUrlAccessPolicy(() => false);
  const content = [];
  for (const x of issues) {
    content.push({ text: runs(`${x.key} ${x.fields.summary}`), style: 'h' });
    content.push({ stack: adfBlocksPdf(x.fields.description) });
    if (imgs.has(x.key)) content.push({ image: `data:image/png;base64,${imgs.get(x.key).toString('base64')}`, width: 240 });
    for (const c of x.fields.comment?.comments ?? []) content.push({ text: runs(`— ${adfText(c.body)}`), fontSize: 9 });
  }
  const def = { content, defaultStyle: { font: 'Sans', fontSize: 10 }, styles: { h: { fontSize: 13, bold: true, margin: [0, 10, 0, 4] } },
    header: { text: 'ArtUp Reports · project = RPT', margin: [40, 16, 40, 0], fontSize: 8 }, pageSize: 'A4' };
  return pdfmake.createPdf(def).getBuffer();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  const r = { date: new Date().toISOString(), node: process.version, args };

  const paged = await timed('A1 paged search, 100/page, sequential', () => fetchPaged(args.issues));
  r.fetchPaged = { seconds: paged.seconds, issues: paged.value.length };
  paged.value = null;
  const bulk = await timed(`A2 ids + bulkfetch ×${args.concurrency}`, () => fetchBulk(args.issues, args.concurrency));
  const issues = bulk.value;
  r.fetchBulk = { seconds: bulk.seconds, issues: issues.length, peakRssMb: bulk.peakRssMb };

  const xj = await timed('B1 xlsx exceljs (styles, links, freeze, filter)', () => xlsxExcelJs(issues));
  await writeFile(join(OUT, 'rpt-exceljs.xlsx'), xj.value);
  r.xlsxExcelJs = { seconds: xj.seconds, bytes: xj.value.length, peakRssMb: xj.peakRssMb };
  const xs = await timed('B2 xlsx SheetJS CE (no styles)', async () => xlsxSheetJs(issues));
  await writeFile(join(OUT, 'rpt-sheetjs.xlsx'), xs.value);
  r.xlsxSheetJs = { seconds: xs.seconds, bytes: xs.value.length, peakRssMb: xs.peakRssMb };

  const withImg = issues.filter((x) => x.fields.attachment.length);
  const docSet = [...withImg, ...issues.filter((x) => !x.fields.attachment.length)].slice(0, args.docs);
  const im = await timed(`C0 download ${withImg.length} images`, () => images(docSet, args.concurrency));
  r.images = { seconds: im.seconds, count: im.value.size };
  const dx = await timed(`C1 docx ${docSet.length} issues`, () => buildDocx(docSet, im.value));
  await writeFile(join(OUT, 'rpt.docx'), dx.value);
  r.docx = { seconds: dx.seconds, bytes: dx.value.length, peakRssMb: dx.peakRssMb, withImagesSeconds: Math.round((im.seconds + dx.seconds) * 10) / 10 };
  const pf = await timed(`C2 pdf ${docSet.length} issues`, () => buildPdf(docSet, im.value));
  await writeFile(join(OUT, 'rpt.pdf'), pf.value);
  r.pdf = { seconds: pf.seconds, bytes: pf.value.length, peakRssMb: pf.peakRssMb, withImagesSeconds: Math.round((im.seconds + pf.seconds) * 10) / 10 };

  r.requests = stats;
  r.xlsxTotalSeconds = Math.round((bulk.seconds + xj.seconds) * 10) / 10;
  r.gate = {
    xlsx: r.xlsxTotalSeconds <= 120 && Math.max(bulk.peakRssMb, xj.peakRssMb) <= 1024,
    docx: r.docx.withImagesSeconds <= 120,
    pdf: r.pdf.withImagesSeconds <= 120,
  };
  await writeFile(join(HERE, '..', 'data', 'xg5-measurements.json'), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
  clearInterval(sampler);
}

main().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
