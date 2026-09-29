import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeContactSheet } from './contact-sheet.mjs';

/**
 * Screenshot matrix and layout probes over the preview harness.
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
  studio: { states: ['form', 'form-update', 'running', 'done', 'done-update', 'failed', 'unlicensed'], widths: [1280, 800] },
  action: { states: ['form', 'done'], widths: [1280, 800, 600] },
};
const PROBE = {
  studio: { states: ['form', 'running', 'done'], widths: [1280, 800] },
  action: { states: ['form', 'done'], widths: [800, 600] },
};
const LONG_TITLE_PAGE = '100026';
const HEIGHT = { studio: 900, action: 640 };
const MAX_HEIGHT = 6000;

const OVERFLOW_SELECTOR = 'button, [role=tab], [role=radio], label, h1, h2, h3, [data-testid]';
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
      for (const state of states) for (const theme of THEMES) for (const locale of probeLocales) for (const width of widths) {
        add(entry, state, theme, locale, width, { probe: true });
      }
    }
    for (const theme of THEMES) for (const locale of probeLocales) for (const width of PROBE.action.widths) {
      add('action', 'form', theme, locale, width, { probe: true }, LONG_TITLE_PAGE);
    }
  }
  return [...jobs.values()];
}

function url(base, job) {
  const state = job.state === 'form' ? '' : `&state=${job.state}`;
  const target = job.target ? `&target=${job.target}` : '';
  return `${base}?entry=${job.entry}&locale=${job.locale}&theme=${job.theme}${state}${target}`;
}

async function waitReady(page, job) {
  const timeout = 45000;
  const has = (selector) => page.waitForSelector(selector, { timeout });
  if (job.state === 'unlicensed') {
    await page.waitForFunction(() => document.querySelector('h1')?.textContent.trim(), null, { timeout });
  } else if (job.state === 'running') {
    await has('[data-testid="run-view"]');
    await page.waitForFunction(() => /[1-9]/.test(document.querySelector('[data-testid="run-percent"]')?.textContent ?? ''), null, { timeout });
    let previous = '';
    for (let i = 0; i < 40; i += 1) {
      const current = await page.textContent('[data-testid="run-percent"]');
      if (current === previous) break;
      previous = current;
      await page.waitForTimeout(700);
    }
  } else if (job.state === 'done' || job.state === 'done-update') {
    await has('[data-testid="result-view"]');
  } else if (job.state === 'failed') {
    await has('[data-testid="failure-view"]');
  } else if (job.entry === 'action') {
    await has('[data-testid="file-tree-row"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="action-count-skeleton"]'), null, { timeout });
  } else {
    if (job.state === 'form-update') await has('[data-testid="mode-update"][aria-checked="true"]');
    await has('[data-testid="front-matter"]');
    await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="studio-export"]')?.textContent ?? ''), null, { timeout });
  }
  await page.waitForTimeout(350);
}

function probePage({ selector, truncationScope, keyPattern, extensions }) {
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
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const overflow = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el) || el.clientWidth === 0) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (getComputedStyle(el).textOverflow === 'ellipsis') continue;
    overflow.push({ selector: describe(el), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), by: el.scrollWidth - el.clientWidth });
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.matches('input, textarea, select') || getComputedStyle(el).textOverflow !== 'ellipsis' || !el.closest(truncationScope)) continue;
    overflow.push({ selector: `${describe(el)} (ellipsis)`, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), by: el.scrollWidth - el.clientWidth });
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
  const path = `${OUT}/${job.id}.png`;
  if (job.entry === 'action') {
    await page.screenshot({ path });
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
    if (scrollable) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${job.id}.bottom.png` });
    }
    return;
  }
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (height > HEIGHT.studio) {
    await page.setViewportSize({ width: job.width, height: Math.min(height, MAX_HEIGHT) });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path });
}

async function runJob(browser, base, job) {
  const context = await browser.newContext({ viewport: { width: job.width, height: HEIGHT[job.entry] }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url(base, job));
    await waitReady(page, job);
    const found = job.probe ? await page.evaluate(probePage, { selector: OVERFLOW_SELECTOR, truncationScope: TRUNCATION_SCOPE, keyPattern: KEY_PATTERN, extensions: FILE_EXTENSIONS }) : { overflow: [], keys: [] };
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
