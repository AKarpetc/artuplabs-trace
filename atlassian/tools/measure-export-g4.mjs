#!/usr/bin/env node
/**
 * G4 feasibility measurements for ArtUp Export (atlassian/20_app2_markdown_export.md §3,
 * §6; task-0-brief.md Task 0.2 Step 4, ruling R4). Runs the Confluence REST calls that a
 * browser Custom UI would make, but from Node 22 with global fetch and basic auth, against
 * the seeded EXPT space. Item 7 (parse + zip) uses htmlparser2 and fflate from the scratch
 * dependency install in atlassian/tools/g4/.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/measure-export-g4.mjs --space EXPT
 *
 * Writes atlassian/data/g4-measurements.json with every measured number.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from './g4/node_modules/fflate/esm/index.mjs';
import { parseDocument } from './g4/node_modules/htmlparser2/lib/esm/index.js';

const SITE = 'https://artuplabs-dev.atlassian.net';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const MAX_ATTEMPTS = 6;

function parseArgs(argv) {
  const args = { space: 'EXPT' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--space') args.space = argv[++i];
  }
  return args;
}

function authHeader() {
  const email = process.env.FORGE_EMAIL;
  const token = process.env.FORGE_API_TOKEN;
  if (!email || !token) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPool(concurrency) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

const rateLimitEvents = [];

async function requestRaw(path, { retry = true } = {}) {
  const url = path.startsWith('http') ? path : `${SITE}${path}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    const response = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
    if (response.ok || !retry) return { response, elapsedMs: Date.now() - started };
    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS - 1) return { response, elapsedMs: Date.now() - started };
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfter = Number(retryAfterHeader);
    const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
    rateLimitEvents.push({ path, status: response.status, retryAfterHeader, waitS, attempt });
    await sleep(Math.min(30, waitS) * 1000);
  }
  throw new Error(`unreachable: ${path}`);
}

async function getJson(path) {
  const { response } = await requestRaw(path);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
  return response.json();
}

async function paginate(path) {
  const results = [];
  let calls = 0;
  for (let next = path; next;) {
    const page = await getJson(next);
    calls += 1;
    results.push(...(page.results ?? []));
    next = page._links?.next ?? null;
  }
  return { results, calls };
}

function chunk(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}

/** Concurrent BFS over listChildren: schedules a children-fetch per discovered node
 * through a bounded pool, the way the real export pipeline (Task 9 pool.js) would. */
function bfsWithPool(rootId, concurrency) {
  return new Promise((resolve, reject) => {
    const pool = createPool(concurrency);
    let calls = 0;
    let pagesVisited = 1;
    let pending = 0;
    let started = false;
    const positionsByParent = new Map();
    const settle = () => {
      if (started && pending === 0) resolve({ calls, pagesVisited, positionsByParent });
    };
    const visit = (parentId) => {
      pending += 1;
      pool(() => paginate(`/wiki/api/v2/pages/${parentId}/children?limit=250`))
        .then(({ results, calls: c }) => {
          calls += c;
          positionsByParent.set(parentId, results.map((r) => r.childPosition));
          pagesVisited += results.length;
          for (const child of results) visit(child.id);
        })
        .catch(reject)
        .finally(() => {
          pending -= 1;
          settle();
        });
    };
    visit(rootId);
    started = true;
    settle();
  });
}

async function measureTreeScan(rootId, allPageIds, concurrency = 6) {
  const start = Date.now();
  const { calls, pagesVisited, positionsByParent } = await bfsWithPool(rootId, concurrency);
  const sortedEverywhere = [...positionsByParent.values()].every(
    (positions) => positions.every((p, i) => i === 0 || positions[i - 1] <= p),
  );
  const elapsedMs = Date.now() - start;

  const depthRootStart = Date.now();
  const depthRoot = await getJson(`/wiki/api/v2/spaces/${(await getJson(`/wiki/api/v2/pages/${rootId}`)).spaceId}/pages?depth=root&limit=25`);
  const depthRootElapsedMs = Date.now() - depthRootStart;

  const sampleIds = allPageIds.slice(0, 5);
  const sampleBatch = await getJson(`/wiki/api/v2/pages?id=${sampleIds.join(',')}&limit=25`);
  const hasPositionField = (sampleBatch.results ?? []).every((p) => typeof p.position === 'number');

  return {
    pagesVisited,
    apiCalls: calls,
    concurrency,
    elapsedMs,
    childPositionSortedWithinEveryParent: sortedEverywhere,
    depthRootReturns: (depthRoot.results ?? []).map((r) => ({ id: r.id, title: r.title, parentId: r.parentId })),
    depthRootElapsedMs,
    v2PageObjectHasPositionField: hasPositionField,
  };
}

