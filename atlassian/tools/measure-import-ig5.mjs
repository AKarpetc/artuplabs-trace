#!/usr/bin/env node
/**
 * I-G5 feasibility measurement for ArtUp Import (atlassian/24_app4_markdown_import.md §3, §6).
 * Prototype, not product: imports a Markdown folder (an ArtUp Export of EXPT) into a new Confluence
 * space with the REST calls the product would make from Custom UI (here from Node 22 with basic auth),
 * re-exports it with the real ArtUp Export pipeline and compares the Markdown page by page.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/measure-import-ig5.mjs augment --src DIR --dst DIR
 *   node atlassian/tools/measure-import-ig5.mjs import  --src DIR --space IMPT --concurrency 6 [--limit N] [--compare-storage] --out atlassian/data/ig5-import.json
 *   node atlassian/tools/measure-import-ig5.mjs export  --space IMPT --zip atlassian/data/ig5/impt.zip
 *   node atlassian/tools/measure-import-ig5.mjs compare --src DIR --zip FILE --out atlassian/data/ig5-roundtrip.json
 *
 * `import` creates the space when it does not exist and refuses EXPT or any space it did not
 * create (space description must carry the I-G5 marker). Running it again on the same space is the
 * re-import: pages are matched by the source path stored in the page property `artup-import`.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { markdownToStorage, splitFrontMatter } from './ig5/md-to-storage.mjs';
import { unzipSync } from '../../apps/export/static/app/node_modules/fflate/esm/index.mjs';

const SITE = 'https://artuplabs-dev.atlassian.net';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const MARKER = 'ArtUp Import I-G5 prototype';
const PROPERTY = 'artup-import';
const MAX_ATTEMPTS = 8;
const PROTECTED_SPACES = new Set(['EXPT', 'G4TEST3', 'RPT']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, src: null, dst: null, space: null, concurrency: 6, limit: Infinity, out: null, zip: null, compareStorage: false };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i].replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (key === 'compareStorage') {
      args.compareStorage = true;
      continue;
    }
    if (!(key in args) || key === 'command') throw new Error(`unknown argument: ${rest[i]}`);
    const value = rest[++i];
    args[key] = ['concurrency', 'limit'].includes(key) ? Number(value) : value;
  }
  return args;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const seconds = (ms) => Number((ms / 1000).toFixed(1));

function authHeader() {
  const { FORGE_EMAIL: email, FORGE_API_TOKEN: token } = process.env;
  if (!email || !token) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function createPool(concurrency) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= concurrency || queue.length === 0) return;
    const { fn, done, fail } = queue.shift();
    active += 1;
    Promise.resolve().then(fn).then(done, fail).finally(() => {
      active -= 1;
      pump();
    });
  };
  return (fn) => new Promise((done, fail) => {
    queue.push({ fn, done, fail });
    pump();
  });
}

function memorySampler() {
  const peak = { rss: 0, heapUsed: 0 };
  const sample = () => {
    const m = process.memoryUsage();
    peak.rss = Math.max(peak.rss, m.rss);
    peak.heapUsed = Math.max(peak.heapUsed, m.heapUsed);
  };
  const timer = setInterval(sample, 100);
  sample();
  return { stop: () => { clearInterval(timer); sample(); return { peakRssMb: Math.round(peak.rss / 2 ** 20), peakHeapMb: Math.round(peak.heapUsed / 2 ** 20) }; } };
}

function createApi() {
  const auth = authHeader();
  const stats = { requests: 0, byKind: {}, status429: 0, status5xx: 0, retryAfter: [] };
  async function call(kind, method, path, { json, form, expectOk = true } = {}) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      const headers = { Authorization: auth, Accept: 'application/json' };
      let body;
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      }
      if (form) {
        headers['X-Atlassian-Token'] = 'no-check';
        body = await form();
      }
      const response = await fetch(path.startsWith('http') ? path : `${SITE}${path}`, { method, headers, body });
      const elapsed = Date.now() - started;
      stats.requests += 1;
      const k = (stats.byKind[kind] ??= { count: 0, ms: 0, maxMs: 0 });
      k.count += 1;
      k.ms += elapsed;
      k.maxMs = Math.max(k.maxMs, elapsed);
      if (response.status === 429) stats.status429 += 1;
      if (response.status >= 500) stats.status5xx += 1;
      const retriable = response.status === 429 || response.status >= 500;
      if (retriable && attempt < MAX_ATTEMPTS - 1) {
        const header = response.headers.get('retry-after');
        const wait = Number(header) > 0 ? Number(header) : 2 ** attempt;
        stats.retryAfter.push(header);
        await response.arrayBuffer().catch(() => null);
        await sleep(Math.min(30, wait) * 1000 + Math.random() * 300);
        continue;
      }
      const text = await response.text();
      if (!response.ok && expectOk) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
      return { status: response.status, data: text ? JSON.parse(text) : null };
    }
    throw new Error(`unreachable ${path}`);
  }
  return { call, stats };
}

async function walk(root) {
  const out = { files: [], dirs: [] };
  const visit = async (rel) => {
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.dirs.push(path);
        await visit(path);
      } else if (e.isFile()) out.files.push(path);
    }
  };
  await visit('');
  return out;
}

const isMarkdown = (p) => /\.(md|markdown)$/i.test(p);
const INDEX_NAMES = ['index.md', 'README.md', '_index.md'];
const inAssets = (p) => p.split('/').some((part, i, all) => i < all.length - 1 && part.endsWith('.assets'));

function firstHeading(body) {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
}

/** Reads the folder into a tree of page and folder nodes with titles, weights, hashes and attachments. */
async function loadSource(root) {
  const { files, dirs } = await walk(root);
  let manifestFolders = new Map();
  if (files.includes('export-manifest.json')) {
    const manifest = JSON.parse(await readFile(join(root, 'export-manifest.json'), 'utf8'));
    manifestFolders = new Map(manifest.pages.filter((p) => p.type === 'folder').map((p) => [p.path, p]));
  }
  const nodes = new Map();
  const byFile = new Map();
  const byDir = new Map();
  for (const dir of dirs.filter((d) => !d.endsWith('.assets') && !inAssets(`${d}/x`))) {
    const index = INDEX_NAMES.map((n) => `${dir}/${n}`).find((p) => files.includes(p));
    const node = { key: dir, kind: index ? 'page' : 'folder', file: index ?? null, dir, children: [] };
    nodes.set(dir, node);
    byDir.set(dir, node);
    if (index) byFile.set(index, node);
  }
  for (const file of files.filter((f) => isMarkdown(f) && !inAssets(f) && !byFile.has(f))) {
    const node = { key: file, kind: 'page', file, dir: null, children: [] };
    nodes.set(file, node);
    byFile.set(file, node);
  }
  const roots = [];
  for (const node of nodes.values()) {
    const parentDir = posix.dirname(node.dir ?? node.file);
    const parent = parentDir === '.' ? null : byDir.get(parentDir);
    node.parent = parent ?? null;
    (parent ? parent.children : roots).push(node);
  }
  const assetsOf = new Map();
  for (const file of files.filter(inAssets)) {
    const dir = file.split('/').slice(0, -1).join('/');
    const owner = byFile.get(dir.replace(/\.assets$/, '.md')) ?? byFile.get(`${dir.replace(/\.assets$/, '')}.markdown`);
    if (!owner) continue;
    if (!assetsOf.has(owner)) assetsOf.set(owner, []);
    assetsOf.get(owner).push(file);
  }
  for (const node of nodes.values()) {
    if (node.kind === 'folder') {
      const meta = manifestFolders.get(node.dir);
      node.title = meta?.title ?? basename(node.dir);
      node.weight = meta?.weight ?? Infinity;
      node.sha = sha256(node.title);
      continue;
    }
    const raw = await readFile(join(root, node.file));
    const { data, body } = splitFrontMatter(raw.toString('utf8'));
    node.title = data.title || firstHeading(body) || basename(node.file).replace(/\.(md|markdown)$/i, '');
    node.weight = Number.isFinite(data.weight) ? data.weight : Infinity;
    node.labels = Array.isArray(data.labels) ? data.labels : [];
    node.body = body;
    node.sha = sha256(raw);
    node.attachments = [];
    for (const file of assetsOf.get(node) ?? []) {
      const bytes = await readFile(join(root, file));
      node.attachments.push({ file, name: basename(file), sha: sha256(bytes), bytes: bytes.length });
    }
  }
  const sortKids = (list) => {
    list.sort((a, b) => a.weight - b.weight || (a.key < b.key ? -1 : 1));
    list.forEach((n) => sortKids(n.children));
  };
  sortKids(roots);
  return { nodes, roots, byFile, byDir, files: new Set(files) };
}

