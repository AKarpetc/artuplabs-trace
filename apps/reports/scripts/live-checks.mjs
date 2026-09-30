#!/usr/bin/env node
/**
 * Live checks against the dev site: `media` measures how Jira stores and renders inline images
 * in RPT issue descriptions and writes the Task 6 fixture; `adf <KEY>` prints a description ADF.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node apps/reports/scripts/live-checks.mjs media
 *   node apps/reports/scripts/live-checks.mjs adf RPT-1
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://artuplabs-dev.atlassian.net';
const PROJECT = 'RPT';
const LABEL = 'live-check';
const MAX_ATTEMPTS = 6;
const FIXTURE = fileURLToPath(new URL('../static/app/test/fixtures/adf/media-rpt.json', import.meta.url));

function authHeader() {
  const email = process.env.FORGE_EMAIL;
  const token = process.env.FORGE_API_TOKEN;
  if (!email || !token) throw new Error('FORGE_EMAIL / FORGE_API_TOKEN not set (source the .env first)');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Calls Jira REST with retries on 429 and 5xx; returns parsed JSON or null for 204. */
async function api(method, path, body, extraHeaders = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${SITE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
    const raw = await res.text();
    return raw ? JSON.parse(raw) : null;
  }
  throw new Error(`${method} ${path} → gave up after ${MAX_ATTEMPTS} attempts`);
}

/** A small valid RGB PNG (w×h) with a gradient, so each attachment differs. */
function png(seed, w = 320, h = 200) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x + seed) % 256;
      raw[o + 1] = (y * 2 + seed) % 256;
      raw[o + 2] = (seed * 13) % 256;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}


const BULK_FIELDS = { fields: ['description', 'attachment'], expand: ['renderedFields'] };

function assertRpt(key) {
  if (!key.startsWith(`${PROJECT}-`)) throw new Error(`refusing to touch ${key}: only project ${PROJECT} is allowed`);
}

/** Depth-first list of media nodes of an ADF document, in document order. */
function mediaNodes(adf) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'media') found.push(node);
    (node.content || []).forEach(walk);
  };
  walk(adf);
  return found;
}

/** Attachment ids of the images in rendered HTML, in document order. */
function renderedIds(html) {
  const ids = [];
  for (const tag of (html || '').match(/<img\b[^>]*>/g) || []) {
    const m = tag.match(/\/attachment\/(?:content|thumbnail)\/(\d+)/) || tag.match(/\/secure\/(?:attachment|thumbnail)\/(\d+)/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

async function bulkFetch(keys) {
  const res = await api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: keys, ...BULK_FIELDS });
  return [...res.issues].sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
}

async function existingIssues() {
  const res = await api('POST', '/rest/api/3/search/jql', {
    jql: `project = ${PROJECT} AND labels = ${LABEL} ORDER BY summary ASC`,
    fields: ['summary'],
    maxResults: 50,
  });
  return res.issues.map((i) => i.key);
}

async function createIssues() {
  const seed = await api('GET', `/rest/api/3/issue/${PROJECT}-1?fields=issuetype`);
  const keys = [];
  for (let n = 1; n <= 3; n += 1) {
    const made = await api('POST', '/rest/api/3/issue', {
      fields: {
        project: { key: PROJECT },
        issuetype: { id: seed.fields.issuetype.id },
        summary: `live-check media ${n}`,
        labels: [LABEL],
      },
    });
    assertRpt(made.key);
    keys.push(made.key);
  }
  return keys;
}

async function upload(key, filename, seed) {
  assertRpt(key);
  const form = new FormData();
  form.append('file', new Blob([png(seed)], { type: 'image/png' }), filename);
  await api('POST', `/rest/api/3/issue/${key}/attachments`, form, { 'X-Atlassian-Token': 'no-check' });
}

const WIKI = [
  (n) => `Before !diagram-${n}.png|thumbnail! after`,
  (n) => `Before !diagram-${n}.png! after`,
];

async function setDescription(key, text) {
  assertRpt(key);
  await api('PUT', `/rest/api/2/issue/${key}`, { fields: { description: text } });
}

async function ensureMedia(keys) {
  const [first] = await bulkFetch([keys[0]]);
  if ((first.fields.attachment || []).length) return { reused: true, wiki: 'existing' };
  await upload(keys[0], 'diagram-1.png', 1);
  await upload(keys[1], 'diagram-2.png', 2);
  await upload(keys[2], 'same.png', 3);
  await upload(keys[2], 'same.png', 4);
  let used = null;
  for (const make of WIKI) {
    await setDescription(keys[0], make(1));
    await setDescription(keys[1], make(2));
    const [probe] = await bulkFetch([keys[0]]);
    if (mediaNodes(probe.fields.description).length) {
      used = make(0).replace('diagram-0.png', 'diagram-N.png');
      break;
    }
  }
  await setDescription(keys[2], '!same.png! and !same.png!');
  return { reused: false, wiki: used || 'none stored a media node' };
}

async function media() {
  let keys = await existingIssues();
  if (keys.length !== 3) keys = await createIssues();
  keys.forEach(assertRpt);
  const setup = await ensureMedia(keys);
  const issues = await bulkFetch(keys);
  const cases = [];
  const rows = [];
  for (const issue of issues) {
    const attachments = (issue.fields.attachment || []).map((a) => ({ id: String(a.id), filename: a.filename, mimeType: a.mimeType }));
    const renderedHtml = issue.renderedFields.description || '';
    const expected = renderedIds(renderedHtml);
    const nodes = mediaNodes(issue.fields.description);
    cases.push({ adf: issue.fields.description, attachments, renderedHtml, expected });
    nodes.forEach((node, i) => {
      const attrs = node.attrs || {};
      const target = attachments.find((a) => a.id === expected[i]);
      rows.push({
        issue: issue.key,
        node: i + 1,
        id: attrs.id,
        alt: attrs.alt,
        type: attrs.type,
        collection: attrs.collection,
        width: attrs.width,
        height: attrs.height,
        expectedAttachment: expected[i],
        filename: target && target.filename,
        altEqualsFilename: Boolean(target) && attrs.alt === target.filename,
      });
    });
    if (!nodes.length) rows.push({ issue: issue.key, node: 0, note: 'no media node in ADF', expectedAttachment: expected.join(',') });
  }
  writeFileSync(FIXTURE, `${JSON.stringify({ cases }, null, 2)}\n`);
  console.log(JSON.stringify(setup));
  console.table(rows);
  console.log(`alt equals the file name for every node: ${rows.every((r) => r.altEqualsFilename)}`);
  console.log(`issues: ${keys.join(', ')}; fixture: ${FIXTURE}`);
}

async function adf(key) {
  assertRpt(key);
  const issue = await api('GET', `/rest/api/3/issue/${key}?fields=description`);
  console.log(JSON.stringify(issue.fields.description, null, 2));
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'media') return media();
  if (command === 'adf' && arg) return adf(arg);
  throw new Error('usage: live-checks.mjs media | adf <KEY>');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
