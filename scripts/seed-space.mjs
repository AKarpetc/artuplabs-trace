#!/usr/bin/env node
/**
 * Seeds a Confluence Cloud space with a large page tree plus attachments, for the
 * ArtUp Export G4 feasibility measurement (see the DistributB2B portfolio repo,
 * atlassian/20_app2_markdown_export.md §3, §6).
 *
 * Node 22, global fetch + FormData + Blob, basic auth from FORGE_EMAIL / FORGE_API_TOKEN.
 * No npm dependencies. Concurrency is capped at 5 in-flight requests; 429s are honoured
 * via Retry-After (falling back to exponential backoff), up to 6 attempts.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node scripts/seed-space.mjs --space EXPT --pages 1000 [--dry-run] [--force]
 *
 * Writes data/seed-<SPACE>.json: { space, homepageId, pages: [{id,title,parentId,depth}],
 * attachments: [{pageId,id,title,bytes,sha256}] } for later G4 measurement checks.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://artuplabs-dev.atlassian.net';
const CONCURRENCY = 5;
const BRANCHING = 4;
const MIN_DEPTH = 6;
const MAX_ATTEMPTS = 6;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

function parseArgs(argv) {
  const args = { space: 'EXPT', pages: 1000, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--space') args.space = argv[++i];
    else if (arg === '--pages') args.pages = Number(argv[++i]);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function authHeader() {
  const email = process.env.FORGE_EMAIL;
  const token = process.env.FORGE_API_TOKEN;
  if (!email || !token) {
    throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  }
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

async function request(path, init = {}) {
  const url = path.startsWith('http') ? path : `${SITE}${path}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        ...init.headers,
      },
    });
    if (response.ok) return response;
    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS - 1) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${path}: ${body.slice(0, 300)}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
    process.stderr.write(`  429/5xx on ${path}, retry-after=${waitS}s (attempt ${attempt + 1})\n`);
    await sleep(Math.min(30, waitS) * 1000);
  }
  throw new Error(`unreachable: ${path}`);
}

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function twoMegabytes() {
  return randomBytes(2 * 1024 * 1024);
}

const PLAIN_TITLES = [
  'Getting Started', 'Release Notes', 'Architecture Overview', 'Onboarding Guide',
  'Deployment Runbook', 'Incident Postmortem', 'Style Guide', 'FAQ',
  'Meeting Notes', 'Roadmap', 'Glossary', 'Troubleshooting',
];
const DIACRITIC_TITLES = ['Café Déjà vu', 'Łódź plan', 'Straße', 'Æsir Øresund notes'];
const CYRILLIC_TITLES = ['Привет, мир', 'Щука и ёж', 'Документация проекта'];
const GREEK_TITLES = ['Αθήνα', 'Ολυμπιακοί αγώνες'];
const CJK_TITLES = ['设计文档', '日本語のページ', '產品規格書'];
const EMOJI_TITLES = ['🚀 Launch checklist', '📚 Docs index', '🔥 Hotfix log'];

function longTitle(seed) {
  const phrase = `Very long page title about ${seed} that keeps going on and on `;
  let text = '';
  while (text.length < 250) text += phrase;
  return text.slice(0, 250);
}

/**
 * Cycles through numbered title-pattern generators; Confluence enforces per-space title
 * uniqueness (measured 2026-09-28), so every generated title gets a unique numeric suffix.
 */
function titleGenerator() {
  const generators = [
    (i) => `${PLAIN_TITLES[i % PLAIN_TITLES.length]} ${i}`,
    (i) => `${DIACRITIC_TITLES[i % DIACRITIC_TITLES.length]} ${i}`,
    (i) => `${CYRILLIC_TITLES[i % CYRILLIC_TITLES.length]} ${i}`,
    (i) => `${GREEK_TITLES[i % GREEK_TITLES.length]} ${i}`,
    (i) => `${CJK_TITLES[i % CJK_TITLES.length]}${i}`,
    (i) => `${EMOJI_TITLES[i % EMOJI_TITLES.length]} ${i}`,
    (i) => longTitle(i),
    (i) => `${PLAIN_TITLES[(i + 3) % PLAIN_TITLES.length]} v${i}`,
  ];
  let i = 0;
  return () => {
    const g = generators[i % generators.length];
    const title = g(i);
    i += 1;
    return title;
  };
}

