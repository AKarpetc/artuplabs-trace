#!/usr/bin/env node
/**
 * Seeds comments and attachments on artuplabs-dev for the ArtUp Query J-G7 gate (plan 2026-10-03-artup-query-v1, Task 18),
 * written to atlassian/data/jg7-seed.json:
 *   comments    "seed comment N" on JQLG jg-small issues (in key order, round robin) until project in (JQLG, RPT) holds
 *               ≥ 6 300 comments; every 20th restricted to a project role, every 20th shifted by 10 to a group
 *   attachments one small file on each of JQLG-9000…JQLG-9299, extensions xlsx, pdf, png, txt, docx in turn
 *
 * Resumable: the comment counter and the first "before" are kept in jg7-seed.json; an issue that already holds its
 * seed attachment is skipped.
 *
 * Usage:
 *   set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
 *   node atlassian/tools/seed-jira-comments.mjs [--limit N]
 * --limit N adds at most N comments and N attachments in this run.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, ids, bulk, pool, sleep, stats, SITE } from '../../apps/query/scripts/lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', 'data', 'jg7-seed.json');
const TARGET = 6300;
const EXTS = ['xlsx', 'pdf', 'png', 'txt', 'docx'];
const ATTACH_FROM = 9000;
const ATTACH_COUNT = 300;

const log = (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`);
const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;
const doc = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function countComments() {
  const r = await ids('project in (JQLG, RPT)');
  if (r.error) throw new Error(r.error);
  const found = await bulk(r.ids, ['comment']);
  return found.reduce((sum, x) => sum + (x.fields.comment?.total ?? 0), 0);
}

/**
 * The role and group the restricted comments go to. A restricted comment can be written only by a member of the role or
 * group. When the seeding user is not in the role and Jira refuses to add them (the dev site is on the Free plan: "You can't
 * update role actors"), roleUsable is false and the role-numbered comments are written unrestricted.
 */
async function restriction() {
  const roles = await api('GET', '/rest/api/3/project/JQLG/role');
  const role = 'Administrators' in roles ? 'Administrators' : Object.keys(roles).find((r) => r !== 'atlassian-addons-project-access');
  const me = await api('GET', '/rest/api/3/myself?expand=groups');
  const mine = new Set((me.groups?.items ?? []).map((g) => g.name));
  const rolePath = new URL(roles[role]).pathname;
  const actors = (await api('GET', rolePath)).actors ?? [];
  let roleUsable = actors.some((a) => a.actorUser?.accountId === me.accountId || mine.has(a.actorGroup?.name ?? a.name));
  if (!roleUsable) {
    const r = await api('POST', rolePath, { user: [me.accountId] }, { raw: true });
    roleUsable = r.status === 200;
    log(roleUsable ? `added the seeding user to project role "${role}" of JQLG` : `cannot join project role "${role}": ${r.status} ${r.text.slice(0, 200)}`);
  }
  const { groups } = await api('GET', '/rest/api/3/groups/picker?maxResults=5');
  // The first picker group the author belongs to.
  const group = groups.find((g) => mine.has(g.name)) ?? groups[0];
  return { role, roleUsable, group };
}

