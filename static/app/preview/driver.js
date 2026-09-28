import { DEFAULT_OPTIONS } from '../src/core/presets.js';
import { runExport } from '../src/export/pipeline.js';
import { createConfluenceClient } from '../src/infra/confluence.js';
import { readManifestFromFile } from '../src/infra/zip.js';
import { routeConfluence, SPACE } from './fixtures.js';

/** Preview states that start an export by themselves once the studio is ready. */
export const RUN_STATES = ['running', 'done', 'done-update', 'failed'];

const SITE = 'https://preview.atlassian.net';
const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await wait(50);
  }
  throw new Error('preview driver: timed out');
}

async function previousExport() {
  const client = createConfluenceClient({ request: async (path) => routeConfluence(path), sleep: async () => {} });
  const result = await runExport({
    client, target: { kind: 'space', spaceKey: SPACE.key }, options: DEFAULT_OPTIONS, previousManifest: null,
    siteUrl: SITE, signal: new AbortController().signal, onProgress: () => {}, now: new Date(2026, 8, 1),
  });
  const manifest = JSON.parse(await readManifestFromFile(new File([result.blob], 'previous.zip')));
  manifest.pages.slice(3, 9).forEach((page) => {
    page.version -= 1;
  });
  const template = manifest.pages[manifest.pages.length - 1];
  manifest.pages.push(
    { ...template, id: '990001', title: 'Retired page', path: 'archive/retired-page.md', name: 'retired-page', links: [], attachments: [] },
    { ...template, id: '990002', title: 'Secret page', path: 'archive/secret-page.md', name: 'secret-page', links: [], attachments: [] },
  );
  return new File([JSON.stringify(manifest)], 'export-manifest.json', { type: 'application/json' });
}

async function loadPrevious() {
  const input = await until(() => document.querySelector('input[type="file"]'));
  const transfer = new DataTransfer();
  transfer.items.add(await previousExport());
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => document.querySelector('[data-testid="mode-update"][aria-checked="true"]'));
}

/** Drives the studio for `?state=running|done|done-update|failed`: optionally loads a previous export, then presses Export. */
export async function drive(state) {
  if (!RUN_STATES.includes(state)) return;
  await until(() => document.querySelector('[data-testid="front-matter"]'));
  if (state === 'done-update') await loadPrevious();
  const button = await until(() => {
    const found = document.querySelector('[data-testid="studio-export"]');
    return found && !found.disabled && /\d/.test(found.textContent) ? found : null;
  });
  button.click();
}

/** Drives the page action for `?state=running|done|failed`: picks the page with its subpages once counted, then presses Export. */
export async function driveAction(state) {
  if (!RUN_STATES.includes(state) || state === 'done-update') return;
  const branch = await until(() => {
    const found = document.querySelector('[data-testid="action-branch"]');
    return found && found.getAttribute('aria-disabled') !== 'true' && !found.querySelector('[data-testid="action-count-skeleton"]') ? found : null;
  });
  branch.click();
  const button = await until(() => {
    const found = document.querySelector('[data-testid="action-export"]');
    return found && !found.disabled && /\d/.test(found.textContent) ? found : null;
  });
  button.click();
}
