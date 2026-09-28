#!/usr/bin/env node
/**
 * Builds a real documentation site from an ArtUp Export zip and reports whether the build
 * succeeded, the navigation order of the top levels against the Confluence tree recorded in
 * export-manifest.json, and how panels rendered. Dev tool; not bundled into the app.
 *
 * Usage:
 *   node scripts/verify-sites.mjs <zip> --preset docusaurus|mkdocs|hugo --workdir <scratch dir> [--depth 2]
 *
 * Everything is installed under --workdir: a Docusaurus 3 classic site (npx create-docusaurus),
 * a Python venv with MkDocs, the hugo-extended npm package. Nothing is installed system-wide.
 * Exit code: 0 when the site builds (or hugo cannot run: "hugo: not run"), 1 on a build failure.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ADMONITION_SOURCE = {
  docusaurus: /^:{3,}(note|tip|warning|danger)/m,
  mkdocs: /^\s*!!! (note|tip|warning|danger)/m,
  hugo: /^> \[!(NOTE|TIP|WARNING|CAUTION)\]/m,
};
const ADMONITION_HTML = {
  docusaurus: /theme-admonition/g,
  mkdocs: /class="admonition /g,
  hugo: /class="[^"]*\balert\b[^"]*"/g,
};

function parseArgs(argv) {
  const args = { zip: null, preset: null, workdir: null, depth: '2' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (key === null) {
      args.zip = argv[i];
      continue;
    }
    if (!(key in args) || key === 'zip') throw new Error(`unknown argument: ${argv[i]}`);
    args[key] = argv[++i];
  }
  if (!args.zip || !args.workdir || !['docusaurus', 'mkdocs', 'hugo'].includes(args.preset)) {
    throw new Error('usage: verify-sites.mjs <zip> --preset docusaurus|mkdocs|hugo --workdir <dir> [--depth 2]');
  }
  return { ...args, zip: resolve(args.zip), workdir: resolve(args.workdir), depth: Number(args.depth) };
}

function run(command, commandArgs, cwd, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...extraEnv } });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, error: result.error };
}

function unzipInto(zip, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  const manifest = JSON.parse(readFileSync(join(dir, 'export-manifest.json'), 'utf8'));
  rmSync(join(dir, 'export-manifest.json'), { force: true });
  rmSync(join(dir, 'export-deleted.txt'), { force: true });
  return manifest;
}

function walk(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, keep);
    return keep(full) ? [full] : [];
  });
}

/** Confluence order from the manifest: roots and children by weight, then title. */
function expectedTree(manifest) {
  const ids = new Set(manifest.pages.map((p) => p.id));
  const byWeight = (a, b) => (a.weight ?? 0) - (b.weight ?? 0) || a.title.localeCompare(b.title);
  const childrenOf = (id) => manifest.pages.filter((p) => (id === null ? !ids.has(p.parentId) : p.parentId === id)).sort(byWeight);
  const build = (id) => childrenOf(id).map((p) => ({ title: p.title, children: build(p.id) }));
  return build(null);
}

function flatten(nodes, depth, level = 0) {
  if (level >= depth) return [];
  return nodes.flatMap((n) => [`${'  '.repeat(level)}${n.title}`, ...flatten(n.children ?? [], depth, level + 1)]);
}

function reportOrder(label, actual, manifest, depth) {
  const want = flatten(expectedTree(manifest), depth);
  const got = flatten(actual, depth);
  console.log(`\n${label} order, top ${depth} levels (${got.length} entries):`);
  got.forEach((line) => console.log(`  ${line}`));
  const same = want.length === got.length && want.every((line, i) => line === got[i]);
  console.log(`order matches Confluence tree: ${same ? 'yes' : 'no'}`);
  if (!same) {
    console.log('Confluence tree:');
    want.forEach((line) => console.log(`  ${line}`));
  }
  return same;
}

function reportAdmonitions(preset, docsDir, siteDir) {
  const sources = walk(docsDir, (f) => f.endsWith('.md')).filter((f) => ADMONITION_SOURCE[preset].test(readFileSync(f, 'utf8')));
  const html = walk(siteDir, (f) => f.endsWith('.html')).map((f) => readFileSync(f, 'utf8'));
  const styled = html.map((text) => (text.match(ADMONITION_HTML[preset]) ?? []).length);
  const literal = html.filter((text) => /\[!(NOTE|TIP|WARNING|CAUTION)\]|:::(note|tip|warning|danger)|!!! (note|tip|warning|danger)/.test(text)).length;
  console.log(`\nadmonitions: ${sources.length} source pages with panels; ${styled.filter(Boolean).length} built pages with styled admonitions (${styled.reduce((a, b) => a + b, 0)} matches of ${ADMONITION_HTML[preset]}); ${literal} built pages showing literal markers`);
}

