#!/usr/bin/env node
/**
 * Acceptance check of one downloaded export file (xlsx / docx / pdf). Not a unit-tested module:
 * it is the tool of the browser acceptance session (atlassian/plans/NEXT_SESSION_PROMPT_APP3_BROWSER_TEST.md,
 * section «Проверка скачанных файлов»).
 *
 * Usage (from apps/reports):
 *   node scripts/verify-download.mjs --file <path> --case <ID>
 *        [--expect-issues N]        issues in the export: summary/description/meta count; also data rows unless --expect-rows
 *        [--expect-rows N]          xlsx data rows when they are not issues (work logs, comments)
 *        [--jql "..."]              JQL the export ran (the file may append " ORDER BY ..."; a prefix match is enough)
 *        [--expect-keys RPT-1,RPT-2] issue keys that must be in the document text (docx/pdf; xlsx: key column)
 *        [--page-size A4|Letter]    docx/pdf paper (default A4)
 *        [--cjk]                    pdf/docx text must contain CJK characters
 *        [--partial]                the file is a partial export: -PARTIAL in the name and the partial banner inside
 *        [--custom]                 docx made from a customer Word template: page-number field, header rows,
 *                                   page size and the meta count line belong to the customer, so they are warnings
 *        [--expect-name <name>]     exact expected file name (a template with its own file-name pattern)
 *        [--no-render]              skip the pdftoppm page render
 *
 * Output: pretty JSON with every number, then a last line `PASS` or `FAIL: <reasons>`; the JSON is also written
 * next to the file as `<name>.verify.json`. Exit code 1 on FAIL, 2 on a usage error.
 *
 * File-name check. The name must match DEFAULT_FILE_PATTERN ('{project}-{date}-{filter}', static/app/src/core/filename.js)
 * with `-PARTIAL` before the extension exactly when --partial is given. The inbox prefix `<ID>__` and Chrome's
 * duplicate suffix ` (N)` are stripped first. The name counts as a browser name only when --case does not start with
 * NODE and the file is in data/browser-test/ or carries the `<ID>__` prefix; otherwise (Node acceptance files such as
 * data/rpt-10k.xlsx, named by the --out argument) a name mismatch is only a warning.
 *
 * Labels (summary rows, "Issues: N", partial banner) are matched in every locale under static/app/src/i18n/locales,
 * so a file exported in any Jira language is recognised.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../static/app/', import.meta.url));
const require = createRequire(new URL('../static/app/package.json', import.meta.url));
const SITE = 'https://artuplabs-dev.atlassian.net';
const CJK = /[぀-ヿ一-鿿가-힯]/u;
const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const EXCEL_CELL_LIMIT = 32767;
const DOCX_PAPER = { A4: { w: 11906, h: 16838 }, LETTER: { w: 12240, h: 15840 } };
const PDF_PAPER = { A4: { w: 595, h: 842 }, LETTER: { w: 612, h: 792 } };
const PDF_TOLERANCE = 2;

const BOOLEAN_FLAGS = new Set(['cjk', 'partial', 'custom', 'no-render']);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].replace(/^--/, '');
    if (BOOLEAN_FLAGS.has(name)) options[name] = true;
    else { options[name] = argv[i + 1]; i += 1; }
  }
  return options;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every locale's file labels: { key: Set(values) } plus regexes for "Issues: N" and the partial banner. */
function localeLabels() {
  const dir = join(APP, 'src/i18n/locales');
  const dicts = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const values = (key) => [...new Set(dicts.map((d) => d[key]).filter((v) => typeof v === 'string'))];
  const bannerRes = values('file.partialBanner').map((text) => new RegExp(escapeRe(text).replace(/\\\{done\\\}|\\\{total\\\}/g, '(\\d+)')));
  const countLabels = [...new Set([...values('file.meta.count'), ...values('file.summary.count')])];
  return {
    values,
    banner: (text) => bannerRes.some((re) => re.test(text)),
    countIn: (text) => {
      for (const label of countLabels) {
        const m = new RegExp(`${escapeRe(label)}\\s*[:：]\\s*(\\d+)`).exec(text);
        if (m) return Number(m[1]);
      }
      return null;
    },
  };
}

async function defaultPattern() {
  const { DEFAULT_FILE_PATTERN } = await import(new URL('src/core/filename.js', `file://${APP}`).href);
  return DEFAULT_FILE_PATTERN;
}