async function measureBatchBodies(allPageIds) {
  const batches = chunk(allPageIds, 250);
  const start = Date.now();
  let totalBytes = 0;
  const bodies = new Map();
  for (const batch of batches) {
    const page = await getJson(`/wiki/api/v2/pages?id=${batch.join(',')}&limit=250&body-format=storage`);
    const results = page.results ?? [];
    totalBytes += Buffer.byteLength(JSON.stringify(page));
    for (const p of results) bodies.set(String(p.id), p.body?.storage?.value ?? '');
    if (page._links?.next) {
      let next = page._links.next;
      while (next) {
        const more = await getJson(next);
        totalBytes += Buffer.byteLength(JSON.stringify(more));
        for (const p of more.results ?? []) bodies.set(String(p.id), p.body?.storage?.value ?? '');
        next = more._links?.next ?? null;
      }
    }
  }
  const elapsedMs = Date.now() - start;
  return { pagesRequested: allPageIds.length, batches: batches.length, pagesReturned: bodies.size, elapsedMs, totalResponseBytes: totalBytes, bodies };
}

async function measureAttachments(seedAttachments) {
  const byPage = new Map();
  for (const a of seedAttachments) {
    if (!byPage.has(a.pageId)) byPage.set(a.pageId, []);
    byPage.get(a.pageId).push(a);
  }
  const pool = createPool(6);
  const start = Date.now();
  let listCalls = 0;
  let downloadCalls = 0;
  let totalBytes = 0;
  let exactByteMatches = 0;
  let mismatches = [];

  await Promise.all([...byPage.keys()].map((pageId) => pool(async () => {
    const listing = await getJson(`/wiki/api/v2/pages/${pageId}/attachments?limit=250`);
    listCalls += 1;
    for (const att of listing.results ?? []) {
      const expected = byPage.get(pageId).find((s) => s.title === att.title);
      if (!expected) continue;
      const { response } = await requestRaw(`/wiki${att.downloadLink}`);
      downloadCalls += 1;
      if (!response.ok) {
        mismatches.push({ pageId, title: att.title, error: `HTTP ${response.status}` });
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes += bytes.length;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length === expected.bytes && sha256 === expected.sha256) exactByteMatches += 1;
      else mismatches.push({ pageId, title: att.title, expectedBytes: expected.bytes, gotBytes: bytes.length, sha256Match: sha256 === expected.sha256 });
    }
  })));

  const elapsedMs = Date.now() - start;
  return {
    pagesWithAttachments: byPage.size,
    attachmentsExpected: seedAttachments.length,
    listCalls,
    downloadCalls,
    totalBytesDownloaded: totalBytes,
    exactByteMatches,
    mismatches,
    elapsedMs,
  };
}

async function measureUsers(sampleAccountId) {
  const counts = [1, 50, 100, 150, 200, 250, 300];
  const outcomes = [];
  for (const n of counts) {
    const params = Array.from({ length: n }, () => `accountId=${encodeURIComponent(sampleAccountId)}`).join('&');
    const { response, elapsedMs } = await requestRaw(`/wiki/rest/api/user/bulk?${params}`, { retry: false });
    outcomes.push({ requestedIds: n, status: response.status, ok: response.ok, elapsedMs });
    if (!response.ok) break;
  }
  return { sampleAccountId, outcomes };
}