function splitHref(href) {
  const hash = href.indexOf('#');
  const path = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash + 1) : '';
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch { /* keep raw */ }
  return { path: decoded, anchor };
}

/** Link and image resolution for one page; records images outside .assets as extra attachments of the page. */
function makeContext(source, node, extras) {
  const from = posix.dirname(node.file);
  const local = (href) => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') && !href.startsWith('#');
  const ownerOf = (target) => {
    const dir = posix.dirname(target);
    if (!dir.endsWith('.assets')) return null;
    return source.byFile.get(dir.replace(/\.assets$/, '.md')) ?? null;
  };
  return {
    resolveLink(href) {
      if (!href || !local(href)) return null;
      const { path, anchor } = splitHref(href);
      if (!path) return null;
      const target = posix.normalize(posix.join(from, path)).replace(/\/$/, '');
      const page = source.byFile.get(target) ?? source.byDir.get(target);
      if (page && page.kind === 'page') return { kind: 'page', title: page.title, anchor };
      if (source.files.has(target)) {
        const owner = ownerOf(target);
        if (owner) return { kind: 'attachment', filename: basename(target), ownerTitle: owner === node ? null : owner.title };
      }
      return null;
    },
    resolveImage(src) {
      if (!src || !local(src)) return null;
      const target = posix.normalize(posix.join(from, splitHref(src).path));
      if (!source.files.has(target)) return null;
      const owner = ownerOf(target);
      if (owner) return { filename: basename(target), ownerTitle: owner === node ? null : owner.title };
      extras.add(target);
      return { filename: basename(target), ownerTitle: null };
    },
  };
}

