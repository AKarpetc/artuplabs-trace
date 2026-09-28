import { useCallback, useEffect, useMemo, useState } from 'react';
import { renderFrontMatter } from '../core/frontMatter.js';
import { MANIFEST_FILE } from '../core/manifest.js';
import { planPaths } from '../core/paths.js';
import { presetFiles } from '../core/presets.js';
import { scanTree } from '../export/tree.js';

const DEBOUNCE_MS = 300;
const PREVIEW_DEPTH = 2;
const IDLE = { status: 'idle', tree: null, first: null, error: null };

async function firstPageMeta(client, id, spaceKey, siteUrl) {
  const [[page], labels] = await Promise.all([client.getPages([id], { withBody: false }), client.getLabels(id)]);
  if (!page) return null;
  const authorId = page.version.authorId;
  const users = authorId ? await client.getUsers([authorId]).catch(() => new Map()) : new Map();
  return {
    id, title: page.title, spaceKey, parentId: page.parentId ?? null, version: page.version.number,
    author: users.get(authorId) ?? null, updated: page.version.createdAt, labels,
    url: `${siteUrl}/wiki/spaces/${spaceKey}/pages/${id}`,
  };
}

function countOf(client, target) {
  if (target.kind === 'page') return Promise.resolve(1);
  return client.countPages(target.spaceKey, target.kind === 'branch' ? target.pageId : undefined).catch(() => null);
}

/**
 * Live output preview: scans the target two levels deep (debounced), counts its pages through CQL,
 * and plans paths and the first page's front-matter for the current options and previous names.
 */
export function usePreview({ client, target, options, names, siteUrl }) {
  const [scan, setScan] = useState(IDLE);
  const [total, setTotal] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const { kind, spaceKey, pageId } = target;
  const needsPage = kind !== 'space' && !pageId;

  useEffect(() => {
    setTotal(null);
    if (needsPage || !spaceKey) {
      setScan(IDLE);
      return undefined;
    }
    let live = true;
    setScan((current) => ({ ...current, status: 'loading', error: null }));
    const scope = kind === 'space' ? { kind, spaceKey } : { kind, spaceKey, pageId };
    const timer = setTimeout(async () => {
      countOf(client, scope).then((count) => live && setTotal(count));
      try {
        const tree = await scanTree(client, scope, () => {}, undefined, { maxDepth: PREVIEW_DEPTH });
        const firstId = tree.rootIds[0];
        const first = firstId ? await firstPageMeta(client, firstId, spaceKey, siteUrl).catch(() => null) : null;
        if (live) setScan({ status: 'ready', tree, first, error: null });
      } catch (error) {
        if (live) setScan({ ...IDLE, status: 'error', error });
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, kind, spaceKey, pageId, needsPage, siteUrl, attempt]);

  const planned = useMemo(() => {
    if (!scan.tree) return null;
    const plan = planPaths(scan.tree, options, names);
    const extras = presetFiles(scan.tree, plan, options).map((file) => file.path);
    const paths = [...[...plan.values()].map((entry) => entry.path), ...extras, MANIFEST_FILE];
    const entry = scan.first ? plan.get(scan.first.id) : null;
    const frontMatter = entry ? renderFrontMatter({ ...scan.first, weight: entry.weight }, options) : null;
    return { paths, frontMatter, scanned: scan.tree.nodes.size };
  }, [scan, options, names]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    status: needsPage ? 'needs-page' : scan.status,
    error: scan.error,
    paths: planned?.paths ?? null,
    frontMatter: planned?.frontMatter ?? null,
    total,
    hiddenExtra: planned && total !== null ? Math.max(0, total - planned.scanned) : 0,
    retry,
  };
}
