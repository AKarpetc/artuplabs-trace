import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeContactSheet } from './contact-sheet.mjs';

/**
 * Screenshot matrix and layout probes over the preview stand (`?screen=global|admin&state=…`).
 * Usage: node scripts/screenshots.mjs [--probe-only] [--matrix-only] [--locales=de-DE,fi-FI] [--jobs=6]
 */

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(appDir, 'screenshots');

const ALL_LOCALES = [
  'zh-CN', 'zh-TW', 'cs-CZ', 'da-DK', 'nl-NL', 'en-US', 'en-GB', 'et-EE',
  'fi-FI', 'fr-FR', 'de-DE', 'hu-HU', 'is-IS', 'it-IT', 'ja-JP', 'ko-KR',
  'no-NO', 'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'tr-TR',
  'es-ES', 'sv-SE',
];
const MATRIX_LOCALES = ['en-US', 'de-DE', 'ru-RU', 'ja-JP', 'fi-FI', 'zh-CN'];
const THEMES = ['light', 'dark'];
const MATRIX = {
  global: { states: ['reference', 'reference-empty-search', 'status-idle', 'status-building', 'status-errors', 'unlicensed'], widths: [1280, 800] },
  admin: { states: ['admin', 'admin-busy', 'admin-reset-dialog', 'admin-forbidden'], widths: [1280, 800] },
};
const PROBE = {
  global: { states: MATRIX.global.states, widths: [1280, 800] },
  admin: { states: MATRIX.admin.states, widths: [1280, 800] },
};
const HEIGHT = 900;
const MAX_HEIGHT = 6000;

const OVERFLOW_SELECTOR = 'button, [role=tab], [role=radio], label, h1, h2, h3, [data-testid]';
const CLIP_SCOPE = 'button, [role=tab], [role=radio], label, h1, h2, h3, h4, p, span, td, th, li, [data-testid]';
const TRUNCATION_SCOPE = 'button, [role=tab], [role=radio], label, h1, h2, h3';
const KEY_PATTERN = '^[a-z]+(\\.[a-z-]+)+$';
const FILE_EXTENSIONS = ['md', 'json', 'txt', 'pages', 'yml', 'yaml', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'zip', 'csv', 'drawio'];

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
const probeLocales = args.locales ? String(args.locales).split(',') : ALL_LOCALES;
const concurrency = Number(args.jobs) || 6;

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function startVite() {
  const port = await freePort();
  const child = spawn('npx', ['vite', '--mode', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const base = `http://127.0.0.1:${port}/`;
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    try {
      const response = await fetch(base);
      if (response.ok) return { base, stop: () => child.kill('SIGTERM') };
    } catch {
      await new Promise((done) => { setTimeout(done, 300); });
    }
  }
  child.kill('SIGTERM');
  throw new Error(`vite did not start:\n${log}`);
}

function buildJobs() {
  const jobs = new Map();
  const add = (entry, state, theme, locale, width, flags, target = '') => {
    const id = `${entry}-${state}${target ? `@${target}` : ''}-${theme}-${locale}-${width}`;
    const job = jobs.get(id) ?? { id, entry, state, target, theme, locale, width, shot: false, probe: false };
    Object.assign(job, flags);
    jobs.set(id, job);
  };
  if (!args['probe-only']) {
    for (const [entry, { states, widths }] of Object.entries(MATRIX)) {
      for (const state of states) for (const theme of THEMES) for (const locale of MATRIX_LOCALES) for (const width of widths) {
        add(entry, state, theme, locale, width, { shot: true, probe: true });
      }
    }
  }
  if (!args['matrix-only']) {
    for (const [entry, { states, widths }] of Object.entries(PROBE)) {
      for (const state of states) for (const locale of probeLocales) for (const width of widths) {
        add(entry, state, 'light', locale, width, { probe: true });
      }
    }
  }
  return [...jobs.values()];
}

function url(base, job) {
  return `${base}?screen=${job.entry}&state=${job.state}&locale=${job.locale}&theme=${job.theme}`;
}

const READY = {
  reference: '[data-testid^="fn-"]',
  'status-idle': '[data-testid="status-index"]',
  'status-building': '[data-testid="status-index"]',
  'status-errors': '[data-testid="panel-status"] table',
  admin: '[data-testid="admin-progress"]',
  'admin-busy': '[data-testid="reindex-error"]',
  'admin-reset-dialog': '[data-testid="reset-dialog"]',
  'admin-forbidden': '[data-testid="admin-error"]',
};

async function waitReady(page, job) {
  const timeout = 45000;
  if (job.state === 'unlicensed') {
    await page.waitForFunction(() => document.querySelector('h1')?.textContent.trim(), null, { timeout });
  } else if (job.state === 'reference-empty-search') {
    await page.waitForFunction(() => document.querySelector('[data-testid="reference-search"]')?.value === 'zzzz' && !document.querySelector('[data-testid^="fn-"]'), null, { timeout });
  } else {
    await page.waitForSelector(READY[job.state], { timeout });
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid="status-loading"]'), null, { timeout });
  await page.waitForTimeout(job.state === 'admin-reset-dialog' ? 700 : 350);
}

function probePage({ selector, truncationScope, clipScope, keyPattern, extensions }) {
  const describe = (el) => {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 3) {
      const testId = node.getAttribute('data-testid');
      const role = node.getAttribute('role');
      parts.unshift(`${node.tagName.toLowerCase()}${testId ? `[data-testid=${testId}]` : ''}${role ? `[role=${role}]` : ''}`);
      if (testId) break;
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const scrolls = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) return true;
    }
    return false;
  };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const overflow = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el) || el.clientWidth === 0 || scrolls(el) || /spinner/.test(el.getAttribute('data-testid') ?? '')) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const style = getComputedStyle(el);
    if (style.textOverflow === 'ellipsis' || style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    overflow.push({ selector: describe(el), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), by: el.scrollWidth - el.clientWidth });
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.matches('input, textarea, select') || getComputedStyle(el).textOverflow !== 'ellipsis' || !el.closest(truncationScope)) continue;
    overflow.push({ selector: `${describe(el)} (ellipsis)`, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), by: el.scrollWidth - el.clientWidth });
  }
  const ownText = (el) => [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim();
  for (const el of document.querySelectorAll(clipScope)) {
    if (!visible(el) || el.clientWidth <= 1 || el.clientHeight <= 1 || !ownText(el)) continue;
    const style = getComputedStyle(el);
    const clipsX = ['hidden', 'clip'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== 'ellipsis';
    const clipsY = ['hidden', 'clip'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (clipsX || clipsY) overflow.push({ selector: `${describe(el)} (clipped)`, text: ownText(el).slice(0, 60), by: Math.max(el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight) });
  }
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1) {
    overflow.push({ selector: 'document (horizontal scroll)', text: '', by: root.scrollWidth - root.clientWidth });
  }
  const pattern = new RegExp(keyPattern);
  const isFile = (text) => extensions.includes(text.split('.').pop());
  const keys = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (pattern.test(text) && !isFile(text) && node.parentElement && visible(node.parentElement)) keys.push({ selector: describe(node.parentElement), text });
  }
  for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const name of ['aria-label', 'placeholder', 'title']) {
      const text = (el.getAttribute(name) ?? '').trim();
      if (pattern.test(text) && !isFile(text)) keys.push({ selector: `${describe(el)} @${name}`, text });
    }
  }
  return { overflow, keys };
}