function convertNode(source, node) {
  const extras = new Set();
  const storage = markdownToStorage(node.body, makeContext(source, node, extras));
  return { storage, extras: [...extras] };
}

function propertyValue(node, attachments) {
  return {
    path: node.file ?? node.dir,
    sha: node.sha,
    attachments: Object.fromEntries(attachments.map((a) => [a.name, a.sha])),
  };
}

async function ensureSpace(api, key) {
  if (PROTECTED_SPACES.has(key)) throw new Error(`refusing to import into ${key}`);
  const found = (await api.call('space', 'GET', `/wiki/api/v2/spaces?keys=${key}&description-format=plain`)).data.results?.[0];
  if (found) {
    if (!String(found.description?.plain?.value ?? '').includes(MARKER)) throw new Error(`space ${key} exists and was not created by this tool`);
    return { space: found, created: false };
  }
  await api.call('space', 'POST', '/wiki/api/v2/spaces', { json: { key, name: `Import test ${key}`, description: { value: MARKER, representation: 'plain' } } });
  for (let i = 0; i < 20; i += 1) {
    const space = (await api.call('space', 'GET', `/wiki/api/v2/spaces?keys=${key}`)).data.results?.[0];
    if (space?.homepageId) return { space, created: true };
    await sleep(1000);
  }
  throw new Error(`space ${key} has no homepage`);
}

/** Existing mapping path → { id, version, value } from the page property, read in bulk with v1 expand. */
async function readMapping(api, key) {
  const mapping = new Map();
  const pages = [];
  let next = `/wiki/rest/api/content?spaceKey=${key}&type=page&limit=200&expand=version,metadata.properties.${PROPERTY}`;
  let calls = 0;
  while (next) {
    const { data } = await api.call('read-mapping', 'GET', next);
    calls += 1;
    for (const page of data.results ?? []) {
      pages.push(page);
      const value = page.metadata?.properties?.[PROPERTY]?.value;
      if (value?.path) mapping.set(value.path, { id: page.id, kind: 'page', version: page.version.number, value, propertyVersion: page.metadata.properties[PROPERTY].version.number });
    }
    next = data._links?.next ? `/wiki${data._links.next.replace(/^\/wiki/, '')}` : null;
  }
  const folders = (await api.call('read-mapping', 'GET', `/wiki/rest/api/search?cql=${encodeURIComponent(`space="${key}" and type=folder`)}&limit=200`)).data;
  calls += 1;
  for (const hit of folders.results ?? []) {
    const id = hit.content?.id;
    if (!id) continue;
    const props = (await api.call('read-mapping', 'GET', `/wiki/api/v2/folders/${id}/properties?key=${PROPERTY}`)).data.results ?? [];
    calls += 1;
    if (props[0]?.value?.path) mapping.set(props[0].value.path, { id, kind: 'folder', value: props[0].value, propertyVersion: props[0].version.number });
  }
  return { mapping, pagesInSpace: pages.length, calls };
}

