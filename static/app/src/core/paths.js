import { toSlug } from './slug.js';
import { presetOf } from './presets.js';

function byNumericId(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function join(...parts) {
  return parts.filter(Boolean).join('/');
}

function nameSiblings(ids, nodes, options, previousNames) {
  const base = (id) => toSlug(nodes.get(id).title, options) || `page-${id}`;
  const taken = new Set();
  const names = new Map();
  for (const id of ids) {
    const previous = previousNames.get(id);
    const plain = base(id);
    if ((previous === plain || previous === `${plain}-${id}`) && !taken.has(previous.toLowerCase())) {
      names.set(id, previous);
      taken.add(previous.toLowerCase());
    }
  }
  for (const id of ids.filter((x) => !names.has(x)).sort(byNumericId)) {
    const plain = base(id);
    let name = taken.has(plain) ? `${plain}-${id}` : plain;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${plain}-${id}-${n}`;
    names.set(id, name);
    taken.add(name.toLowerCase());
  }
  return names;
}

/** Plans a stable file path per page: parents become folders with an index file, leaves become .md files. */
export function planPaths(tree, options, previousNames) {
  const preset = presetOf(options.preset);
  const plan = new Map();
  const walk = (ids, dir) => {
    const names = nameSiblings(ids, tree.nodes, options, previousNames);
    const width = Math.max(3, String(ids.length * 10).length);
    ids.forEach((id, index) => {
      const node = tree.nodes.get(id);
      const weight = (index + 1) * 10;
      const name = names.get(id);
      const shown = options.ordering === 'prefix' ? `${String(weight).padStart(width, '0')}-${name}` : name;
      const isIndex = node.childIds.length > 0;
      plan.set(id, { path: isIndex ? join(dir, shown, preset.indexFile) : join(dir, `${shown}.md`), name, weight, isIndex });
      if (isIndex) walk(node.childIds, join(dir, shown));
    });
  };
  walk(tree.rootIds, '');
  return plan;
}