async function capture(page, job) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (height > HEIGHT) {
    await page.setViewportSize({ width: job.width, height: Math.min(height, MAX_HEIGHT) });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}/${job.id}.png` });
}

async function runJob(browser, base, job) {
  const context = await browser.newContext({ viewport: { width: job.width, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url(base, job));
    await waitReady(page, job);
    const found = job.probe ? await page.evaluate(probePage, { selector: OVERFLOW_SELECTOR, truncationScope: TRUNCATION_SCOPE, clipScope: CLIP_SCOPE, keyPattern: KEY_PATTERN, extensions: FILE_EXTENSIONS }) : { overflow: [], keys: [] };
    if (job.shot) await capture(page, job);
    return { job, ...found, pageErrors };
  } catch (error) {
    return { job, overflow: [], keys: [], pageErrors, failure: error.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

async function pool(items, size, work) {
  const results = [];
  let next = 0;
  let finished = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      results.push(await work(item));
      finished += 1;
      if (finished % 25 === 0 || finished === items.length) process.stdout.write(`  ${finished}/${items.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: size }, lane));
  return results;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!args['probe-only']) {
    for (const name of readdirSync(OUT)) if (name.endsWith('.png') || name.endsWith('.mjs')) rmSync(resolve(OUT, name));
  }
  const jobs = buildJobs();
  console.log(`screenshots: ${jobs.filter((job) => job.shot).length} images, ${jobs.filter((job) => job.probe).length} probed pages`);
  const vite = await startVite();
  const browser = await chromium.launch();
  let results;
  try {
    await pool([{ ...jobs[0], shot: false, probe: false }], 1, (job) => runJob(browser, vite.base, job));
    results = await pool(jobs, concurrency, (job) => runJob(browser, vite.base, job));
  } finally {
    await browser.close();
    vite.stop();
  }
  let failed = false;
  for (const { job, overflow, keys, pageErrors, failure } of results.sort((a, b) => a.job.id.localeCompare(b.job.id))) {
    const where = `${job.locale} ${job.entry}:${job.state}${job.target ? `@${job.target}` : ''} ${job.theme} ${job.width}`;
    for (const hit of overflow) console.log(`OVERFLOW ${where} ${hit.selector} +${hit.by}px "${hit.text}"`);
    for (const hit of keys) console.log(`RAW KEY ${where} ${hit.selector} "${hit.text}"`);
    for (const message of pageErrors) console.log(`PAGE ERROR ${where} ${message}`);
    if (failure) console.log(`NOT READY ${where} ${failure}`);
    if (overflow.length || keys.length || pageErrors.length || failure) failed = true;
  }
  if (!args['probe-only']) {
    const sheet = writeContactSheet(OUT);
    console.log(`contact sheet: ${sheet}`);
  }
  console.log(failed ? 'screenshots: FAILED' : 'screenshots: clean');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