function ensureDocusaurus(workdir) {
  const site = join(workdir, 'docusaurus');
  if (!existsSync(join(site, 'package.json'))) {
    const created = run('npx', ['--yes', 'create-docusaurus@3', 'docusaurus', 'classic', '--javascript', '--skip-install'], workdir);
    if (created.status !== 0) throw new Error(`create-docusaurus failed:\n${created.output}`);
  }
  if (!existsSync(join(site, 'node_modules'))) {
    const installed = run('npm', ['install'], site);
    if (installed.status !== 0) throw new Error(`npm install failed:\n${installed.output}`);
  }
  return site;
}

const DOCUSAURUS_CONFIG = `export default {
  title: 'ArtUp Export check',
  url: 'https://example.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  presets: [['classic', { docs: { routeBasePath: '/', sidebarPath: './sidebars.js' }, blog: false }]],
};
`;

const DOCUSAURUS_HOME = `export default function Home() {
  return null;
}
`;

function docusaurusSidebar(site) {
  const dir = join(site, '.docusaurus', 'docusaurus-plugin-content-docs', 'default', 'p');
  const file = walk(dir, (f) => f.endsWith('.json')).find((f) => JSON.parse(readFileSync(f, 'utf8')).version?.docsSidebars);
  const sidebars = JSON.parse(readFileSync(file, 'utf8')).version.docsSidebars;
  const convert = (items) => items.map((item) => ({ title: item.label, children: item.items ? convert(item.items) : [] }));
  return convert(Object.values(sidebars)[0]);
}

function verifyDocusaurus(args) {
  const site = ensureDocusaurus(args.workdir);
  rmSync(join(site, 'blog'), { recursive: true, force: true });
  rmSync(join(site, 'src', 'pages'), { recursive: true, force: true });
  mkdirSync(join(site, 'src', 'pages'), { recursive: true });
  writeFileSync(join(site, 'src', 'pages', 'index.js'), DOCUSAURUS_HOME);
  ['build', '.docusaurus', join('node_modules', '.cache')].forEach((dir) => rmSync(join(site, dir), { recursive: true, force: true }));
  writeFileSync(join(site, 'docusaurus.config.js'), DOCUSAURUS_CONFIG);
  const manifest = unzipInto(args.zip, join(site, 'docs'));
  const build = run('npm', ['run', 'build'], site);
  console.log(build.output.split('\n').filter((line) => /\[(ERROR|WARNING|SUCCESS)\]|Error:|error/i.test(line)).slice(0, 60).join('\n'));
  console.log(`docusaurus build: ${build.status === 0 ? 'success' : `failed (exit ${build.status})`}`);
  if (build.status !== 0) return 1;
  reportOrder('docusaurus sidebar', docusaurusSidebar(site), manifest, args.depth);
  reportAdmonitions('docusaurus', join(site, 'docs'), join(site, 'build'));
  return 0;
}

const MKDOCS_HOOK = `import json

_nav = {}


def _is_index(item):
    return item.is_page and item.file.src_uri.rsplit("/", 1)[-1] == "index.md"


def _node(item):
    children = [c for c in (item.children or []) if not _is_index(c)]
    return {"title": item.title, "children": [_node(c) for c in children]}


def on_page_context(context, page, config, nav):
    _nav["items"] = nav.items
    return context


def on_post_build(config):
    with open("nav.json", "w", encoding="utf-8") as out:
        json.dump([_node(i) for i in _nav.get("items", [])], out, ensure_ascii=False)
`;

const MKDOCS_CONFIG = `site_name: ArtUp Export check
use_directory_urls: true
plugins:
  - awesome-pages
hooks:
  - navdump.py
markdown_extensions:
  - admonition
  - pymdownx.tasklist
  - tables
  - attr_list
  - md_in_html
  - pymdownx.superfences
  - pymdownx.tilde
  - pymdownx.escapeall:
      hardbreak: true
`;

