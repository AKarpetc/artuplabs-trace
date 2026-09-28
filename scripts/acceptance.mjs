#!/usr/bin/env node
/**
 * Load acceptance for ArtUp Export: runs the real export pipeline from static/app/src in Node
 * against the development site, with a fetch-based request adapter and basic auth.
 *
 * Usage:
 *   set -a && . /path/to/.env && set +a
 *   node scripts/acceptance.mjs full   --space EXPT [--preset generic] --out data/full-1.zip
 *   node scripts/acceptance.mjs update --space EXPT --previous data/full-1.zip --out data/update.zip
 *   node scripts/acceptance.mjs edit   --space EXPT [--seed data/seed-EXPT.json] [--force]
 *
 * `edit` changes the dev space through REST: 3 page bodies, 1 rename, 1 move, 1 delete,
 * chosen deterministically from the seed data file written by scripts/seed-space.mjs.
 * It refuses any space other than EXPT unless --force is given.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExport } from '../static/app/src/export/pipeline.js';
import { createConfluenceClient } from '../static/app/src/infra/confluence.js';
import { parseManifest } from '../static/app/src/core/manifest.js';
import { DEFAULT_OPTIONS } from '../static/app/src/core/presets.js';
import { readManifestFromFile } from '../static/app/src/infra/zip.js';

const SITE = 'https://artuplabs-dev.atlassian.net';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDIT_MARK = 'ArtUp Export acceptance edit';
const EDIT_SPACE = 'EXPT';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, space: 'EXPT', preset: 'generic', out: null, previous: null, seed: null, force: false };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i].replace(/^--/, '');
    if (key === 'force') {
      args.force = true;
      continue;
    }
    if (!(key in args) || key === 'command') throw new Error(`unknown argument: ${rest[i]}`);
    args[key] = rest[++i];
  }
  return args;
}

class EditError extends Error {}

function authHeader() {
  const { FORGE_EMAIL: email, FORGE_API_TOKEN: token } = process.env;
  if (!email || !token) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function createRequest(stats) {
  const auth = authHeader();
  return async (path, init = {}) => {
    stats.requests += 1;
    const response = await fetch(`${SITE}${path}`, { ...init, headers: { ...init.headers, Authorization: auth } });
    if (response.status === 429) stats.throttled += 1;
    return response;
  };
}

async function api(method, path, body) {
  const response = await fetch(`${SITE}${path}`, {
    method,
    headers: { Authorization: authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function previousManifestOf(path) {
  if (!path) return null;
  const data = await readFile(resolve(path));
  const text = await readManifestFromFile({ arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  const parsed = text === null ? { ok: false, error: 'no-manifest-in-zip' } : parseManifest(text);
  if (!parsed.ok) throw new Error(`previous zip unusable: ${parsed.error}`);
  return parsed.manifest;
}

function countBy(list, key) {
  const counts = {};
  list.forEach((item) => {
    counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  });
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

async function exportCommand(args) {
  if (!args.out) throw new Error('--out is required');
  const stats = { requests: 0, throttled: 0 };
  const client = createConfluenceClient({ request: createRequest(stats), sleep, concurrency: 6 });
  const previousManifest = await previousManifestOf(args.previous);
  const options = { ...DEFAULT_OPTIONS, preset: args.preset };
  const stages = {};
  const started = performance.now();
  const result = await runExport({
    client,
    target: { kind: 'space', spaceKey: args.space },
    options,
    previousManifest,
    siteUrl: SITE,
    signal: undefined,
    onProgress: (p) => {
      stages[p.stage] ??= performance.now();
    },
    now: new Date(),
  });
  const elapsed = performance.now() - started;
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(resolve(args.out), bytes);
  const phase = (from, to) => (((stages[to] ?? performance.now()) - (stages[from] ?? started)) / 1000).toFixed(1);
  const report = {
    out: args.out,
    fileName: result.fileName,
    mode: result.mode,
    fullReason: result.fullReason,
    seconds: Number((elapsed / 1000).toFixed(1)),
    phases: { scan: phase('scan', 'pages'), pages: phase('pages', 'attachments'), attachments: phase('attachments', 'pack') },
    stats: result.stats,
    zipBytes: bytes.length,
    zipMb: Number((bytes.length / 1024 / 1024).toFixed(2)),
    warnings: result.warnings.length,
    warningsByKind: countBy(result.warnings, 'kind'),
    deletePaths: result.deletePaths,
    requests: stats.requests,
    throttled429: stats.throttled,
  };
  console.log(JSON.stringify(report, null, 2));
}

async function loadSeed(args) {
  const path = resolve(args.seed ?? join(REPO_ROOT, 'data', `seed-${args.space}.json`));
  return JSON.parse(await readFile(path, 'utf8'));
}

async function currentPage(id) {
  try {
    const page = await api('GET', `/wiki/api/v2/pages/${id}?body-format=storage`);
    return page.status === 'current' ? page : null;
  } catch (error) {
    if (/→ 404/.test(error.message)) return null;
    throw error;
  }
}

async function updatePage(page, changes) {
  return api('PUT', `/wiki/api/v2/pages/${page.id}`, {
    id: page.id,
    status: 'current',
    title: changes.title ?? page.title,
    parentId: changes.parentId ?? page.parentId,
    spaceId: page.spaceId,
    body: { representation: 'storage', value: changes.body ?? page.body.storage.value },
    version: { number: page.version.number + 1, message: EDIT_MARK },
  });
}

function pickTargets(seed) {
  const withChildren = new Set(seed.pages.map((p) => p.parentId));
  const withAttachments = new Set(seed.attachments.map((a) => a.pageId));
  const leaves = seed.pages
    .filter((p) => !withChildren.has(p.id) && !withAttachments.has(p.id) && p.depth >= 3)
    .sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
  const [e1, e2, e3, rename, move, remove] = leaves.filter((_, i) => i % 97 === 0);
  const newParent = seed.pages.find((p) => p.depth === 1 && p.id !== move.parentId);
  return { edits: [e1, e2, e3], rename, move, newParent, remove };
}

async function existingPage(target, action) {
  const page = await currentPage(target.id);
  if (!page) {
    throw new EditError(`${action}: page ${target.id} "${target.title}" is not a current page any more (deleted, trashed or no access); nothing was changed. Reseed the space or restore the page from the trash before running edit again.`);
  }
  return page;
}

async function editCommand(args) {
  if (args.space !== EDIT_SPACE && !args.force) {
    throw new EditError(`edit changes and deletes pages; it only runs on the ${EDIT_SPACE} test space. Pass --force to run it on ${args.space}.`);
  }
  const seed = await loadSeed(args);
  if (seed.space !== args.space) throw new EditError(`seed file is for space ${seed.space}, not ${args.space}`);
  const targets = pickTargets(seed);
  const edited = [];
  for (const target of targets.edits) edited.push(await existingPage(target, 'edit-body'));
  const renamed = await existingPage(targets.rename, 'rename');
  const moved = await existingPage(targets.move, 'move');
  await existingPage(targets.newParent, 'move target');
  const removed = await existingPage(targets.remove, 'delete');
  const log = [];
  for (const page of edited) {
    const body = `${page.body.storage.value}<p>${EDIT_MARK}: body changed.</p>`;
    const updated = await updatePage(page, { body });
    log.push({ action: 'edit-body', id: page.id, title: page.title, version: updated.version.number });
  }
  const newTitle = `${renamed.title} renamed`;
  const afterRename = await updatePage(renamed, { title: newTitle });
  log.push({ action: 'rename', id: renamed.id, from: renamed.title, to: newTitle, version: afterRename.version.number });
  const afterMove = await updatePage(moved, { parentId: targets.newParent.id });
  log.push({ action: 'move', id: moved.id, title: moved.title, fromParent: moved.parentId, toParent: afterMove.parentId, toParentTitle: targets.newParent.title });
  await api('DELETE', `/wiki/api/v2/pages/${removed.id}`);
  log.push({ action: 'delete', id: removed.id, title: removed.title });
  console.log(JSON.stringify(log, null, 2));
}

async function main(args) {
  if (args.command === 'full') return exportCommand(args);
  if (args.command === 'update') {
    if (!args.previous) throw new EditError('--previous is required');
    return exportCommand(args);
  }
  if (args.command === 'edit') return editCommand(args);
  console.error('usage: acceptance.mjs full|update|edit --space EXPT [--preset p] [--previous zip] [--out zip] [--seed json] [--force]');
  process.exitCode = 2;
  return undefined;
}

try {
  await main(parseArgs(process.argv.slice(2)));
} catch (error) {
  if (!(error instanceof EditError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