function taskListMacro() {
  return `<ac:task-list>
<ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Draft the outline</ac:task-body></ac:task>
<ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>Review with the team</ac:task-body></ac:task>
</ac:task-list>`;
}

function table4x3() {
  const row = (n) => `<tr>${Array.from({ length: 4 }, (_, c) => `<td><p>R${n}C${c}</p></td>`).join('')}</tr>`;
  return `<table><tbody>${[0, 1, 2].map(row).join('')}</tbody></table>`;
}

function tableWithColspan() {
  return `<table><tbody><tr><td colspan="2"><p>Spans two columns</p></td><td><p>Normal</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></tbody></table>`;
}

function codeMacro() {
  return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[const s = \`template with backticks \${1 + 1}\`;]]></ac:plain-text-body></ac:structured-macro>`;
}

function panel(name, text) {
  return `<ac:structured-macro ac:name="${name}"><ac:rich-text-body><p>${text}</p></ac:rich-text-body></ac:structured-macro>`;
}

function expandMacro() {
  return `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">More details</ac:parameter><ac:rich-text-body><p>Hidden content revealed on expand.</p></ac:rich-text-body></ac:structured-macro>`;
}

function statusMacro() {
  return `<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">DONE</ac:parameter></ac:structured-macro>`;
}

function tocMacro() {
  return `<ac:structured-macro ac:name="toc" />`;
}

function pageLink(title) {
  const escaped = String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<ac:link><ri:page ri:content-title="${escaped}" /></ac:link>`;
}

function imageMacro(fileName) {
  return `<ac:image><ri:attachment ri:filename="${fileName}" /></ac:image>`;
}

function bodyFor(title, earlierTitles) {
  const links = [];
  if (earlierTitles.length > 0) {
    links.push(pageLink(earlierTitles[Math.floor(Math.random() * earlierTitles.length)]));
  }
  if (earlierTitles.length > 1) {
    links.push(pageLink(earlierTitles[Math.floor(Math.random() * earlierTitles.length)]));
  }
  return `<h1>${title}</h1>
<p>Seed content for the ArtUp Export G4 feasibility measurement.</p>
<h2>Nested list</h2>
<ul><li>Top item<ul><li>Nested item one</li><li>Nested item two</li></ul></li><li>Second top item</li></ul>
<h2>Tasks</h2>
${taskListMacro()}
<h2>Table 4x3</h2>
${table4x3()}
<h2>Table with colspan</h2>
${tableWithColspan()}
<h2>Code</h2>
${codeMacro()}
${panel('info', 'This is an info panel.')}
${panel('warning', 'This is a warning panel.')}
${expandMacro()}
<p>Status: ${statusMacro()}</p>
${tocMacro()}
<h2>Links</h2>
<p>${links.join(' ') || 'No earlier pages yet.'}</p>
<h2>Image</h2>
<p>${imageMacro('image.png')}</p>`;
}

function planTree(totalPages) {
  const nodes = [];
  let nextId = 0;
  const makeNode = (parentIndex, depth) => {
    const index = nextId;
    nextId += 1;
    nodes.push({ index, parentIndex, depth, childCount: 0 });
    return index;
  };
  const rootIndex = makeNode(null, 0);
  let spineTip = rootIndex;
  for (let d = 1; d <= MIN_DEPTH; d += 1) {
    spineTip = makeNode(spineTip, d);
  }
  for (const n of nodes) {
    if (n.parentIndex !== null) {
      const parent = nodes[n.parentIndex];
      parent.childCount += 1;
    }
  }
  const queue = nodes.map((n) => n.index);
  let qi = 0;
  while (nodes.length < totalPages && qi < queue.length) {
    const parentIndex = queue[qi];
    qi += 1;
    const parent = nodes[parentIndex];
    const slots = BRANCHING - parent.childCount;
    for (let s = 0; s < slots && nodes.length < totalPages; s += 1) {
      const childIndex = makeNode(parentIndex, parent.depth + 1);
      parent.childCount += 1;
      queue.push(childIndex);
    }
  }
  return nodes.slice(0, totalPages);
}

/**
 * Assigns titles, substituting accent/case near-duplicates ("Café notes"/"Cafe notes",
 * "Straße plan"/"Strasse plan") for two sibling groups: real Confluence rejects literal
 * case-only duplicates (measured 2026-09-28) but accepts these, and they still collide in
 * the export tool's transliterated slug.
 */
function assignTitles(nodes) {
  const gen = titleGenerator();
  const byParent = new Map();
  for (const n of nodes) {
    if (!byParent.has(n.parentIndex)) byParent.set(n.parentIndex, []);
    byParent.get(n.parentIndex).push(n);
  }
  const parentsWithFourChildren = [...byParent.entries()].filter(([, kids]) => kids.length >= 4);
  const dupNotesParent = parentsWithFourChildren[0];
  const dupApiParent = parentsWithFourChildren[1];
  for (const n of nodes) n.title = null;
  if (dupNotesParent) {
    const [, kids] = dupNotesParent;
    kids[0].title = 'Café notes';
    kids[1].title = 'Cafe notes';
    kids[2].title = 'Notes';
    if (kids[3]) kids[3].title = `${PLAIN_TITLES[0]} home`;
  }
  if (dupApiParent) {
    const [, kids] = dupApiParent;
    kids[0].title = 'Straße plan';
    kids[1].title = 'Strasse plan';
    if (kids[2]) kids[2].title = 'API';
    if (kids[3]) kids[3].title = `${PLAIN_TITLES[2]} guide`;
  }
  for (const n of nodes) {
    if (n.title === null) n.title = gen();
  }
  return nodes;
}

async function getSpace(space) {
  const response = await request(`/wiki/api/v2/spaces?keys=${encodeURIComponent(space)}&limit=1`);
  const body = await response.json();
  return body.results?.[0] ?? null;
}

async function createSpace(space) {
  try {
    const response = await request('/wiki/api/v2/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: space, name: 'Export test', description: 'ArtUp Export G4 seed space' }),
    });
    return response.json();
  } catch (v2Error) {
    process.stderr.write(`v2 space create failed (${v2Error.message}), falling back to v1\n`);
    const response = await request('/wiki/rest/api/space', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: space, name: 'Export test', description: { plain: { value: 'ArtUp Export G4 seed space', representation: 'plain' } } }),
    });
    return response.json();
  }
}

async function createPage({ spaceId, parentId, title, body }) {
  const response = await request('/wiki/api/v2/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      status: 'current',
      title,
      parentId: parentId ?? undefined,
      body: { representation: 'storage', value: body },
    }),
  });
  return response.json();
}

async function uploadAttachments(pageId, files) {
  const form = new FormData();
  for (const file of files) {
    form.append('file', new Blob([file.bytes]), file.name);
  }
  const response = await fetch(`${SITE}/wiki/rest/api/content/${pageId}/child/attachment`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'X-Atlassian-Token': 'no-check',
    },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`attachment upload failed for page ${pageId}: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const json = await response.json();
  return json.results ?? [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`space=${args.space} pages=${args.pages} dryRun=${args.dryRun} force=${args.force}\n`);

  const existing = await getSpace(args.space);
  if (existing) {
    process.stdout.write(`space ${args.space} already exists (id=${existing.id})\n`);
    const countResponse = await request(`/wiki/api/v2/spaces/${existing.id}/pages?limit=1`);
    const countBody = await countResponse.json();
    const hasNext = Boolean(countBody._links?.next);
    if (hasNext && !args.force) {
      throw new Error(`space ${args.space} already has pages (at least a full page); refusing without --force`);
    }
  }

  if (args.dryRun) {
    const nodes = assignTitles(planTree(args.pages));
    const maxDepth = Math.max(...nodes.map((n) => n.depth));
    process.stdout.write(`dry-run: would create ${nodes.length} pages, max depth ${maxDepth}, `
      + `${nodes.filter((_, i) => (i + 1) % 10 === 0).length} pages with attachments\n`);
    return;
  }

  let space = existing ?? (await createSpace(args.space));
  if (!space.homepageId) {
    for (let attempt = 0; attempt < 10 && !space.homepageId; attempt += 1) {
      await sleep(1000);
      space = await getSpace(args.space);
    }
  }
  const spaceId = String(space.id);
  const homepageId = space.homepageId ? String(space.homepageId) : null;
  process.stdout.write(`space id=${spaceId} homepageId=${homepageId}\n`);

  const nodes = assignTitles(planTree(args.pages));
  const pool = createPool(CONCURRENCY);
  const createdTitlesInOrder = [];
  const results = new Array(nodes.length);
  const attachmentResults = [];

  const byIndex = new Map(nodes.map((n) => [n.index, n]));
  const depthOrder = [...nodes].sort((a, b) => a.depth - b.depth || a.index - b.index);
  const levels = new Map();
  for (const node of depthOrder) {
    if (!levels.has(node.depth)) levels.set(node.depth, []);
    levels.get(node.depth).push(node);
  }
  const maxDepthLevel = Math.max(...levels.keys());

  for (let depth = 0; depth <= maxDepthLevel; depth += 1) {
    const levelNodes = levels.get(depth) ?? [];
    await Promise.all(levelNodes.map((node) => pool(async () => {
      const parent = node.parentIndex === null ? null : byIndex.get(node.parentIndex);
      const parentId = parent ? results[parent.index]?.id : homepageId;
      if (node.parentIndex !== null && !parentId) {
        throw new Error(`parent page for node ${node.index} not created yet (out-of-order creation)`);
      }
      const earlierTitles = createdTitlesInOrder.slice();
      const bodyHtml = bodyFor(node.title, earlierTitles);
      const created = await createPage({ spaceId, parentId, title: node.title, body: bodyHtml });
      results[node.index] = created;
      createdTitlesInOrder.push(node.title);
      if (createdTitlesInOrder.length % 50 === 0) {
        process.stdout.write(`  created ${createdTitlesInOrder.length}/${nodes.length} pages\n`);
      }
    })));
  }

  await Promise.all(depthOrder.map((node, order) => pool(async () => {
    if ((order + 1) % 10 !== 0) return;
    const pageId = results[node.index].id;
    const files = [
      { name: 'pixel.png', bytes: Buffer.from(TINY_PNG_BASE64, 'base64') },
      { name: 'payload.bin', bytes: twoMegabytes() },
    ];
    const uploaded = await uploadAttachments(pageId, files);
    for (let i = 0; i < uploaded.length; i += 1) {
      const file = files[i];
      attachmentResults.push({
        pageId,
        id: uploaded[i].id,
        title: uploaded[i].title,
        bytes: file.bytes.length,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
      });
    }
    if (attachmentResults.length % 40 === 0) {
      process.stdout.write(`  uploaded ${attachmentResults.length} attachments\n`);
    }
  })));

  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const pagesOut = nodes.map((n) => ({
    id: results[n.index].id,
    title: n.title,
    parentId: n.parentIndex === null ? homepageId : results[byIndex.get(n.parentIndex).index].id,
    depth: n.depth,
  }));

  const outPath = join(REPO_ROOT, 'data', `seed-${args.space}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({
    space: args.space,
    spaceId,
    homepageId,
    createdAt: new Date().toISOString(),
    pages: pagesOut,
    attachments: attachmentResults,
  }, null, 2));

  process.stdout.write(`created ${pagesOut.length} pages, ${attachmentResults.length} attachments, depth ${maxDepth}\n`);
  process.stdout.write(`wrote ${outPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
