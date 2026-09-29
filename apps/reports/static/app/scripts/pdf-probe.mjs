import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Proves the browser build of pdfmake renders a PDF with the lazily loaded Noto fonts.
 * Usage: node scripts/pdf-probe.mjs
 */

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
      const response = await fetch(`${base}pdfProbe.html`);
      if (response.ok) return { base, stop: () => child.kill('SIGTERM') };
    } catch {
      await new Promise((done) => { setTimeout(done, 300); });
    }
  }
  child.kill('SIGTERM');
  throw new Error(`vite did not start:\n${log}`);
}

async function main() {
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => console.error('pageerror:', error.message));
    await page.goto(`${vite.base}pdfProbe.html`);
    await page.waitForFunction(() => document.title !== 'pending', null, { timeout: 120000 });
    const result = JSON.parse(await page.title());
    const external = requests.filter((url) => !url.startsWith(vite.base) && !url.startsWith('data:') && !url.startsWith('blob:'));
    console.log(JSON.stringify({ ...result, external }));
    if (!(result.ok && result.head === '%PDF') || external.length) process.exitCode = 1;
  } finally {
    await browser.close();
    vite.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