/** File-name check; returns { report, failures, warnings } that the caller routes to failures or warnings. */
async function checkName({ path, options, ext }) {
  const pattern = await defaultPattern();
  const raw = basename(path);
  const prefixed = /^[A-Za-z0-9.-]+__/.test(raw);
  let name = raw.replace(/^[A-Za-z0-9.-]+__/, '');
  const duplicate = / \(\d+\)(?=\.[a-z]+$)/.exec(name);
  name = name.replace(/ \(\d+\)(?=\.[a-z]+$)/, '');
  const fromBrowser = !/^NODE/i.test(options.case) && (prefixed || resolve(path).includes(`${join('data', 'browser-test')}`));
  const problems = [];
  const notes = [];
  if (duplicate) notes.push(`browser duplicate suffix "${duplicate[0].trim()}" stripped`);
  if (pattern !== '{project}-{date}-{filter}') notes.push(`DEFAULT_FILE_PATTERN is now "${pattern}"; the name regex below assumes {project}-{date}-{filter}`);
  const re = new RegExp(`^(?:(?<project>[^.]+?)-)?(?<date>\\d{4}-\\d{2}-\\d{2})(?:-(?<filter>.+?))?(?<partial>-PARTIAL)?\\.${ext}$`);
  const m = re.exec(name);
  if (options['expect-name']) {
    if (name !== options['expect-name']) problems.push(`name "${name}" != expected "${options['expect-name']}"`);
  } else if (!m) problems.push(`name "${name}" does not match ${pattern}[-PARTIAL].${ext}`);
  const partialInName = /-PARTIAL\.[a-z]+$/.test(name);
  if (options.partial && !partialInName) problems.push('partial export without -PARTIAL in the name');
  if (!options.partial && partialInName) problems.push('-PARTIAL in the name of a complete export');
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (m && m.groups.date !== localToday) notes.push(`date in name ${m.groups.date} is not today ${localToday}`);
  return {
    report: { original: raw, checked: name, fromBrowser, pattern, project: m?.groups.project ?? null, date: m?.groups.date ?? null, filter: m?.groups.filter ?? null, partialInName },
    failures: fromBrowser ? problems : [],
    warnings: [...(fromBrowser ? [] : problems.map((p) => `${p} (not a browser file name: warning only)`)), ...notes],
  };
}

function detectFormat(path, bytes) {
  const ext = extname(path).slice(1).toLowerCase();
  const head = bytes.subarray(0, 4).toString('latin1');
  if (head === '%PDF') return { format: 'pdf', ext, signature: 'pdf' };
  if (head.startsWith('PK')) {
    const text = bytes.subarray(0, Math.min(bytes.length, 65536)).toString('latin1');
    const kind = text.includes('xl/') ? 'xlsx' : text.includes('word/') ? 'docx' : ext;
    return { format: ['xlsx', 'docx'].includes(ext) ? ext : kind, ext, signature: 'zip' };
  }
  return { format: ext, ext, signature: 'unknown' };
}

// ---------------------------------------------------------------- xlsx

const cellText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text ?? '');
    if ('result' in value) return String(value.result ?? '');
  }
  return String(value);
};

const DATE_TEXT = /^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}.*)?|[A-Z][a-z]{2} \d{1,2}, \d{4}(, .*)?|\d{1,2}[./]\d{1,2}[./]\d{2,4}( .*)?)$/;

function filterRow(ws) {
  const af = ws.autoFilter;
  if (!af) return null;
  if (typeof af === 'string') return Number(/\d+/.exec(af.split(':')[0])?.[0]);
  if (typeof af.from === 'string') return Number(/\d+/.exec(af.from)?.[0]);
  return af.from?.row ?? null;
}

