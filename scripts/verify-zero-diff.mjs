#!/usr/bin/env node
/**
 * Zero-diff check for ArtUp Export zips.
 *
 *   node scripts/verify-zero-diff.mjs first.zip second.zip
 *     unzips both into temp dirs and compares file sets and bytes.
 *   node scripts/verify-zero-diff.mjs first.zip second.zip update.zip fresh.zip
 *     does the same, then applies update.zip over the first tree (writes its files, deletes the
 *     paths listed in export-deleted.txt, drops that file) and compares the result with fresh.zip.
 *
 * Prints IDENTICAL for each passing comparison; otherwise lists the differing paths and exits 1.
 */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { unzipSync } = createRequire(join(REPO_ROOT, 'static/app/package.json'))('fflate');
const DELETED_FILE = 'export-deleted.txt';

async function unzipTo(zipPath, dir) {
  const entries = unzipSync(new Uint8Array(await readFile(resolve(zipPath))));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const target = join(dir, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}

async function listFiles(dir) {
  const out = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  await walk(dir);
  return out.sort();
}

async function compareDirs(a, b) {
  const left = await listFiles(a);
  const right = await listFiles(b);
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  const diffs = [];
  left.filter((p) => !rightSet.has(p)).forEach((p) => diffs.push(`only in first: ${p}`));
  right.filter((p) => !leftSet.has(p)).forEach((p) => diffs.push(`only in second: ${p}`));
  for (const path of left.filter((p) => rightSet.has(p))) {
    const [x, y] = await Promise.all([readFile(join(a, path)), readFile(join(b, path))]);
    if (!x.equals(y)) diffs.push(`content differs: ${path}`);
  }
  return { files: left.length, diffs };
}

async function applyUpdate(dir, updateZip) {
  await unzipTo(updateZip, dir);
  const listPath = join(dir, DELETED_FILE);
  let listed = [];
  try {
    listed = (await readFile(listPath, 'utf8')).split('\n').filter(Boolean);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const path of listed) await rm(join(dir, path), { force: true });
  await rm(listPath, { force: true });
  return listed.length;
}

function report(label, result) {
  if (result.diffs.length === 0) {
    console.log(`${label}: IDENTICAL (${result.files} files)`);
    return true;
  }
  console.log(`${label}: ${result.diffs.length} difference(s)`);
  result.diffs.forEach((d) => console.log(`  ${d}`));
  return false;
}

async function main(argv) {
  if (argv.length !== 2 && argv.length !== 4) {
    console.error('usage: verify-zero-diff.mjs first.zip second.zip [update.zip fresh.zip]');
    return 2;
  }
  const [first, second, update, fresh] = argv;
  const root = await mkdtemp(join(tmpdir(), 'artup-zero-diff-'));
  try {
    const dirs = Object.fromEntries(['first', 'second', 'applied', 'fresh'].map((k) => [k, join(root, k)]));
    await unzipTo(first, dirs.first);
    await unzipTo(second, dirs.second);
    let ok = report(`${first} vs ${second}`, await compareDirs(dirs.first, dirs.second));
    if (update) {
      await unzipTo(first, dirs.applied);
      const deleted = await applyUpdate(dirs.applied, update);
      await unzipTo(fresh, dirs.fresh);
      console.log(`applied ${update} over ${first}: ${deleted} path(s) deleted`);
      ok = report(`apply(${first} + ${update}) vs ${fresh}`, await compareDirs(dirs.applied, dirs.fresh)) && ok;
    }
    return ok ? 0 : 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

process.exitCode = await main(process.argv.slice(2));
