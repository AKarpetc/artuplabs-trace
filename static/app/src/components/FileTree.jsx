import { useMemo } from 'react';
import { Box, xcss } from '@atlaskit/primitives';
import { token } from '@atlaskit/tokens';
import { useT } from '../i18n/index.js';
import { AttachmentIcon, FolderClosedIcon, ImageIcon, PageIcon } from './icons.js';

const IMAGE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

const GLYPHS = {
  folder: { Icon: FolderClosedIcon, color: 'color.icon.accent.blue' },
  markdown: { Icon: PageIcon, color: 'color.icon.subtle' },
  image: { Icon: ImageIcon, color: 'color.icon.accent.purple' },
  attachment: { Icon: AttachmentIcon, color: 'color.icon.accent.purple' },
};

const treeStyles = xcss({
  padding: 'space.200',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.sunken',
  fontFamily: 'font.family.code',
  fontSize: '12px',
  lineHeight: '20px',
  overflowWrap: 'anywhere',
  minWidth: '0',
});
const listStyles = xcss({ listStyle: 'none', margin: '0', padding: '0' });
const nestedStyles = xcss({
  listStyle: 'none',
  margin: '0',
  padding: '0',
  marginInlineStart: 'space.100',
  paddingInlineStart: '7px',
  borderInlineStartWidth: 'border.width',
  borderInlineStartStyle: 'solid',
  borderInlineStartColor: 'color.border',
  ':nth-of-type(n)': { marginBlockStart: '0' },
});
const itemStyles = xcss({ margin: '0', minWidth: '0' });
const rowStyles = xcss({ display: 'flex', alignItems: 'stretch', minWidth: '0' });
const glyphStyles = xcss({ flexShrink: 0, paddingBlock: 'space.025', paddingInlineEnd: 'space.075', lineHeight: '0' });
const folderNameStyles = xcss({ color: 'color.text', fontWeight: 'font.weight.medium', minWidth: '0' });
const fileNameStyles = xcss({ color: 'color.text.subtle', minWidth: '0' });
const moreStyles = xcss({ color: 'color.text.subtlest', paddingInlineStart: 'space.300', paddingBlockStart: 'space.050' });

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function fileKind(name) {
  if (name.toLowerCase().endsWith('.md')) return 'markdown';
  return IMAGE.test(name) ? 'image' : 'attachment';
}

function buildTree(paths) {
  const root = { folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = String(path).split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) continue;
    let node = root;
    for (const part of parts) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(name);
  }
  return root;
}

function flatten(node, depth, rows) {
  for (const name of [...node.folders.keys()].sort(compare)) {
    rows.push({ kind: 'folder', name, depth, key: `${rows.length}:${name}/` });
    flatten(node.folders.get(name), depth + 1, rows);
  }
  for (const name of [...node.files].sort(compare)) {
    rows.push({ kind: fileKind(name), name, depth, key: `${rows.length}:${name}` });
  }
  return rows;
}

/** Keeps rows until `limit` files are shown, then drops folders left without a visible file. */
function visibleRows(rows, limit) {
  const shown = [];
  let files = 0;
  for (const row of rows) {
    if (row.kind !== 'folder' && files >= limit) break;
    if (row.kind !== 'folder') files += 1;
    shown.push(row);
  }
  while (shown.length > 0 && shown[shown.length - 1].kind === 'folder' && files < rows.filter((r) => r.kind !== 'folder').length) {
    shown.pop();
  }
  return { shown, files };
}

/** Turns depth-first rows into nested nodes: each folder row gets the rows below it as `children`. */
function nest(rows) {
  const root = [];
  const stack = [root];
  for (const row of rows) {
    stack.length = row.depth + 1;
    const node = { ...row, children: [] };
    stack[row.depth].push(node);
    if (row.kind === 'folder') stack[row.depth + 1] = node.children;
  }
  return root;
}

/** One list level: rows as list items, folders carrying a nested list whose border is the indentation guide. */
function Level({ nodes, label, root = false }) {
  return (
    <Box as="ul" aria-label={label} xcss={root ? listStyles : nestedStyles}>
      {nodes.map((node) => {
        const { Icon, color } = GLYPHS[node.kind];
        return (
          <Box as="li" key={node.key} xcss={itemStyles}>
            <Box data-kind={node.kind === 'image' ? 'attachment' : node.kind} data-depth={node.depth} testId="file-tree-row" xcss={rowStyles}>
              <Box as="span" xcss={glyphStyles}>
                <Icon label="" color={token(color)} />
              </Box>
              <Box as="span" xcss={node.kind === 'folder' ? folderNameStyles : fileNameStyles}>{node.name}</Box>
            </Box>
            {node.children.length > 0 ? <Level nodes={node.children} /> : null}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Monospace preview of export paths as a folder tree with indentation guides; beyond
 * `limit` files it shows a "+N more" row whose text comes from `moreLabel` (string or count => string).
 * Rendered as nested labelled lists (`label` or the translated default); `hiddenExtra` counts files not in `paths`.
 */
export function FileTree({ paths, limit = 14, moreLabel, label, hiddenExtra = 0 }) {
  const t = useT();
  const { shown, hidden } = useMemo(() => {
    const rows = flatten(buildTree(paths ?? []), 0, []);
    const total = rows.filter((row) => row.kind !== 'folder').length;
    const visible = visibleRows(rows, Math.max(0, limit));
    return { shown: nest(visible.shown), hidden: total - visible.files + Math.max(0, hiddenExtra) };
  }, [paths, limit, hiddenExtra]);
  const more = typeof moreLabel === 'function' ? moreLabel(hidden) : moreLabel ?? t('fileTree.more', { count: hidden });
  return (
    <Box xcss={treeStyles}>
      <Level nodes={shown} label={label ?? t('fileTree.label')} root />
      {hidden > 0 ? <Box testId="file-tree-more" xcss={moreStyles}>{more}</Box> : null}
    </Box>
  );
}