async function checkXlsx(bytes, options, labels) {
  const { default: ExcelJS } = await import(require.resolve('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const failures = [];
  const warnings = [];
  const jql = options.jql;
  const expectIssues = options['expect-issues'] != null ? Number(options['expect-issues']) : null;
  const expectRows = options['expect-rows'] != null ? Number(options['expect-rows']) : expectIssues;

  const dataSheets = wb.worksheets.filter((ws) => ws.autoFilter);
  const otherSheets = wb.worksheets.filter((ws) => !ws.autoFilter);
  if (!dataSheets.length) failures.push('no data sheet with an autoFilter');

  let longCells = 0;
  let formulas = 0;
  let textStartingWithEquals = 0;
  let bannerSeen = false;
  const scanCell = (cell) => {
    const v = cell.value;
    if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) formulas += 1;
    if (cell.type === ExcelJS.ValueType.Formula) formulas += 0; // counted above; ValueType kept for clarity
    const text = cellText(v);
    if (text.length > EXCEL_CELL_LIMIT) longCells += 1;
    if (typeof v === 'string' && v.startsWith('=')) textStartingWithEquals += 1;
    if (labels.banner(text)) bannerSeen = true;
  };

  const sheetsReport = [];
  let totalRows = 0;
  let totalLinks = 0;
  let badLinks = 0;
  const badLinkSamples = [];
  const keysSeen = new Set();
  for (const ws of dataSheets) {
    const headerRow = filterRow(ws) ?? 1;
    const view = ws.views?.[0] ?? {};
    const frozen = view.state === 'frozen' && Number(view.ySplit) >= headerRow;
    if (!frozen) failures.push(`sheet "${ws.name}": header not frozen (views[0]=${JSON.stringify({ state: view.state, ySplit: view.ySplit })}, header row ${headerRow})`);
    const header = ws.getRow(headerRow).values.slice(1).map(cellText);
    const width = header.length;
    const perColumn = header.map(() => ({ dates: 0, dateText: 0, text: 0, links: 0 }));
    let rows = 0;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      row.eachCell({ includeEmpty: false }, scanCell);
      if (n <= headerRow) return;
      rows += 1;
      for (let c = 1; c <= width; c += 1) {
        const cell = row.getCell(c);
        const v = cell.value;
        const col = perColumn[c - 1];
        if (v instanceof Date) col.dates += 1;
        else if (v && typeof v === 'object' && v.hyperlink) col.links += 1;
        else if (typeof v === 'string' && v) { col.text += 1; if (DATE_TEXT.test(v.trim())) col.dateText += 1; }
      }
    });
    const keyCol = perColumn.reduce((best, col, i) => (col.links > (perColumn[best]?.links ?? -1) ? i : best), 0);
    let links = 0;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= headerRow) return;
      const v = row.getCell(keyCol + 1).value;
      if (!(v && typeof v === 'object' && v.hyperlink)) return;
      links += 1;
      const key = cellText(v);
      keysSeen.add(key);
      if (!KEY.test(key) || v.hyperlink !== `${SITE}/browse/${key}`) {
        badLinks += 1;
        if (badLinkSamples.length < 5) badLinkSamples.push({ row: n, text: key, hyperlink: v.hyperlink });
      }
    });
    const dateColumns = header.filter((_, i) => perColumn[i].dates > 0);
    const textDateColumns = header.filter((_, i) => perColumn[i].dateText > 0 && perColumn[i].dateText === perColumn[i].text && perColumn[i].dates === 0);
    if (rows > 0 && links !== rows) failures.push(`sheet "${ws.name}": ${links} links in key column "${header[keyCol]}" != ${rows} data rows`);
    if (textDateColumns.length) failures.push(`sheet "${ws.name}": dates stored as text in ${textDateColumns.join(', ')}`);
    if (rows > 0 && !dateColumns.length) warnings.push(`sheet "${ws.name}": no column with Date-typed cells`);
    totalRows += rows;
    totalLinks += links;
    sheetsReport.push({ name: ws.name, headerRow, rows, frozen, ySplit: view.ySplit ?? null, autoFilter: ws.autoFilter, keyColumn: header[keyCol] ?? null, links, dateColumns, textDateColumns, columns: header });
  }
  for (const ws of otherSheets) ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, scanCell));

  if (badLinks) failures.push(`${badLinks} key links not pointing to ${SITE}/browse/<KEY>`);
  if (expectRows != null && totalRows !== expectRows) failures.push(`data rows ${totalRows} != expected ${expectRows}`);
  if (longCells) failures.push(`${longCells} cells longer than ${EXCEL_CELL_LIMIT} characters`);
  if (formulas) failures.push(`${formulas} formula cells (issue text must be stored as strings)`);

  // Summary sheet: label/value rows in any locale.
  let summary = null;
  const summaryLabels = { jql: labels.values('file.summary.jql'), exportedAt: labels.values('file.summary.exportedAt'), exportedBy: labels.values('file.summary.exportedBy'), count: labels.values('file.summary.count') };
  for (const ws of otherSheets) {
    const found = {};
    ws.eachRow({ includeEmpty: false }, (row) => {
      const label = cellText(row.getCell(1).value);
      const value = row.getCell(2).value;
      for (const [key, names] of Object.entries(summaryLabels)) if (!(key in found) && names.includes(label)) found[key] = value instanceof Date ? value.toISOString() : value;
    });
    if (Object.keys(found).length) { summary = { sheet: ws.name, ...found }; break; }
  }
  if (summary) {
    if (jql && !String(summary.jql ?? '').startsWith(jql)) failures.push(`summary JQL "${summary.jql}" does not start with "${jql}"`);
    if (!summary.exportedAt) failures.push('summary has no export time');
    if (!summary.exportedBy) failures.push('summary has no author');
    if (expectIssues != null && Number(summary.count) !== expectIssues) failures.push(`summary count ${summary.count} != ${expectIssues}`);
  } else if (otherSheets.length) failures.push(`sheets ${otherSheets.map((s) => s.name).join(', ')} are not a recognisable summary`);
  else warnings.push('no summary sheet (template without one)');

  const description = String(wb.description ?? '');
  const descriptionCount = labels.countIn(description);
  if (jql && !description.includes(jql)) failures.push(`workbook description does not contain the JQL (got "${description}")`);
  if (descriptionCount == null) failures.push(`workbook description has no issue count (R28; got "${description}")`);
  else if (expectIssues != null && descriptionCount !== expectIssues) failures.push(`workbook description count ${descriptionCount} != ${expectIssues}`);

  if (options.partial && !bannerSeen) failures.push('partial file without the partial banner');
  if (!options.partial && bannerSeen) failures.push('partial banner in a complete export');

  if (options['expect-keys']) {
    const missing = options['expect-keys'].split(',').map((k) => k.trim()).filter((k) => k && !keysSeen.has(k));
    if (missing.length) failures.push(`keys missing from the key column: ${missing.join(', ')}`);
  }

  return {
    report: {
      sheets: wb.worksheets.map((ws) => ({ name: ws.name, rowCount: ws.rowCount, data: Boolean(ws.autoFilter) })),
      dataSheets: sheetsReport, dataRows: totalRows, keyLinks: totalLinks, badLinks, badLinkSamples, distinctKeys: keysSeen.size,
      summary, description, descriptionCount, title: wb.title ?? null, creator: wb.creator ?? null,
      longCells, formulas, textStartingWithEquals, partialBanner: bannerSeen,
    },
    failures, warnings,
  };
}

