/**
 * Shared pieces of the acceptance scripts: a Node fetch adapter with the `requestJira` contract,
 * Node renderers (Node pdfmake engine, fonts read from disk), labels/formats, a peak-memory sampler.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const APP = fileURLToPath(new URL('../../static/app/', import.meta.url));
export const SITE = 'https://artuplabs-dev.atlassian.net';

const appUrl = (path) => new URL(path, `file://${APP}`).href;
export const load = (path) => import(appUrl(path));

/** `requestJira(path, init)` over Node fetch with basic auth from FORGE_EMAIL / FORGE_API_TOKEN. */
export function createNodeRequest() {
  const email = process.env.FORGE_EMAIL;
  const token = process.env.FORGE_API_TOKEN;
  if (!email || !token) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  return (path, init = {}) => fetch(`${SITE}${path}`, { ...init, headers: { Authorization: auth, ...init.headers } });
}

/** Sleep that a client may use for backoff. */
export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Client factory for `createExportRun`: the real Jira client over the Node request. */
export async function clientFactory(extra = {}) {
  const { createJiraClient } = await load('src/infra/jira.js');
  const request = createNodeRequest();
  return ({ onRetry } = {}) => createJiraClient({ request, sleep, onRetry, ...extra });
}

/** en-US file labels through the same key list the app uses. */
export async function fileLabels() {
  const { labelsFor } = await load('src/wizard/labels.js');
  const dict = JSON.parse(readFileSync(`${APP}src/i18n/locales/en-US.json`, 'utf8'));
  const t = (key, values = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  return labelsFor(t);
}

/** Date formats as the app builds them for a locale. */
export async function fileFormats(locale = 'en-US') {
  const { formatsFor } = await load('src/wizard/labels.js');
  return formatsFor(locale);
}

const FONT_FILES = {
  latin: ['Sans', 'NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'],
  cjk: ['CJK', 'NotoSansSC-Regular.otf', 'NotoSansSC-Bold.otf'],
  korean: ['KR', 'NotoSansKR-Regular.otf', 'NotoSansKR-Bold.otf'],
};

function fontSources() {
  return Object.fromEntries(Object.entries(FONT_FILES).map(([script, [family, normal, bold]]) => {
    const source = (name) => [name, async () => ({ default: `data:font/ttf;base64,${readFileSync(`${APP}fonts/${name}`).toString('base64')}` })];
    return [script, { family, normal: source(normal), bold: source(bold) }];
  }));
}

/** The four renderers with the Node PDF engine in place of the browser one. */
export async function nodeRenderers() {
  const { loadRenderers } = await load('src/export/renderers.js');
  const base = loadRenderers();
  const { renderPdf } = await load('src/render/pdf.js');
  const { loadFonts } = await load('src/infra/fonts.js');
  const { createNodePdfEngine } = await load('test/fixtures/nodePdfEngine.js');
  const sources = fontSources();
  const engine = createNodePdfEngine();
  return {
    ...base,
    pdf: (input) => renderPdf({ ...input, engine, loadFonts: (scripts) => loadFonts(scripts, sources) }),
  };
}

/** Samples process memory every 250 ms; `stop()` returns the peaks in bytes. */
export function sampleMemory() {
  const peak = { rss: 0, heapUsed: 0 };
  const take = () => {
    const usage = process.memoryUsage();
    peak.rss = Math.max(peak.rss, usage.rss);
    peak.heapUsed = Math.max(peak.heapUsed, usage.heapUsed);
  };
  take();
  const timer = setInterval(take, 250);
  return { stop() { clearInterval(timer); take(); return { ...peak }; } };
}

export const mb = (bytes) => Math.round(bytes / 1048576);
export const clock = () => performance.now();

/** Export metadata as the run hook builds it. */
export async function exportMeta({ paper = 'A4' } = {}) {
  const formats = await fileFormats();
  const now = new Date();
  return { siteUrl: SITE, exportedBy: 'Acceptance run', now, exportedAt: formats.dateTime(now), paper };
}

/** Field catalog of the site. */
export async function siteCatalog(factory) {
  const { buildFieldCatalog } = await load('src/core/fields.js');
  return buildFieldCatalog(await factory().getFields());
}