function verifyMkdocs(args) {
  const venv = join(args.workdir, 'venv');
  if (!existsSync(join(venv, 'bin', 'mkdocs'))) {
    const created = run('python3', ['-m', 'venv', venv], args.workdir);
    const installed = created.status === 0 ? run(join(venv, 'bin', 'pip'), ['install', '-q', 'mkdocs', 'mkdocs-awesome-pages-plugin', 'pymdown-extensions'], args.workdir) : created;
    if (installed.status !== 0) throw new Error(`mkdocs install failed:\n${installed.output}`);
  }
  const site = join(args.workdir, 'mkdocs');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, 'mkdocs.yml'), MKDOCS_CONFIG);
  writeFileSync(join(site, 'navdump.py'), MKDOCS_HOOK);
  const manifest = unzipInto(args.zip, join(site, 'docs'));
  const build = run(join(venv, 'bin', 'mkdocs'), ['build'], site);
  const errors = build.output.split('\n').filter((line) => /^ERROR|Error:|Traceback/.test(line));
  const warnings = build.output.split('\n').filter((line) => /^WARNING/.test(line));
  console.log([...errors, ...warnings.slice(0, 20)].join('\n'));
  console.log(`mkdocs: ${warnings.length} warnings, ${errors.length} errors`);
  const ok = build.status === 0 && errors.length === 0;
  console.log(`mkdocs build: ${ok ? 'success' : `failed (exit ${build.status})`}`);
  if (!ok) return 1;
  reportOrder('mkdocs nav', JSON.parse(readFileSync(join(site, 'nav.json'), 'utf8')), manifest, args.depth);
  reportAdmonitions('mkdocs', join(site, 'docs'), join(site, 'site'));
  return 0;
}

const HUGO_CONFIG = `baseURL = 'https://example.com/'
title = 'ArtUp Export check'
disableKinds = ['taxonomy', 'term', 'RSS', 'sitemap']
`;
const HUGO_INDEX = `{{ range .Pages }}{{ .Title }}
{{ range .Pages }}  {{ .Title }}
{{ end }}{{ end }}`;
const HUGO_PAGE = '<!doctype html><html><body><h1>{{ .Title }}</h1>{{ .Content }}</body></html>\n';

function hugoBinary(workdir) {
  const found = run('hugo', ['version'], workdir);
  if (!found.error && found.status === 0) return 'hugo';
  const prefix = join(workdir, 'hugo-bin');
  const local = join(prefix, 'node_modules', '.bin', 'hugo');
  if (!existsSync(local)) run('npm', ['install', '--prefix', prefix, 'hugo-extended@latest'], workdir);
  const probe = existsSync(local) ? run(local, ['version'], workdir) : { status: 1 };
  return probe.status === 0 ? local : null;
}

function hugoTree(indexHtml) {
  const roots = [];
  for (const line of indexHtml.split('\n').filter((l) => l.trim())) {
    if (line.startsWith('  ')) roots[roots.length - 1]?.children.push({ title: line.trim(), children: [] });
    else roots.push({ title: line.trim(), children: [] });
  }
  return roots;
}

function verifyHugo(args) {
  const binary = hugoBinary(args.workdir);
  if (!binary) {
    console.log('hugo: not run');
    return 0;
  }
  const site = join(args.workdir, 'hugo');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, 'layouts', '_default'), { recursive: true });
  writeFileSync(join(site, 'hugo.toml'), HUGO_CONFIG);
  writeFileSync(join(site, 'layouts', 'index.html'), HUGO_INDEX);
  writeFileSync(join(site, 'layouts', '_default', 'single.html'), HUGO_PAGE);
  writeFileSync(join(site, 'layouts', '_default', 'list.html'), HUGO_PAGE);
  const manifest = unzipInto(args.zip, join(site, 'content'));
  const build = run(binary, ['--quiet', '--logLevel', 'warn'], site);
  console.log(build.output.split('\n').filter(Boolean).slice(0, 40).join('\n'));
  console.log(`${run(binary, ['version'], site).output.trim()}`);
  console.log(`hugo build: ${build.status === 0 ? 'success' : `failed (exit ${build.status})`}`);
  if (build.status !== 0) return 1;
  reportOrder('hugo section', hugoTree(readFileSync(join(site, 'public', 'index.html'), 'utf8')), manifest, Math.min(args.depth, 2));
  reportAdmonitions('hugo', join(site, 'content'), join(site, 'public'));
  return 0;
}

const VERIFY = { docusaurus: verifyDocusaurus, mkdocs: verifyMkdocs, hugo: verifyHugo };

try {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.workdir, { recursive: true });
  process.exitCode = VERIFY[args.preset](args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