function attachmentsForm(root, list) {
  return async () => {
    const form = new FormData();
    for (const a of list) {
      form.append('file', new Blob([await readFile(join(root, a.file))]), a.name);
      form.append('minorEdit', 'true');
    }
    return form;
  };
}

async function importCommand(args) {
  if (!args.src || !args.space || !args.out) throw new Error('--src, --space and --out are required');
  const root = resolve(args.src);
  const memory = memorySampler();
  const api = createApi();
  const t0 = Date.now();
  const source = await loadSource(root);
  const tLoad = Date.now();
  const order = [];
  const queue = [...source.roots];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    queue.push(...n.children);
  }
  const kept = new Set(order.slice(0, args.limit));
  const { space, created: spaceCreated } = await ensureSpace(api, args.space);
  const tSpace = Date.now();
  const { mapping, pagesInSpace, calls: mappingCalls } = await readMapping(api, args.space);
  const tMapping = Date.now();
  const homepageRoot = source.roots.length === 1 && source.roots[0].kind === 'page' ? source.roots[0] : null;
  const pool = createPool(args.concurrency);
  const result = { created: 0, updated: 0, unchanged: 0, foldersCreated: 0, attachmentsUploaded: 0, attachmentBytes: 0, labelsAdded: 0, errors: [] };
  const sideTasks = [];
  const side = (label, fn) => sideTasks.push(pool(fn).catch((error) => result.errors.push({ task: label, error: String(error.message).slice(0, 300) })));
  const ids = new Map();
  let convertMs = 0;

  const writeFolderProperty = (id, node) => api.call('property', 'POST', `/wiki/api/v2/folders/${id}/properties`, { json: { key: PROPERTY, value: propertyValue(node, []) } });

  const processNode = async (node, parentId) => {
    const existing = mapping.get(node.file ?? node.dir) ?? (node === homepageRoot ? { id: space.homepageId, kind: 'page', home: true } : null);
    if (node.kind === 'folder') {
      if (existing) {
        result.unchanged += 1;
        return existing.id;
      }
      const folder = (await api.call('create-folder', 'POST', '/wiki/api/v2/folders', { json: { spaceId: space.id, title: node.title, parentId } })).data;
      result.foldersCreated += 1;
      side(`property ${node.dir}`, () => writeFolderProperty(folder.id, node));
      return folder.id;
    }
    const c0 = Date.now();
    const { storage, extras } = convertNode(source, node);
    convertMs += Date.now() - c0;
    const attachments = [...node.attachments];
    for (const file of extras) {
      if (!attachments.some((a) => a.name === basename(file))) {
        const bytes = await readFile(join(root, file));
        attachments.push({ file, name: basename(file), sha: sha256(bytes), bytes: bytes.length });
      }
    }
    const sameAttachments = existing?.value && JSON.stringify(existing.value.attachments) === JSON.stringify(propertyValue(node, attachments).attachments);
    if (existing?.value && existing.value.sha === node.sha && sameAttachments) {
      result.unchanged += 1;
      return existing.id;
    }
    let id;
    let changedAttachments = attachments;
    if (existing) {
      const current = (await api.call('get-page', 'GET', `/wiki/api/v2/pages/${existing.id}`)).data;
      await api.call('update-page', 'PUT', `/wiki/api/v2/pages/${existing.id}`, {
        json: { id: existing.id, status: 'current', title: node.title, spaceId: space.id, ...(existing.home ? {} : { parentId }), body: { representation: 'storage', value: storage }, version: { number: current.version.number + 1, message: 'ArtUp Import' } },
      });
      id = existing.id;
      result.updated += 1;
      const before = existing.value?.attachments ?? {};
      changedAttachments = attachments.filter((a) => before[a.name] !== a.sha);
    } else {
      const page = (await api.call('create-page', 'POST', '/wiki/api/v2/pages', {
        json: { spaceId: space.id, status: 'current', title: node.title, parentId, body: { representation: 'storage', value: storage } },
      })).data;
      id = page.id;
      result.created += 1;
    }
    if (changedAttachments.length) {
      side(`attachments ${node.file}`, async () => {
        const method = existing ? 'PUT' : 'POST';
        for (let i = 0; i < changedAttachments.length; i += 4) {
          const batch = changedAttachments.slice(i, i + 4);
          await api.call('attachments', method, `/wiki/rest/api/content/${id}/child/attachment`, { form: attachmentsForm(root, batch) });
          result.attachmentsUploaded += batch.length;
          result.attachmentBytes += batch.reduce((s, a) => s + a.bytes, 0);
        }
      });
    }
    if (!existing && node.labels.length) {
      side(`labels ${node.file}`, async () => {
        await api.call('labels', 'POST', `/wiki/rest/api/content/${id}/label`, { json: node.labels.map((name) => ({ prefix: 'global', name })) });
        result.labelsAdded += node.labels.length;
      });
    }
    side(`property ${node.file}`, async () => {
      if (existing?.value) {
        const props = (await api.call('property', 'GET', `/wiki/api/v2/pages/${id}/properties?key=${PROPERTY}`)).data.results?.[0];
        await api.call('property', 'PUT', `/wiki/api/v2/pages/${id}/properties/${props.id}`, { json: { key: PROPERTY, value: propertyValue(node, attachments), version: { number: props.version.number + 1 } } });
      } else {
        await api.call('property', 'POST', `/wiki/api/v2/pages/${id}/properties`, { json: { key: PROPERTY, value: propertyValue(node, attachments) } });
      }
    });
    return id;
  };

  const subtree = async (node, parentId) => {
    const kids = node.children.filter((c) => kept.has(c));
    const branches = [];
    for (const child of kids) {
      try {
        const id = await pool(() => processNode(child, parentId));
        ids.set(child, id);
        branches.push(subtree(child, id));
      } catch (error) {
        result.errors.push({ path: child.file ?? child.dir, error: String(error.message).slice(0, 300) });
      }
    }
    await Promise.all(branches);
  };
  const tImport = Date.now();
  await subtree({ children: source.roots }, space.homepageId);
  const tTree = Date.now();
  await Promise.all(sideTasks);
  const tDone = Date.now();

  let storageComparison = null;
  if (args.compareStorage) storageComparison = await compareStorage(api, source, mapping, kept);

  const pagesInSource = [...source.nodes.values()].filter((n) => n.kind === 'page' && kept.has(n)).length;
  const report = {
    measuredAt: new Date().toISOString(),
    command: 'import',
    src: args.src,
    space: { key: args.space, id: space.id, homepageId: space.homepageId, created: spaceCreated },
    concurrency: args.concurrency,
    source: {
      pages: pagesInSource,
      folders: [...source.nodes.values()].filter((n) => n.kind === 'folder' && kept.has(n)).length,
      attachments: [...source.nodes.values()].filter((n) => kept.has(n)).reduce((s, n) => s + (n.attachments?.length ?? 0), 0),
      attachmentMb: Number(([...source.nodes.values()].filter((n) => kept.has(n)).reduce((s, n) => s + (n.attachments ?? []).reduce((x, a) => x + a.bytes, 0), 0) / 2 ** 20).toFixed(1)),
      pagesWithAttachments: [...source.nodes.values()].filter((n) => kept.has(n) && n.attachments?.length).length,
    },
    existingMapping: { pagesInSpace, mappedPaths: mapping.size, readCalls: mappingCalls, seconds: seconds(tMapping - tSpace) },
    result,
    timing: {
      totalSeconds: seconds(tDone - t0),
      loadSourceSeconds: seconds(tLoad - t0),
      spaceSeconds: seconds(tSpace - tLoad),
      pagesTreeSeconds: seconds(tTree - tImport),
      tailSeconds: seconds(tDone - tTree),
      importSeconds: seconds(tDone - tImport),
      convertSecondsTotal: seconds(convertMs),
    },
    requests: { total: api.stats.requests, status429: api.stats.status429, status5xx: api.stats.status5xx, retryAfterValues: [...new Set(api.stats.retryAfter)], byKind: Object.fromEntries(Object.entries(api.stats.byKind).map(([k, v]) => [k, { count: v.count, avgMs: Math.round(v.ms / v.count), maxMs: v.maxMs }])) },
    storageComparison,
    memory: memory.stop(),
  };
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(resolve(args.out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, requests: { ...report.requests, byKind: undefined } }, null, 2));
}