/** Uploads one file; after a network error or 5xx looks for it on the issue before sending again. */
async function upload(key, filename, bytes) {
  const present = async () => {
    const x = await api('GET', `/rest/api/3/issue/${key}?fields=attachment`);
    return (x.fields.attachment ?? []).some((a) => a.filename === filename);
  };
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    stats.requests += 1;
    const form = new FormData();
    form.append('file', new Blob([bytes]), filename);
    let res;
    try {
      res = await fetch(`${SITE}/rest/api/3/issue/${key}/attachments`, {
        method: 'POST',
        headers: { Authorization: auth(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      stats.retries += 1;
      await sleep(3000);
      if (await present()) return;
      continue;
    }
    if (res.ok) return;
    if (res.status === 429) {
      stats.retries += 1;
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    if (res.status >= 500) {
      stats.retries += 1;
      await sleep(3000);
      if (await present()) return;
      continue;
    }
    throw new Error(`POST attachment ${key} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error(`POST attachment ${key} → gave up`);
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = Number(process.argv[i + 1]);
  const limit = args.limit ?? Infinity;
  const t0 = Date.now();
  const seed = await readFile(SEED, 'utf8').then(JSON.parse).catch(() => ({}));
  const save = () => writeFile(SEED, JSON.stringify(seed, null, 1));

  const now = await countComments();
  const { role, roleUsable, group } = await restriction();
  seed.comments = { before: seed.comments?.before ?? now, after: now, restricted: { role, group: group.name }, roleUsable, seeded: seed.comments?.seeded ?? 0, restrictedSeeded: seed.comments?.restrictedSeeded ?? { role: 0, group: 0 } };
  log(`comments: ${now} now (before ${seed.comments.before}), ${seed.comments.seeded} seeded earlier; role "${role}", group "${group.name}"`);
  await save();

  const small = (await api('POST', '/rest/api/3/search/jql', { jql: 'project = JQLG AND labels = jg-small ORDER BY key ASC', fields: ['summary'], maxResults: 5000 })).issues.map((x) => x.key);
  const count = Math.min(Math.max(0, TARGET - now), limit);
  const first = seed.comments.seeded;
  let made = 0;
  let last = first - 1;
  let failure;
  const usable = { role: roleUsable, group: true }; // re-detected every run: the site setting may change
  const progress = () => {
    seed.comments.seeded = Math.max(first + made, last + 1);
    seed.comments.groupUsable = usable.group;
    return save();
  };
  const post = (key, text, visibility) => api('POST', `/rest/api/3/issue/${key}/comment`, { body: doc(text), ...(visibility ? { visibility } : {}) }, { raw: true });
  await pool(Array.from({ length: count }, (_, j) => first + j), 4, async (i) => {
    if (failure) return;
    try {
      const type = i % 20 === 0 ? 'role' : i % 20 === 10 ? 'group' : null;
      const visibility = type && usable[type] ? (type === 'role' ? { type, value: role } : { type, identifier: group.groupId }) : undefined;
      const key = small[i % small.length];
      let r = await post(key, `seed comment ${i + 1}`, visibility);
      if (r.status === 400 && visibility && r.text.includes('commentLevel')) {
        // The site refuses this restriction (Free plan: no role actors, group visibility off): written unrestricted.
        if (usable[type]) log(`${type} visibility refused, ${type}-numbered comments go unrestricted: ${r.text.slice(0, 200)}`);
        usable[type] = false;
        r = await post(key, `seed comment ${i + 1}`);
      } else if (r.status < 300 && visibility) seed.comments.restrictedSeeded[type] += 1;
      if (r.status >= 300) throw new Error(`POST comment ${key} → ${r.status} ${r.text.slice(0, 300)}`);
      made += 1;
      last = Math.max(last, i);
      if (made % 100 === 0) {
        log(`  comments ${made}/${count}`);
        await progress();
      }
    } catch (error) {
      failure ??= error;
    }
  });
  // Numbers below the highest one written are not reused: a gap is a lost comment, a reuse would be a duplicate.
  await progress();
  if (failure) throw failure;
  seed.comments.after = made ? await countComments() : now;
  log(`comments: added ${made}, now ${seed.comments.after}`);
  await save();

  const keys = Array.from({ length: ATTACH_COUNT }, (_, j) => `JQLG-${ATTACH_FROM + j}`);
  const files = keys.map((key, j) => ({ key, ext: EXTS[j % EXTS.length], filename: `seed-${key}.${EXTS[j % EXTS.length]}` }));
  const have = new Set((await bulk(keys, ['attachment'])).flatMap((x) => (x.fields.attachment ?? []).map((a) => `${x.key}/${a.filename}`)));
  const todo = files.filter((f) => !have.has(`${f.key}/${f.filename}`)).slice(0, limit === Infinity ? undefined : limit);
  log(`attachments: ${files.length - files.filter((f) => !have.has(`${f.key}/${f.filename}`)).length} present, uploading ${todo.length}`);
  await pool(todo, 4, (f) => upload(f.key, f.filename, Buffer.from(`seed ${f.key}\n`)));
  const present = new Set((await bulk(keys, ['attachment'])).flatMap((x) => (x.fields.attachment ?? []).map((a) => `${x.key}/${a.filename}`)));
  const added = files.filter((f) => present.has(`${f.key}/${f.filename}`));
  seed.attachments = { added: added.length, byExt: Object.fromEntries(EXTS.map((e) => [e, added.filter((f) => f.ext === e).length])) };
  await save();
  log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(seed)}; requests ${JSON.stringify(stats)}`);
}

main().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