async function measureSearch(spaceKey) {
  const start = Date.now();
  const cql = `type=page AND space="${spaceKey}" AND title~"caf*"`;
  const { response } = await requestRaw(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=20`);
  const elapsedMs = Date.now() - start;
  const body = response.ok ? await response.json() : null;
  return {
    ok: response.ok,
    status: response.status,
    elapsedMs,
    resultCount: body?.results?.length ?? null,
    titles: (body?.results ?? []).map((r) => r.content?.title ?? r.title),
  };
}

async function measureRateLimiting(sampleIds) {
  const outcomes = {};
  for (const concurrency of [4, 6, 8]) {
    const pool = createPool(concurrency);
    const before = rateLimitEvents.length;
    const start = Date.now();
    await Promise.all(sampleIds.map((id) => pool(() => getJson(`/wiki/api/v2/pages/${id}/children?limit=250`).catch(() => null))));
    const elapsedMs = Date.now() - start;
    const events = rateLimitEvents.slice(before);
    outcomes[concurrency] = {
      requests: sampleIds.length,
      elapsedMs,
      status429Count: events.filter((e) => e.status === 429).length,
      retryAfterValuesSeen: events.map((e) => e.retryAfterHeader),
    };
  }
  return outcomes;
}

function measureZip(bodiesById, pagesMeta, seedAttachments) {
  const start = Date.now();
  let peakHeap = process.memoryUsage().heapUsed;
  let peakRss = process.memoryUsage().rss;
  const sampleTrack = () => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
    if (mem.rss > peakRss) peakRss = mem.rss;
  };

  let parseErrors = 0;
  for (const [, html] of bodiesById) {
    try {
      parseDocument(html, { xmlMode: true, recognizeCDATA: true, recognizeSelfClosing: true, decodeEntities: true, lowerCaseTags: true });
    } catch {
      parseErrors += 1;
    }
    sampleTrack();
  }
  const parseElapsedMs = Date.now() - start;

  const zipStart = Date.now();
  const parts = [];
  let totalZipBytes = 0;
  let finished = false;
  const zip = new Zip((error, chunkData, final) => {
    if (error) throw error;
    parts.push(chunkData);
    totalZipBytes += chunkData.length;
    if (final) finished = true;
  });

  const titleById = new Map(pagesMeta.map((p) => [p.id, p]));
  let index = 0;
  for (const [id, html] of bodiesById) {
    const meta = titleById.get(id);
    const path = `pages/${meta ? meta.depth : 'x'}-${id}.md`;
    const file = new ZipDeflate(path, { level: 6 });
    zip.add(file);
    file.push(strToU8(`<!-- storage length ${html.length} -->\n${html}`), true);
    index += 1;
    if (index % 200 === 0) sampleTrack();
  }
  for (const att of seedAttachments) {
    const bytes = Buffer.alloc(att.bytes === 68 ? 68 : att.bytes, 7);
    const file = new ZipPassThrough(`attachments/${att.id}-${att.title}`);
    zip.add(file);
    file.push(bytes, true);
  }
  zip.end();
  sampleTrack();
  const zipElapsedMs = Date.now() - zipStart;

  return {
    parseElapsedMs,
    parseErrors,
    zipElapsedMs,
    totalElapsedMs: Date.now() - start,
    finalZipBytes: totalZipBytes,
    zipFinishedSynchronously: finished,
    peakHeapUsedBytes: peakHeap,
    peakRssBytes: peakRss,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedPath = join(REPO_ROOT, 'atlassian', 'data', `seed-${args.space}.json`);
  const seed = JSON.parse(await readFile(seedPath, 'utf8'));
  const rootPage = seed.pages.find((p) => p.depth === 0);
  const allPageIds = seed.pages.map((p) => p.id);

  process.stdout.write(`loaded seed: ${seed.pages.length} pages, ${seed.attachments.length} attachments, root=${rootPage.id}\n`);

  process.stdout.write('1. tree scan (BFS via children, and depth=root)...\n');
  const treeScan = await measureTreeScan(rootPage.id, allPageIds);
  process.stdout.write(`   ${JSON.stringify(treeScan, (k, v) => (k === 'depthRootReturns' ? v : v), 2).slice(0, 400)}\n`);

  process.stdout.write('2. batch bodies...\n');
  const batchBodies = await measureBatchBodies(allPageIds);
  process.stdout.write(`   pages=${batchBodies.pagesReturned} batches=${batchBodies.batches} elapsedMs=${batchBodies.elapsedMs} bytes=${batchBodies.totalResponseBytes}\n`);

  process.stdout.write('3. attachments...\n');
  const attachments = await measureAttachments(seed.attachments);
  process.stdout.write(`   downloaded=${attachments.downloadCalls} exactMatches=${attachments.exactByteMatches} elapsedMs=${attachments.elapsedMs}\n`);

  process.stdout.write('4. users bulk...\n');
  const users = await measureUsers(seed.pages[0] ? (await getJson(`/wiki/api/v2/pages/${rootPage.id}`)).authorId : null);
  process.stdout.write(`   ${JSON.stringify(users.outcomes)}\n`);

  process.stdout.write('5. search picker...\n');
  const search = await measureSearch(seed.space);
  process.stdout.write(`   ${JSON.stringify(search)}\n`);

  process.stdout.write('6. rate limiting at concurrency 4/6/8...\n');
  const sampleForRateLimit = allPageIds.slice(0, 60);
  const rateLimiting = await measureRateLimiting(sampleForRateLimit);
  process.stdout.write(`   ${JSON.stringify(rateLimiting)}\n`);

  process.stdout.write('7. parse + zip...\n');
  const zipMeasurement = measureZip(batchBodies.bodies, seed.pages, seed.attachments);
  process.stdout.write(`   ${JSON.stringify(zipMeasurement)}\n`);

  const report = {
    measuredAt: new Date().toISOString(),
    space: args.space,
    seedSummary: { pages: seed.pages.length, attachments: seed.attachments.length },
    treeScan,
    batchBodies: { ...batchBodies, bodies: undefined },
    attachments,
    users,
    search,
    rateLimiting,
    zip: zipMeasurement,
    rateLimitEventsTotal: rateLimitEvents.length,
    rateLimitEvents,
  };
  delete report.batchBodies.bodies;

  const outPath = join(REPO_ROOT, 'atlassian', 'data', 'g4-measurements.json');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`wrote ${outPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