/** What a re-import would have to update if it compared converted storage with Confluence's stored body instead of hashes. */
async function compareStorage(api, source, mapping, kept) {
  const pairs = [...source.nodes.values()].filter((n) => n.kind === 'page' && kept.has(n) && mapping.has(n.file)).map((n) => [n, mapping.get(n.file).id]);
  const stored = new Map();
  for (let i = 0; i < pairs.length; i += 250) {
    const chunk = pairs.slice(i, i + 250).map(([, id]) => id);
    let next = `/wiki/api/v2/pages?id=${chunk.join(',')}&limit=250&body-format=storage`;
    while (next) {
      const { data } = await api.call('read-bodies', 'GET', next);
      for (const p of data.results ?? []) stored.set(String(p.id), p.body?.storage?.value ?? '');
      next = data._links?.next ? `/wiki${data._links.next.replace(/^\/wiki/, '')}` : null;
    }
  }
  let exact = 0;
  let normalized = 0;
  const examples = [];
  const norm = (s) => s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  for (const [node, id] of pairs) {
    const { storage } = convertNode(source, node);
    const have = stored.get(String(id)) ?? '';
    if (have === storage) exact += 1;
    if (norm(have) === norm(storage)) normalized += 1;
    else if (examples.length < 3) {
      const a = norm(storage);
      const b = norm(have);
      let k = 0;
      while (k < a.length && a[k] === b[k]) k += 1;
      examples.push({ path: node.file, converted: a.slice(Math.max(0, k - 60), k + 120), stored: b.slice(Math.max(0, k - 60), k + 120) });
    }
  }
  return { pages: pairs.length, identicalExact: exact, identicalAfterWhitespace: normalized, examples };
}