// ---------------------------------------------------------------- docx

function mediaKind(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return 'zip';
  return 'unknown';
}

const textOfXml = (xml) => xmlUnescape((xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
const paragraphsOf = (xml) => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(textOfXml);

async function checkDocx(bytes, options, labels) {
  const { default: PizZip } = await import(require.resolve('pizzip'));
  const zip = new PizZip(bytes);
  const failures = [];
  const warnings = [];
  const soft = (msg) => (options.custom ? warnings : failures).push(options.custom ? `${msg} (custom template: warning only)` : msg);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const xmlParts = names.filter((n) => /\.(xml|rels)$/.test(n));
  const leftover = {};
  for (const n of xmlParts) {
    const count = (zip.file(n).asText().match(/\{\{/g) ?? []).length;
    if (count) leftover[n] = count;
  }
  if (Object.keys(leftover).length) failures.push(`"{{" left in ${Object.entries(leftover).map(([n, c]) => `${n}×${c}`).join(', ')}`);

  const document = zip.file('word/document.xml')?.asText() ?? '';
  if (!document) failures.push('word/document.xml missing');

  // Media: signatures and relationships.
  const mediaNames = names.filter((n) => n.startsWith('word/media/'));
  const media = { total: mediaNames.length, png: 0, jpeg: 0, gif: 0, other: [] };
  for (const n of mediaNames) {
    const kind = mediaKind(Buffer.from(zip.file(n).asUint8Array().subarray(0, 16)));
    if (['png', 'jpeg', 'gif'].includes(kind)) media[kind] += 1;
    else media.other.push({ name: n, kind });
  }
  const badMedia = media.other.concat(mediaNames.filter((n) => /\.(pdf|zip)$/i.test(n)).map((name) => ({ name, kind: 'extension' })));
  if (badMedia.length) failures.push(`${badMedia.length} media files are not PNG/JPEG/GIF (R26): ${badMedia.slice(0, 5).map((m) => `${m.name}:${m.kind}`).join(', ')}`);

  const docRels = zip.file('word/_rels/document.xml.rels')?.asText() ?? '';
  const relTargets = new Map();
  for (const m of docRels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*\/?>/g)) relTargets.set(m[1], m[2]);
  for (const m of docRels.matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"[^>]*\/?>/g)) relTargets.set(m[2], m[1]);
  const docMediaTargets = new Set([...relTargets.values()].filter((t) => t.startsWith('media/')).map((t) => `word/${t}`));
  const otherRels = names.filter((n) => /^word\/_rels\/.+\.rels$/.test(n) && n !== 'word/_rels/document.xml.rels').map((n) => zip.file(n).asText()).join('');
  const withoutRel = mediaNames.filter((n) => !docMediaTargets.has(n) && !otherRels.includes(n.replace('word/', '')));
  const danglingRels = [...docMediaTargets].filter((t) => !zip.file(t));
  const embeds = [...document.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
  const embedsWithoutRel = embeds.filter((id) => !relTargets.has(id));
  if (withoutRel.length) failures.push(`${withoutRel.length} media files without a relationship: ${withoutRel.slice(0, 5).join(', ')}`);
  if (danglingRels.length) failures.push(`${danglingRels.length} image relationships point to missing files: ${danglingRels.slice(0, 5).join(', ')}`);
  if (embedsWithoutRel.length) failures.push(`${embedsWithoutRel.length} r:embed ids without a relationship: ${embedsWithoutRel.slice(0, 5).join(', ')}`);

  const drawings = (document.match(/<w:drawing>/g) ?? []).length;
  const tables = (document.match(/<w:tbl>/g) ?? []).length;
  const tblHeader = (document.match(/<w:tblHeader\b/g) ?? []).length;
  // The built-in layouts write key/value field tables without a header row, so a file may legitimately have none.
  if (tables && !tblHeader) warnings.push(`${tables} tables but no w:tblHeader (fine when every table is a field table)`);

  // Headers and footers.
  const hf = names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  const hfXml = hf.map((n) => zip.file(n).asText()).join('');
  const instr = (hfXml.match(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '').trim())
    .concat((hfXml.match(/w:instr="[^"]*"/g) ?? []).map((t) => t.slice(9, -1).trim()));
  const pageField = instr.some((t) => /^PAGE\b/.test(t));
  const numPagesField = instr.some((t) => /^NUMPAGES\b/.test(t));
  if (!pageField || !numPagesField) soft(`page number fields missing in header/footer (PAGE ${pageField}, NUMPAGES ${numPagesField})`);
  const headerLines = hf.filter((n) => n.includes('header')).flatMap((n) => paragraphsOf(zip.file(n).asText())).filter(Boolean);

  // Page size.
  const want = DOCX_PAPER[String(options['page-size'] ?? 'A4').toUpperCase()] ?? DOCX_PAPER.A4;
  const pgSz = [...document.matchAll(/<w:pgSz\b[^>]*>/g)].map((m) => ({ w: Number(/w:w="(\d+)"/.exec(m[0])?.[1]), h: Number(/w:h="(\d+)"/.exec(m[0])?.[1]) }));
  const wrongSize = pgSz.filter((s) => !((s.w === want.w && s.h === want.h) || (s.w === want.h && s.h === want.w)));
  if (!pgSz.length) soft('no w:pgSz in document.xml');
  if (wrongSize.length) soft(`page size ${JSON.stringify(wrongSize[0])} != ${options['page-size'] ?? 'A4'} ${want.w}x${want.h}`);

  // Text: keys, count, banner, JQL, CJK.
  const bodyText = paragraphsOf(document).join('\n');
  const allText = `${headerLines.join('\n')}\n${bodyText}`;
  const expectKeys = (options['expect-keys'] ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const missingKeys = expectKeys.filter((k) => !new RegExp(`${escapeRe(k)}(?!\\d)`).test(document));
  const distinctKeys = new Set(bodyText.match(/\b[A-Z][A-Z0-9_]+-\d+\b/g) ?? []).size;
  if (missingKeys.length) failures.push(`keys missing from document.xml: ${missingKeys.join(', ')}`);
  const metaCount = labels.countIn(headerLines.join('\n')) ?? labels.countIn(bodyText.slice(0, 5000));
  const expectIssues = options['expect-issues'] != null ? Number(options['expect-issues']) : null;
  if (expectIssues != null) {
    if (metaCount == null) {
      soft('no "Issues: N" line found in the header/first page');
      if (distinctKeys < expectIssues) warnings.push(`only ${distinctKeys} distinct issue keys in the text, expected at least ${expectIssues}`);
    }
    else if (metaCount !== expectIssues) failures.push(`meta count ${metaCount} != ${expectIssues}`);
  }
  const bannerSeen = labels.banner(allText);
  if (options.partial && !bannerSeen) failures.push('partial file without the partial banner text');
  if (!options.partial && bannerSeen) failures.push('partial banner in a complete export');
  const core = zip.file('docProps/core.xml')?.asText() ?? '';
  const coreDescription = xmlUnescape(/<dc:description>([^<]*)<\/dc:description>/.exec(core)?.[1] ?? '');
  const coreTitle = xmlUnescape(/<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? '');
  const jqlInFile = options.jql ? (allText.includes(options.jql) || coreDescription.includes(options.jql)) : null;
  if (options.jql && !jqlInFile) soft('JQL not found in the header, body or document properties');
  if (options.cjk && !CJK.test(allText)) failures.push('no CJK characters in the document text');
  if (coreTitle === 'Untitled' || headerLines.includes('Untitled')) warnings.push('report title is the fallback "Untitled"');

  return {
    report: {
      parts: names.length, media, drawings, embeds: embeds.length, mediaWithoutRel: withoutRel.length, danglingRels: danglingRels.length, embedsWithoutRel: embedsWithoutRel.length,
      leftoverTags: leftover, tables, tblHeader, pageField, numPagesField, pgSz: pgSz.slice(0, 3), sections: pgSz.length,
      headerLines: headerLines.slice(0, 6), coreTitle, coreDescription, metaCount, distinctKeys, missingKeys, jqlInFile,
      partialBanner: bannerSeen, cjk: CJK.test(allText), textChars: bodyText.length,
    },
    failures, warnings,
  };
}

// ---------------------------------------------------------------- pdf

async function checkPdf(bytes, options, labels, path) {
  const { getDocument } = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const numPages = doc.numPages;
  const failures = [];
  const warnings = [];
  const want = PDF_PAPER[String(options['page-size'] ?? 'A4').toUpperCase()] ?? PDF_PAPER.A4;
  const sizes = new Map();
  const wrongPages = [];
  const texts = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const w = Math.round(x1 - x0);
    const h = Math.round(y1 - y0);
    sizes.set(`${w}x${h}`, (sizes.get(`${w}x${h}`) ?? 0) + 1);
    const fits = (Math.abs(w - want.w) <= PDF_TOLERANCE && Math.abs(h - want.h) <= PDF_TOLERANCE) || (Math.abs(w - want.h) <= PDF_TOLERANCE && Math.abs(h - want.w) <= PDF_TOLERANCE);
    if (!fits && wrongPages.length < 5) wrongPages.push({ page: n, w, h });
    texts.push((await page.getTextContent()).items.map((item) => item.str).join(' '));
    page.cleanup();
  }
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info ?? {};
  await task.destroy();
  if (!numPages) failures.push('no pages');
  if (wrongPages.length) failures.push(`page size ${wrongPages[0].w}x${wrongPages[0].h} (page ${wrongPages[0].page}) != ${options['page-size'] ?? 'A4'} ${want.w}x${want.h}`);

  const all = texts.join('\n');
  const first = texts[0] ?? '';
  const expectKeys = (options['expect-keys'] ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const missingKeys = expectKeys.filter((k) => !new RegExp(`${escapeRe(k)}(?!\\d)`).test(all));
  if (missingKeys.length) failures.push(`keys missing from the text: ${missingKeys.join(', ')}`);
  const jqlLabels = labels.values('file.meta.jql');
  const heading = { title: info.Title ?? '', subject: info.Subject ?? '', author: info.Author ?? '', jqlLineOnPage1: jqlLabels.some((l) => first.includes(`${l}:`)) };
  if (!heading.title) failures.push('PDF has no document title');
  if (!heading.jqlLineOnPage1) failures.push('page 1 has no "JQL:" report heading line');
  if (heading.title === 'Untitled') warnings.push('report title is the fallback "Untitled"');
  const compact = (s) => s.replace(/\s+/g, '');
  if (options.jql && !compact(first).includes(compact(options.jql)) && !String(info.Subject ?? '').includes(options.jql)) failures.push('JQL not on page 1 nor in the PDF subject');
  const metaCount = labels.countIn(first);
  const expectIssues = options['expect-issues'] != null ? Number(options['expect-issues']) : null;
  if (expectIssues != null && metaCount !== expectIssues) failures.push(`meta count ${metaCount} != ${expectIssues}`);
  const cjkPages = texts.filter((t) => CJK.test(t)).length;
  if (options.cjk && !cjkPages) failures.push('no CJK characters in the text');
  const bannerSeen = labels.banner(all.replace(/\s+/g, ' ')) || labels.banner(compact(all));
  if (options.partial && !bannerSeen) failures.push('partial file without the partial banner text');
  if (!options.partial && bannerSeen) failures.push('partial banner in a complete export');
  const distinctKeys = new Set(all.match(/\b[A-Z][A-Z0-9_]+-\d+\b/g) ?? []).size;

  // Render pages 1-3 for a visual look.
  let render = { skipped: 'no-render' };
  if (!options['no-render']) {
    const which = spawnSync('which', ['pdftoppm'], { encoding: 'utf8' });
    if (which.status !== 0) {
      render = { skipped: 'pdftoppm not installed' };
      warnings.push('pdftoppm not installed: pages not rendered');
    } else {
      const out = join(dirname(path), `${options.case}-pages`);
      mkdirSync(out, { recursive: true });
      const run = spawnSync('pdftoppm', ['-r', '80', '-png', '-f', '1', '-l', '3', path, join(out, 'page')], { encoding: 'utf8' });
      const pngs = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.png')).sort().map((f) => join(out, f)) : [];
      render = { dir: out, exit: run.status, pngs, stderr: run.stderr?.trim().slice(0, 300) || undefined };
      if (run.status !== 0) warnings.push(`pdftoppm exit ${run.status}`);
    }
  }

  return {
    report: {
      pages: numPages, pageSizes: Object.fromEntries(sizes), heading, metaCount, distinctKeys, missingKeys,
      cjkPages, partialBanner: bannerSeen, page1: first.slice(0, 300), render,
    },
    failures, warnings,
  };
}

// ---------------------------------------------------------------- main

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.file || !options.case) {
    console.error('usage: node scripts/verify-download.mjs --file <path> --case <ID> [--expect-issues N] [--expect-rows N] [--jql "..."] [--expect-keys K1,K2] [--page-size A4|Letter] [--cjk] [--partial] [--custom] [--expect-name NAME] [--no-render]');
    process.exit(2);
  }
  const path = resolve(options.file);
  const started = Date.now();
  const bytes = readFileSync(path);
  const { format, ext, signature } = detectFormat(path, bytes);
  const failures = [];
  const warnings = [];
  if (bytes.length === 0) failures.push('file is empty');
  if (ext !== format) failures.push(`extension .${ext} but content is ${format}`);
  const name = await checkName({ path, options, ext: format });
  failures.push(...name.failures);
  warnings.push(...name.warnings);
  const labels = localeLabels();
  let result = { report: {}, failures: [], warnings: [] };
  try {
    if (format === 'xlsx') result = await checkXlsx(bytes, options, labels);
    else if (format === 'docx') result = await checkDocx(bytes, options, labels);
    else if (format === 'pdf') result = await checkPdf(bytes, options, labels, path);
    else failures.push(`unknown format (extension .${ext}, signature ${signature})`);
  } catch (error) {
    failures.push(`library could not open the file: ${error.message}`);
  }
  failures.push(...result.failures);
  warnings.push(...result.warnings);
  const report = {
    case: options.case, file: path, format, bytes: bytes.length, mb: Number((bytes.length / 1048576).toFixed(2)),
    modified: statSync(path).mtime.toISOString(),
    options: Object.fromEntries(Object.entries(options).filter(([k]) => !['file', 'case'].includes(k))),
    name: name.report, [format]: result.report,
    warnings, failures, pass: failures.length === 0, checkSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  };
  const json = JSON.stringify(report, null, 2);
  writeFileSync(`${path}.verify.json`, `${json}\n`);
  console.log(json);
  console.log(failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS');
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
