#!/usr/bin/env node
/**
 * Seeds the RPT project on artuplabs-dev for the ArtUp Reports X-G5 measurement
 * (atlassian/22_app3_jira_reports.md §3): 10 000 issues with Latin, Cyrillic and CJK text,
 * ADF tables (some with merged cells), code, lists; comments, worklogs, links and PNG attachments.
 * Idempotent: counts what already exists and only tops it up.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/seed-jira-rpt.mjs [--issues 10000] [--comments 2000] [--attachments 500]
 */

import { deflateSync } from 'node:zlib';

const SITE = 'https://artuplabs-dev.atlassian.net';
const KEY = 'RPT';
const MAX_ATTEMPTS = 6;

function parseArgs(argv) {
  const args = { issues: 10000, comments: 2000, worklogs: 1000, links: 1000, attachments: 500 };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (name in args) args[name] = Number(argv[i + 1]);
  }
  return args;
}

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

/** Runs task(i) for i in [0, n) with bounded concurrency. */
async function pool(n, concurrency, task) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      await task(i);
      done += 1;
      if (done % 500 === 0) process.stderr.write(`  ${done}/${n}\n`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

const WORDS = {
  latin: ['export', 'report', 'invoice', 'audit', 'release', 'sprint', 'customer', 'evidence', 'module', 'review'],
  cyrillic: ['отчёт', 'выгрузка', 'аудит', 'клиент', 'релиз', 'проверка', 'модуль', 'требование', 'счёт', 'журнал'],
  cjk: ['報告', '導出', '監査', '顧客', 'リリース', '検証', 'モジュール', '要件', '請求', '記録'],
};

function phrase(i, n) {
  const script = ['latin', 'cyrillic', 'cjk'][i % 3];
  const w = WORDS[script];
  return Array.from({ length: n }, (_, k) => w[(i * 7 + k * 3) % w.length]).join(' ');
}

const text = (t) => ({ type: 'text', text: t });
const para = (t) => ({ type: 'paragraph', content: [text(t)] });
const cell = (t, attrs) => ({ type: 'tableCell', ...(attrs ? { attrs } : {}), content: [para(t)] });

/** ADF description: paragraphs, bullet list, code block and a table; every 10th has merged cells. */
function description(i) {
  const merged = i % 10 === 0;
  const rows = [
    { type: 'tableRow', content: [cell('Field'), cell('Value'), cell('Note')] },
    { type: 'tableRow', content: merged ? [cell(phrase(i, 3), { colspan: 2 }), cell('merged')] : [cell('A'), cell(phrase(i, 2)), cell('—')] },
    { type: 'tableRow', content: [cell('B'), cell(String(i)), cell(phrase(i + 1, 2))] },
  ];
  return {
    type: 'doc',
    version: 1,
    content: [
      para(`${phrase(i, 12)}. ${phrase(i + 5, 10)}.`),
      { type: 'bulletList', content: [1, 2, 3].map((k) => ({ type: 'listItem', content: [para(phrase(i + k, 4))] })) },
      { type: 'codeBlock', attrs: { language: 'json' }, content: [text(`{"issue": ${i}, "ok": true}`)] },
      { type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: rows },
    ],
  };
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

async function ensureProject() {
  const found = await api('GET', `/rest/api/3/project/search?keys=${KEY}`);
  if (found.values.length) return found.values[0];
  const me = await api('GET', '/rest/api/3/myself');
  await api('POST', '/rest/api/3/project', {
    key: KEY,
    name: 'Reports Demo',
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    leadAccountId: me.accountId,
  });
  return (await api('GET', `/rest/api/3/project/search?keys=${KEY}`)).values[0];
}

async function count(jql) {
  return (await api('POST', '/rest/api/3/search/approximate-count', { jql })).count;
}

/** Issue keys in creation order, via the paged JQL search with ids only. */
async function keys() {
  const out = [];
  let nextPageToken;
  do {
    const page = await api('POST', '/rest/api/3/search/jql', {
      jql: `project = ${KEY} ORDER BY created ASC`,
      fields: ['summary'],
      maxResults: 5000,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...page.issues.map((x) => x.key));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return out;
}

async function seedIssues(project, target) {
  const have = await count(`project = ${KEY}`);
  const types = (await api('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`))
    .filter((t) => !t.subtask && ['Task', 'Bug', 'Story'].includes(t.name));
  const typeIds = types.length ? types.map((t) => t.id) : [(await api('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`)).find((t) => !t.subtask).id];
  const missing = Math.max(0, target - have);
  process.stderr.write(`issues: have ${have}, creating ${missing}\n`);
  const batches = Math.ceil(missing / 50);
  await pool(batches, 4, async (b) => {
    const issueUpdates = Array.from({ length: Math.min(50, missing - b * 50) }, (_, k) => {
      const i = have + b * 50 + k;
      return {
        fields: {
          project: { id: project.id },
          issuetype: { id: typeIds[i % typeIds.length] },
          summary: `${String(i).padStart(5, '0')} ${phrase(i, 5)}`,
          description: description(i),
          labels: [`seed`, `batch-${i % 20}`],
          duedate: new Date(Date.UTC(2026, i % 12, (i % 27) + 1)).toISOString().slice(0, 10),
        },
      };
    });
    await api('POST', '/rest/api/3/issue/bulk', { issueUpdates });
  });
}

async function seedPerIssue(all, n, label, jqlDone, task) {
  const done = await count(jqlDone);
  const todo = all.slice(0, n).slice(done);
  process.stderr.write(`${label}: have ${done}, adding ${todo.length}\n`);
  await pool(todo.length, 8, (i) => task(todo[i], i + done));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const project = await ensureProject();
  await seedIssues(project, args.issues);
  const all = await keys();
  await seedPerIssue(all, args.comments, 'comments', `project = ${KEY} AND comment ~ "seed-comment"`, async (key, i) => {
    for (let k = 0; k < 3; k += 1) {
      await api('POST', `/rest/api/3/issue/${key}/comment`, { body: { type: 'doc', version: 1, content: [para(`seed-comment ${k}: ${phrase(i + k, 8)}`)] } });
    }
  });
  await seedPerIssue(all, args.worklogs, 'worklogs', `project = ${KEY} AND timespent > 0`, (key, i) =>
    api('POST', `/rest/api/3/issue/${key}/worklog`, { timeSpentSeconds: 900 * ((i % 8) + 1), comment: { type: 'doc', version: 1, content: [para(phrase(i, 4))] } }));
  await seedPerIssue(all, args.links, 'links', `project = ${KEY} AND issueLinkType is not EMPTY`, (key, i) =>
    api('POST', '/rest/api/3/issueLink', { type: { name: 'Relates' }, inwardIssue: { key }, outwardIssue: { key: all[(i + 5000) % all.length] } }));
  await seedPerIssue(all, args.attachments, 'attachments', `project = ${KEY} AND attachments is not EMPTY`, async (key, i) => {
    const form = new FormData();
    form.append('file', new Blob([png(i)], { type: 'image/png' }), `diagram-${i}.png`);
    await api('POST', `/rest/api/3/issue/${key}/attachments`, form, { 'X-Atlassian-Token': 'no-check' });
  });
  process.stderr.write(`done in ${Math.round((Date.now() - t0) / 1000)} s, issues ${all.length}\n`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