/** Copies the export and gives every page one inline picture (random-noise PNG, 10–300 KB) in its .assets folder. */
async function augmentCommand(args) {
  if (!args.src || !args.dst) throw new Error('--src and --dst are required');
  const src = resolve(args.src);
  const dst = resolve(args.dst);
  await cp(src, dst, { recursive: true });
  const { files } = await walk(dst);
  let pictures = 0;
  let bytes = 0;
  for (const file of files.filter((f) => isMarkdown(f) && !inAssets(f))) {
    const assets = file.replace(/\.md$/, '.assets');
    await mkdir(join(dst, assets), { recursive: true });
    const side = 56 + Math.floor(Math.random() * 260);
    const png = noisePng(side, side);
    await writeFile(join(dst, assets, 'diagram.png'), png);
    const text = await readFile(join(dst, file), 'utf8');
    await writeFile(join(dst, file), `${text.replace(/\n*$/, '')}\n\n![diagram](${basename(assets)}/diagram.png)\n`);
    pictures += 1;
    bytes += png.length;
  }
  console.log(JSON.stringify({ dst: args.dst, pictures, megabytes: Number((bytes / 2 ** 20).toFixed(1)) }));
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function noisePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) randomBytes(width * 3).copy(raw, y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function exportCommand(args) {
  if (!args.space || !args.zip) throw new Error('--space and --zip are required');
  const started = Date.now();
  const child = spawn(process.execPath, [join(REPO_ROOT, 'apps/export/scripts/acceptance.mjs'), 'full', '--space', args.space, '--out', resolve(args.zip)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const code = await new Promise((done) => child.on('close', done));
  if (code !== 0) throw new Error(`export failed with ${code}`);
  console.log(out.trim());
  console.log(JSON.stringify({ exportSeconds: seconds(Date.now() - started) }));
}

const VOLATILE = new Set(['confluence_id', 'space', 'parent_id', 'version', 'author', 'updated', 'confluence_url']);

function stableFrontMatter(text) {
  const { data, body } = splitFrontMatter(text);
  const stable = Object.fromEntries(Object.entries(data).filter(([k]) => !VOLATILE.has(k)));
  return { stable, body, data };
}

function lineDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = [];
  let i = 0;
  let j = 0;
  let cur = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      (cur ??= { removed: [], added: [] }).added.push(b[j]);
      j += 1;
    } else {
      (cur ??= { removed: [], added: [] }).removed.push(a[i]);
      i += 1;
    }
  }
  flush();
  return hunks;
}

