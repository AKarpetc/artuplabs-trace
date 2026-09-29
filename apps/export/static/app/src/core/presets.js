/** Output presets: index file name, front-matter order key, extra navigation files and the Markdown flavor the converter writes. */
export const PRESETS = {
  generic: { indexFile: 'index.md', orderKey: 'weight', extras: null, flavor: 'gfm' },
  hugo: { indexFile: '_index.md', orderKey: 'weight', extras: null, flavor: 'gfm' },
  docusaurus: { indexFile: 'index.md', orderKey: 'sidebar_position', extras: 'category', flavor: 'mdx' },
  mkdocs: { indexFile: 'index.md', orderKey: null, extras: 'pages', flavor: 'mkdocs' },
};

/** Default export options shown in the studio. */
export const DEFAULT_OPTIONS = {
  preset: 'generic', ordering: 'weight', fileNames: 'ascii', attachments: 'all', maxAttachmentMb: 50,
};

/** Preset by key; unknown keys fall back to generic. */
export function presetOf(key) {
  return PRESETS[key] ?? PRESETS.generic;
}

/** YAML double-quoted scalar with escapes for quotes, backslashes and control characters. */
export function yamlString(value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `"${escaped}"`;
}

function dirOf(path) {
  return path.split('/').slice(0, -1).join('/');
}

function entryName(entry) {
  const parts = entry.path.split('/');
  return entry.isIndex ? parts[parts.length - 2] : parts[parts.length - 1];
}

function dirOfEntry(entry) {
  return entry.isFolder ? entry.path : dirOf(entry.path);
}

function categoryFiles(tree, plan) {
  return [...plan].filter(([, entry]) => entry.isIndex || entry.isFolder).map(([id, entry]) => ({
    path: `${dirOfEntry(entry)}/_category_.json`,
    content: `${JSON.stringify({ label: tree.nodes.get(id).title, position: entry.weight }, null, 2)}\n`,
  }));
}

function pagesFile(dir, title, indexFile, childIds, plan) {
  const nav = [...(indexFile === null ? [] : [indexFile]), ...childIds.map((id) => entryName(plan.get(id)))];
  const head = title === null ? '' : `title: ${yamlString(title)}\n`;
  return {
    path: dir ? `${dir}/.pages` : '.pages',
    content: `${head}nav:\n${nav.map((n) => `  - ${yamlString(n)}`).join('\n')}\n`,
  };
}

function mkdocsFiles(tree, plan, preset) {
  const files = [pagesFile('', null, null, tree.rootIds, plan)];
  const visit = (ids) => {
    for (const id of ids) {
      const entry = plan.get(id);
      const node = tree.nodes.get(id);
      if (!entry.isIndex && !entry.isFolder) continue;
      files.push(pagesFile(dirOfEntry(entry), node.title, entry.isFolder ? null : preset.indexFile, node.childIds, plan));
      visit(node.childIds);
    }
  };
  visit(tree.rootIds);
  return files;
}

/** Extra navigation files a preset needs, in a stable order. */
export function presetFiles(tree, plan, options) {
  const preset = presetOf(options.preset);
  if (preset.extras === 'category') return categoryFiles(tree, plan);
  if (preset.extras === 'pages') return mkdocsFiles(tree, plan, preset);
  return [];
}
