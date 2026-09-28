import { presetOf, yamlString } from './presets.js';

export { yamlString };

/** YAML front-matter for a page; contains no export time so repeated exports are identical. */
export function renderFrontMatter(meta, options) {
  const { orderKey } = presetOf(options.preset);
  const labels = [...meta.labels].sort();
  const lines = ['---', `title: ${yamlString(meta.title)}`, `confluence_id: ${yamlString(meta.id)}`, `space: ${yamlString(meta.spaceKey)}`];
  if (meta.parentId) lines.push(`parent_id: ${yamlString(meta.parentId)}`);
  lines.push(`version: ${Number(meta.version)}`);
  if (meta.author) lines.push(`author: ${yamlString(meta.author)}`);
  lines.push(`updated: ${yamlString(meta.updated)}`);
  if (orderKey) lines.push(`${orderKey}: ${meta.weight}`);
  lines.push(labels.length ? `labels:\n${labels.map((l) => `  - ${yamlString(l)}`).join('\n')}` : 'labels: []');
  lines.push(`source: ${yamlString(meta.url)}`, '---', '');
  return lines.join('\n');
}
