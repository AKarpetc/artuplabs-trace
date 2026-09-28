import { collectMentions, storageToMarkdown } from '../core/convert/index.js';
import { renderFrontMatter } from '../core/frontMatter.js';
import { planUpdate } from '../core/increment.js';
import { planAttachments, relativePath } from '../core/links.js';
import { buildManifest, DELETED_FILE, isSafePath, MANIFEST_FILE, previousNames, sameOptions, sameSource } from '../core/manifest.js';
import { planPaths } from '../core/paths.js';
import { presetFiles, presetOf } from '../core/presets.js';
import { toSlug } from '../core/slug.js';
import { exportFileName } from '../infra/download.js';
import { createZipWriter } from '../infra/zip.js';
import { scanTree } from './tree.js';

/** Warning kinds the pipeline adds on top of the converter's WARNING_KINDS. */
export const PIPELINE_WARNING_KINDS = ['attachment-too-large', 'convert-failed'];

const CONVERT_FAILED = '<!-- confluence:convert-failed -->\n';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const abortError = () => new DOMException('Aborted', 'AbortError');

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function guard(signal) {
  const aborted = new Promise((resolve, reject) => {
    if (signal?.aborted) reject(abortError());
    else signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
  aborted.catch(() => {});
  return async (promise) => {
    const value = await Promise.race([promise, aborted]);
    throwIfAborted(signal);
    return value;
  };
}

function dropNodes(job, ids) {
  const { nodes, rootIds } = job.tree;
  for (const id of ids) {
    const node = nodes.get(id);
    if (!node) continue;
    const parent = nodes.get(node.parentId);
    const siblings = parent ? parent.childIds : rootIds;
    siblings.splice(siblings.indexOf(id), 1, ...node.childIds);
    node.childIds.forEach((c) => {
      nodes.get(c).parentId = node.parentId;
    });
    nodes.delete(id);
    job.meta.delete(id);
    job.vanished.add(id);
  }
}

async function loadMetadata(job) {
  const ids = [...job.tree.nodes.keys()];
  const rows = ids.length ? await job.wait(job.client.getPages(ids, { withBody: false })) : [];
  job.tick(rows.length);
  job.meta = new Map(rows.map((p) => [p.id, p]));
  dropNodes(job, ids.filter((id) => !job.meta.has(id)));
  for (const [id, node] of job.tree.nodes) node.title = job.meta.get(id).title;
}

/** Update when the previous manifest has the same source and path options; otherwise full, with the reason. */
export function decideMode(previousManifest, source, options) {
  if (!previousManifest) return { mode: 'full', fullReason: null, names: new Map() };
  if (!sameSource(previousManifest, source)) return { mode: 'full', fullReason: 'other-source', names: new Map() };
  const names = previousNames(previousManifest);
  if (!sameOptions(previousManifest, options)) return { mode: 'full', fullReason: 'options-changed', names };
  return { mode: 'update', fullReason: null, names };
}

function sizeLimit(options) {
  const mb = Number(options.maxAttachmentMb);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : Infinity;
}

async function listAttachmentsOnce(job) {
  if (job.options.attachments === 'none') return;
  const ids = [...job.tree.nodes.keys()].filter((id) => !job.lists.has(id));
  await job.wait(Promise.all(ids.map(async (id) => {
    job.lists.set(id, await job.client.listAttachments(id));
    job.tick(1);
  })));
}

function collectAttachments(job) {
  const limit = sizeLimit(job.options);
  const candidates = new Map();
  const paths = new Map();
  const skipped = [];
  for (const id of job.tree.nodes.keys()) {
    const list = job.lists.get(id) ?? [];
    paths.set(id, planAttachments(job.plan.get(id).path, list, job.options));
    candidates.set(id, list.filter((a) => a.fileSize <= limit));
    list.filter((a) => a.fileSize > limit).forEach((a) => skipped.push({ pageId: id, kind: 'attachment-too-large', detail: a.title }));
  }
  return { candidates, paths, skipped };
}

function restrictPaths(job, kept) {
  return new Map([...kept].map(([id, list]) => [id, new Map(list.map((a) => [a.id, job.attachments.paths.get(id).get(a.id)]))]));
}

function planFull(job, kept) {
  const ids = [...job.tree.nodes.keys()];
  const stats = { added: ids.length, changed: 0, moved: 0, relinked: 0, missing: 0, unchanged: 0 };
  const result = { fetchIds: new Set(ids), downloadIds: new Set([...kept.values()].flat().map((a) => a.id)), deletePaths: [], stats };
  if (job.decision.fullReason !== 'options-changed') return result;
  const written = new Set([...job.plan.values()].map((p) => p.path));
  restrictPaths(job, kept).forEach((map) => map.forEach((path) => written.add(path)));
  const previous = job.previousManifest.pages;
  const old = new Set(previous.flatMap((p) => [p.path, ...p.attachments.map((a) => a.path)]));
  stats.missing = previous.filter((p) => !job.tree.nodes.has(p.id)).length;
  return { ...result, deletePaths: [...old].filter((p) => !written.has(p)).sort() };
}

function refetchChangedChildLists(job, result) {
  const previous = new Map();
  [...job.previousManifest.pages].sort((a, b) => a.weight - b.weight).forEach((p) => {
    if (p.parentId) previous.set(p.parentId, [...(previous.get(p.parentId) ?? []), p.id]);
  });
  const fetchIds = new Set(result.fetchIds);
  const stats = { ...result.stats };
  for (const [id, node] of job.tree.nodes) {
    if (fetchIds.has(id) || (previous.get(id) ?? []).join(',') === node.childIds.join(',')) continue;
    fetchIds.add(id);
    stats.relinked += 1;
    stats.unchanged -= 1;
  }
  return { ...result, fetchIds, stats };
}

function planChanges(job, kept) {
  if (job.decision.mode === 'full') return planFull(job, kept);
  const ids = [...job.tree.nodes.keys()];
  return refetchChangedChildLists(job, planUpdate({
    previous: job.previousManifest,
    versions: new Map(ids.map((id) => [id, job.meta.get(id).version.number])),
    plan: job.plan,
    attachments: kept,
    attachmentPlan: restrictPaths(job, kept),
  }));
}

async function prepare(job) {
  job.titles = new Map([...job.tree.nodes.values()].reverse().map((n) => [n.title, n.id]));
  job.plan = planPaths(job.tree, job.options, job.decision.names);
  await listAttachmentsOnce(job);
  job.attachments = collectAttachments(job);
  return planChanges(job, job.attachments.candidates);
}

async function fetchContent(job, fetchIds) {
  const ids = [...job.tree.nodes.keys()].filter((id) => fetchIds.has(id));
  const total = ids.length;
  job.onProgress({ stage: 'pages', done: 0, total });
  const rows = total ? await job.wait(job.client.getPages(ids, { withBody: true })) : [];
  const pages = new Map(rows.map((p) => [p.id, p]));
  const vanished = ids.filter((id) => !pages.has(id));
  if (vanished.length) {
    dropNodes(job, vanished);
    return null;
  }
  let done = 0;
  const labels = await job.wait(Promise.all(ids.map(async (id) => {
    const list = await job.client.getLabels(id);
    done += 1;
    job.onProgress({ stage: 'pages', done, total });
    return list;
  })));
  const wanted = new Set(ids.map((id) => pages.get(id).version.authorId).filter(Boolean));
  ids.forEach((id) => collectMentions(pages.get(id).body).forEach((m) => wanted.add(m)));
  const users = wanted.size ? await job.wait(job.client.getUsers([...wanted])) : new Map();
  return { ids, pages, labels: new Map(ids.map((id, i) => [id, labels[i]])), users };
}

/** ConvertContext for one page: in-export links become relative paths, the rest point at Confluence; child and attachment-owner ids go to `linked`. */
export function makeConvertContext(job, id, content, used, linked) {
  const { plan, tree, siteUrl, spaceKey, titles, attachments } = job;
  const from = plan.get(id).path;
  const inExport = (ref) => (!ref.spaceKey || ref.spaceKey === spaceKey ? titles.get(ref.title) ?? null : null);
  return {
    siteUrl,
    flavor: presetOf(job.options.preset).flavor,
    resolvePage(ref) {
      const target = inExport(ref);
      if (target) return { id: target, href: relativePath(from, plan.get(target).path) };
      return { id: null, href: `${siteUrl}/wiki/display/${ref.spaceKey || spaceKey}/${encodeURIComponent(ref.title)}` };
    },
    resolveAttachment(filename, owner) {
      const ownerId = owner ? inExport(owner) : id;
      if (ownerId && ownerId !== id) linked.add(ownerId);
      const found = ownerId ? attachments.candidates.get(ownerId).find((a) => a.title === filename) : null;
      if (!found) return null;
      used.add(found.id);
      return relativePath(from, attachments.paths.get(ownerId).get(found.id));
    },
    resolveUser: (userId) => content.users.get(userId) ?? null,
    childLinks: () => tree.nodes.get(id).childIds.map((c) => {
      linked.add(c);
      return { title: tree.nodes.get(c).title, href: relativePath(from, plan.get(c).path) };
    }),
  };
}

function convertOne(job, id, content, used) {
  const linked = new Set();
  try {
    const result = job.convert(content.pages.get(id).body ?? '', makeConvertContext(job, id, content, used, linked));
    return { ...result, links: [...result.links, ...linked] };
  } catch (error) {
    return { markdown: CONVERT_FAILED, links: [...linked], warnings: [{ kind: 'convert-failed', detail: String(error?.message ?? error) }] };
  }
}

function frontMatterOf(job, id, content) {
  const page = content.pages.get(id);
  const { spaceKey, siteUrl } = job;
  return renderFrontMatter({
    id, title: page.title, spaceKey, parentId: page.parentId ?? null, version: page.version.number,
    author: content.users.get(page.version.authorId) ?? null, updated: page.version.createdAt,
    labels: content.labels.get(id), url: `${siteUrl}/wiki/spaces/${spaceKey}/pages/${id}`, weight: job.plan.get(id).weight,
  }, job.options);
}

function writePages(job, content, used) {
  const converted = new Map();
  for (const id of content.ids) {
    const result = convertOne(job, id, content, used);
    const mtime = new Date(content.pages.get(id).version.createdAt);
    job.zip.addText(job.plan.get(id).path, frontMatterOf(job, id, content) + result.markdown, mtime);
    converted.set(id, { links: result.links, warnings: result.warnings.map((w) => ({ pageId: id, kind: w.kind, detail: w.detail })) });
  }
  return converted;
}

function keptAttachments(job, used, fetchIds) {
  if (job.options.attachments !== 'referenced') return job.attachments.candidates;
  const previous = new Map((job.previousManifest?.pages ?? []).map((p) => [p.id, p]));
  const unchanged = [...job.tree.nodes.keys()].filter((id) => !fetchIds.has(id));
  const linkedByUnchanged = new Set(unchanged.flatMap((id) => previous.get(id)?.links ?? []));
  return new Map([...job.attachments.candidates].map(([id, list]) => {
    const keepPrevious = !fetchIds.has(id) || linkedByUnchanged.has(id);
    const old = new Set(keepPrevious ? (previous.get(id)?.attachments ?? []).map((a) => a.id) : []);
    return [id, list.filter((a) => used.has(a.id) || old.has(a.id))];
  }));
}

async function writeAttachments(job, kept, downloadIds) {
  const items = [...kept].flatMap(([pageId, list]) => list.filter((a) => downloadIds.has(a.id)).map((a) => ({ pageId, attachment: a })));
  const total = items.length;
  let done = 0;
  job.onProgress({ stage: 'attachments', done, total });
  throwIfAborted(job.signal);
  const blobs = await job.wait(Promise.all(items.map(async ({ attachment }) => {
    const bytes = await job.client.download(attachment.downloadLink);
    done += 1;
    job.onProgress({ stage: 'attachments', done, total });
    return bytes;
  })));
  items.forEach(({ pageId, attachment }, index) => {
    job.zip.addBinary(job.attachments.paths.get(pageId).get(attachment.id), blobs[index], new Date(attachment.createdAt));
  });
  return total;
}

/** Manifest entries for every exported page: fetched pages carry new links, unchanged ones keep the previous links. */
export function finalManifestPages(job, content, converted, kept) {
  const previous = new Map((job.previousManifest?.pages ?? []).map((p) => [p.id, p]));
  return [...job.tree.nodes.keys()].map((id) => {
    const page = content.pages.get(id) ?? job.meta.get(id);
    const { path, name, weight } = job.plan.get(id);
    const links = converted.has(id) ? converted.get(id).links : previous.get(id)?.links ?? [];
    const attachments = kept.get(id).map((a) => ({ id: a.id, version: a.version, path: job.attachments.paths.get(id).get(a.id) }));
    return { id, title: page.title, parentId: page.parentId ?? null, version: page.version.number, path, name, weight, links, attachments };
  });
}

function collectWarnings(job, converted) {
  const carried = job.decision.mode === 'update'
    ? job.previousManifest.warnings?.filter((w) => job.tree.nodes.has(w.pageId) && !converted.has(w.pageId) && w.kind !== 'attachment-too-large') ?? []
    : [];
  return [...carried, ...[...converted.values()].flatMap((c) => c.warnings), ...job.attachments.skipped];
}

function reportWarnings(job, warnings) {
  return warnings
    .map((w) => ({ pageId: w.pageId, title: job.tree.nodes.get(w.pageId).title, kind: w.kind, detail: w.detail }))
    .sort((a, b) => byText(a.title, b.title) || byText(a.kind, b.kind) || byText(a.detail, b.detail));
}

async function pack(job, manifestPages, warnings, deletePaths) {
  job.onProgress({ stage: 'pack', done: 0, total: 1 });
  presetFiles(job.tree, job.plan, job.options).forEach((f) => job.zip.addText(f.path, f.content));
  job.zip.addText(MANIFEST_FILE, buildManifest({ ...job.source, options: job.options, pages: manifestPages, warnings }));
  if (deletePaths.length) job.zip.addText(DELETED_FILE, `${deletePaths.join('\n')}\n`);
  const blob = await job.wait(job.zip.finish());
  job.onProgress({ stage: 'pack', done: 1, total: 1 });
  return blob;
}

function fileNameOf(job, now) {
  const { target, tree, decision } = job;
  const root = target.kind === 'space' ? '' : toSlug(tree.nodes.get(target.pageId)?.title) || target.pageId;
  return exportFileName({ spaceKey: target.spaceKey, rootSlug: root, mode: decision.mode, now });
}

function statsOf(job, stats, extra) {
  const planned = job.decision.mode === 'update' || job.decision.fullReason === 'options-changed';
  const known = new Set(planned ? job.previousManifest.pages.map((p) => p.id) : []);
  const vanished = [...job.vanished].filter((id) => !known.has(id)).length;
  return { pages: job.tree.nodes.size, ...extra, ...stats, missing: stats.missing + vanished };
}

function createJob({ client, target, options, previousManifest, siteUrl, signal, onProgress, convert }) {
  const source = { siteUrl, spaceKey: target.spaceKey, rootPageId: target.kind === 'space' ? null : target.pageId };
  const emit = (progress) => {
    if (!signal?.aborted) onProgress(progress);
  };
  const job = { client, target, options, previousManifest, siteUrl, spaceKey: target.spaceKey, source, signal, onProgress: emit, convert };
  let scanned = 0;
  job.startTicks = () => {
    scanned = job.tree.nodes.size;
  };
  job.tick = (n) => {
    scanned += n;
    emit({ stage: 'scan', done: scanned, total: 0 });
  };
  return Object.assign(job, { wait: guard(signal), vanished: new Set(), lists: new Map(), decision: decideMode(previousManifest, source, options) });
}

/**
 * Runs a full or update export in the browser and returns the zip with stats and warnings.
 * `client` must be created with the same `signal` so in-flight requests stop on cancel.
 */
export async function runExport({ client, target, options, previousManifest, siteUrl, signal, onProgress, now, convert = storageToMarkdown }) {
  throwIfAborted(signal);
  const job = createJob({ client, target, options, previousManifest, siteUrl, signal, onProgress, convert });
  job.tree = await job.wait(scanTree(client, target, job.onProgress, signal));
  job.startTicks();
  await loadMetadata(job);
  let changes;
  let content = null;
  while (!content) {
    changes = await prepare(job);
    content = await fetchContent(job, changes.fetchIds);
  }
  job.zip = createZipWriter();
  const used = new Set();
  const converted = writePages(job, content, used);
  const kept = keptAttachments(job, used, changes.fetchIds);
  const { downloadIds, deletePaths: planned } = planChanges(job, kept);
  const deletePaths = planned.filter(isSafePath);
  const attachments = await writeAttachments(job, kept, downloadIds);
  const warnings = collectWarnings(job, converted);
  const blob = await pack(job, finalManifestPages(job, content, converted, kept), warnings, deletePaths);
  const extra = { written: converted.size, attachments, skippedAttachments: job.attachments.skipped.length, deleted: deletePaths.length, bytes: blob.size };
  return {
    blob,
    fileName: fileNameOf(job, now),
    mode: job.decision.mode,
    fullReason: job.decision.fullReason,
    stats: statsOf(job, changes.stats, extra),
    warnings: reportWarnings(job, warnings),
    deletePaths,
  };
}