function classify(hunk) {
  const text = [...hunk.removed, ...hunk.added].join('\n');
  const strip = (lines) => lines.join('\n').replace(/\]\([^)]*\)/g, '](…)');
  if (hunk.removed.length && hunk.added.length && strip(hunk.removed) === strip(hunk.added)) {
    return /\.md[#)]/.test(text) ? 'ссылка на страницу: другой путь' : /\.assets\//.test(text) ? 'путь вложения' : 'адрес ссылки';
  }
  if (hunk.removed.join('').replace(/\s+/g, '') === hunk.added.join('').replace(/\s+/g, '')) return 'пробелы/переносы';
  if (/!\[/.test(text)) return 'картинка';
  if (/^\s*\|/m.test(text) || /<\/?t[drh]|<table/.test(text)) return 'таблица';
  if (/```/.test(text)) return 'блок кода';
  if (/\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]/.test(text)) return 'панель';
  if (/<\/?details|<summary/.test(text)) return 'expand';
  if (/^\s*- \[[ x]\]/m.test(text)) return 'чек-лист';
  if (/confluence:/.test(text)) return 'макрос-заглушка';
  if (/^\s*([-*]|\d+\.)\s/m.test(text)) return 'список';
  if (/^#{1,6}\s/m.test(text)) return 'заголовок';
  if (/\]\(/.test(text)) return 'ссылка (текст)';
  return 'прочее';
}

function relativeTo(fromFile, toFile) {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
}

/** Rewrites in-export link targets of a source page to where the same pages (matched by title) sit in the re-export. */
function remapLinks(src, srcPages, outOf) {
  const outSelf = outOf(src);
  if (!outSelf) return src.body;
  return src.body.replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return whole;
    const hash = href.indexOf('#');
    const path = hash >= 0 ? href.slice(0, hash) : href;
    const anchor = hash >= 0 ? href.slice(hash) : '';
    const target = posix.normalize(posix.join(posix.dirname(src.path), path));
    if (target.endsWith('.md')) {
      const out = srcPages.get(target) ? outOf(srcPages.get(target)) : null;
      return out ? `](${relativeTo(outSelf.path, out.path)}${anchor})` : whole;
    }
    const assetDir = posix.dirname(target);
    if (assetDir.endsWith('.assets')) {
      const owner = srcPages.get(assetDir.replace(/\.assets$/, '.md'));
      const out = owner ? outOf(owner) : null;
      return out ? `](${relativeTo(outSelf.path, `${out.path.replace(/\.md$/, '.assets')}/${basename(target)}`)}${anchor})` : whole;
    }
    return whole;
  });
}

async function compareCommand(args) {
  if (!args.src || !args.zip || !args.out) throw new Error('--src, --zip and --out are required');
  const root = resolve(args.src);
  const { files } = await walk(root);
  const zipped = unzipSync(new Uint8Array(await readFile(resolve(args.zip))));
  const decoder = new TextDecoder();
  const srcPages = new Map();
  for (const f of files.filter((x) => isMarkdown(x) && !inAssets(x))) {
    const text = await readFile(join(root, f), 'utf8');
    srcPages.set(f, { path: f, text, ...stableFrontMatter(text) });
  }
  const outPages = new Map();
  for (const [name, bytes] of Object.entries(zipped)) {
    if (!isMarkdown(name)) continue;
    const text = decoder.decode(bytes);
    outPages.set(name, { path: name, text, ...stableFrontMatter(text) });
  }
  const outByTitle = new Map([...outPages.values()].map((p) => [p.data.title, p]));
  const outOf = (src) => outByTitle.get(src.data.title) ?? outPages.get(src.path) ?? null;
  const srcAssets = files.filter(inAssets);
  const outAssets = new Map(Object.entries(zipped).filter(([n]) => inAssets(n)).map(([n, b]) => [n, sha256(b)]));
  const kinds = new Map();
  const counts = { samePath: 0, identical: 0, identicalWs: 0, bodyIdentical: 0, fmStable: 0, identicalModuloPaths: 0, identicalModuloPathsWs: 0, missing: 0 };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (const src of srcPages.values()) {
    const out = outOf(src);
    if (!out) {
      counts.missing += 1;
      continue;
    }
    if (out.path === src.path) counts.samePath += 1;
    const fmSame = JSON.stringify(src.stable) === JSON.stringify(out.stable);
    const remapped = remapLinks(src, srcPages, outOf);
    if (fmSame) counts.fmStable += 1;
    if (src.body === out.body) counts.bodyIdentical += 1;
    if (fmSame && src.body === out.body) counts.identical += 1;
    if (fmSame && norm(src.body) === norm(out.body)) counts.identicalWs += 1;
    if (fmSame && remapped === out.body) counts.identicalModuloPaths += 1;
    if (fmSame && norm(remapped) === norm(out.body)) counts.identicalModuloPathsWs += 1;
    const pageKinds = new Map();
    if (out.path !== src.path) pageKinds.set('путь файла страницы', { removed: [src.path], added: [out.path] });
    if (!fmSame) {
      for (const key of new Set([...Object.keys(src.stable), ...Object.keys(out.stable)])) {
        if (JSON.stringify(src.stable[key]) !== JSON.stringify(out.stable[key])) pageKinds.set(`front matter: ${key}`, { removed: [`${key}: ${JSON.stringify(src.stable[key])}`], added: [`${key}: ${JSON.stringify(out.stable[key])}`] });
      }
    }
    if (src.body !== out.body) {
      for (const hunk of lineDiff(src.body.split('\n'), out.body.split('\n'))) {
        const kind = classify(hunk);
        if (!pageKinds.has(kind)) pageKinds.set(kind, hunk);
      }
    }
    for (const [kind, hunk] of pageKinds) {
      const entry = kinds.get(kind) ?? { kind, pages: 0, example: null };
      entry.pages += 1;
      entry.example ??= { source: src.path, reexport: out.path, before: hunk.removed.slice(0, 4), after: hunk.added.slice(0, 4) };
      kinds.set(kind, entry);
    }
  }
  let assetsMatched = 0;
  for (const f of srcAssets) {
    const want = sha256(await readFile(join(root, f)));
    const srcPage = srcPages.get(f.split('/').slice(0, -1).join('/').replace(/\.assets$/, '.md'));
    const outPage = srcPage ? outOf(srcPage) : null;
    if (outPage && outAssets.get(`${outPage.path.replace(/\.md$/, '.assets')}/${basename(f)}`) === want) assetsMatched += 1;
  }
  const total = srcPages.size;
  const share = (x) => ({ count: x, pct: Number(((x / total) * 100).toFixed(1)) });
  const report = {
    measuredAt: new Date().toISOString(),
    command: 'compare',
    src: args.src,
    zip: args.zip,
    rule: 'страницы сопоставлены по title; «идентично» = тело + устойчивые поля front matter (title, weight, labels) байт-в-байт; confluence_id, space, parent_id, version, author, updated, confluence_url отброшены (их меняет сам факт новой страницы)',
    pages: { source: total, reexport: outPages.size, missingInReexport: counts.missing },
    identical: share(counts.identical),
    identicalAfterWhitespace: share(counts.identicalWs),
    identicalModuloPaths: share(counts.identicalModuloPaths),
    identicalModuloPathsAfterWhitespace: share(counts.identicalModuloPathsWs),
    bodyIdentical: share(counts.bodyIdentical),
    frontMatterStableIdentical: share(counts.fmStable),
    samePath: share(counts.samePath),
    attachments: { source: srcAssets.length, sameBytesNextToSamePage: assetsMatched },
    divergenceKinds: [...kinds.values()].sort((a, b) => b.pages - a.pages),
  };
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(resolve(args.out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, divergenceKinds: report.divergenceKinds.slice(0, 12) }, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const commands = { import: importCommand, augment: augmentCommand, export: exportCommand, compare: compareCommand };
if (!commands[args.command]) {
  console.error('usage: measure-import-ig5.mjs import|augment|export|compare …');
  process.exitCode = 2;
} else {
  await commands[args.command](args);
}
