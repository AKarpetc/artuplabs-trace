import { collectMentions, storageToMarkdown } from '../core/convert/index.js';
import { renderFrontMatter } from '../core/frontMatter.js';
import { planUpdate } from '../core/increment.js';
import { planAttachments, relativePath } from '../core/links.js';
import { buildManifest, DELETED_FILE, MANIFEST_FILE, previousNames, sameOptions, sameSource } from '../core/manifest.js';
import { planPaths } from '../core/paths.js';
import { presetFiles } from '../core/presets.js';
import { toSlug } from '../core/slug.js';
import { exportFileName } from '../infra/download.js';
import { createZipWriter } from '../infra/zip.js';
import { scanTree } from './tree.js';

/** Warning kinds the pipeline adds on top of the converter's WARNING_KINDS. */
export const PIPELINE_WARNING_KINDS = ['attachment-too-large', 'convert-failed'];

const CONVERT_FAILED = '<!-- confluence:convert-failed -->\n';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function guard(signal) {
  return async (promise) => {
    const value = await promise;
    throwIfAborted(signal);
    return value;
  };
}

async function loadMetadata(job) {
  const ids = [...job.tree.nodes.keys()];
  const rows = await job.wait(job.client.getPages(ids, { withBody: false }));
  const byId = new Map(rows.map((p) => [p.id, p]));
  const meta = new Map();
  for (const [id, node] of job.tree.nodes) {
    const page = byId.get(id) ?? { id, title: node.title, parentId: node.parentId, version: { number: 0, createdAt: '', authorId: null } };
    node.title = page.title;
    meta.set(id, page);
  }
  return meta;
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

async function collectAttachments(job) {
  const ids = [...job.tree.nodes.keys()];
  const lists = job.options.attachments === 'none'
    ? ids.map(() => [])
    : await job.wait(Promise.all(ids.map((id) => job.client.listAttachments(id))));
  const limit = sizeLimit(job.options);
  const candidates = new Map();
  const paths = new Map();
  const skipped = [];
  ids.forEach((id, index) => {
    const list = lists[index];
    paths.set(id, planAttachments(job.plan.get(id).path, list, job.options));
    candidates.set(id, list.filter((a) => a.fileSize <= limit));
    list.filter((a) => a.fileSize > limit).forEach((a) => skipped.push({ pageId: id, kind: 'attachment-too-large', detail: a.title }));
  });
  return { candidates, paths, skipped };
}

function restrictPaths(job, kept) {
  return new Map([...kept].map(([id, list]) => [id, new Map(list.map((a) => [a.id, job.attachments.paths.get(id).get(a.id)]))]));
}

function planChanges(job, kept) {
  const ids = [...job.tree.nodes.keys()];
  if (job.decision.mode === 'full') {
    const stats = { added: ids.length, changed: 0, moved: 0, relinked: 0, missing: 0, unchanged: 0 };
    return { fetchIds: new Set(ids), downloadIds: new Set([...kept.values()].flat().map((a) => a.id)), deletePaths: [], stats };
  }
  return planUpdate({
    previous: job.previousManifest,
    versions: new Map(ids.map((id) => [id, job.meta.get(id).version.number])),
    plan: job.plan,
    attachments: kept,
    attachmentPlan: restrictPaths(job, kept),
  });
}

async function fetchContent(job, fetchIds) {
  const ids = [...job.tree.nodes.keys()].filter((id) => fetchIds.has(id));
  const total = ids.length;
  job.onProgress({ stage: 'pages', done: 0, total });
  const rows = total ? await job.wait(job.client.getPages(ids, { withBody: true })) : [];
  const fetched = new Map(rows.map((p) => [p.id, p]));
  const pages = new Map(ids.map((id) => [id, fetched.get(id) ?? { ...job.meta.get(id), body: '' }]));
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

/** ConvertContext for one page: in-export links become relative paths, the rest point at Confluence. */
export function makeConvertContext(job, id, content, used) {
  const { plan, tree, siteUrl, spaceKey, titles, attachments } = job;
  const from = plan.get(id).path;
  const inExport = (ref) => (!ref.spaceKey || ref.spaceKey === spaceKey ? titles.get(ref.title) ?? null : null);
  return {
    siteUrl,
    resolvePage(ref) {
      const target = inExport(ref);
      if (target) return { id: target, href: relativePath(from, plan.get(target).path) };
      return { id: null, href: `${siteUrl}/wiki/display/${ref.spaceKey || spaceKey}/${encodeURIComponent(ref.title)}` };
    },
    resolveAttachment(filename, owner) {
      const ownerId = owner ? inExport(owner) : id;
      const found = ownerId ? attachments.candidates.get(ownerId).find((a) => a.title === filename) : null;
      if (!found) return null;
      used.add(found.id);
      return relativePath(from, attachments.paths.get(ownerId).get(found.id));
    },
    resolveUser: (userId) => content.users.get(userId) ?? null,
    childLinks: () => tree.nodes.get(id).childIds.map((c) => ({ title: tree.nodes.get(c).title, href: relativePath(from, plan.get(c).path) })),
  };
}

function convertOne(job, id, content, used) {
  try {
    return job.convert(content.pages.get(id).body ?? '', makeConvertContext(job, id, content, used));
  } catch (error) {
    return { markdown: CONVERT_FAILED, links: [], warnings: [{ kind: 'convert-failed', detail: String(error?.message ?? error) }] };
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
  const previousSets = new Map((job.previousManifest?.pages ?? []).map((p) => [p.id, new Set(p.attachments.map((a) => a.id))]));
  const referenced = job.options.attachments === 'referenced';
  return new Map([...job.attachments.candidates].map(([id, list]) => [id, referenced
    ? list.filter((a) => used.has(a.id) || (!fetchIds.has(id) && previousSets.get(id)?.has(a.id)))
    : list]));
}

async function writeAttachments(job, kept, downloadIds) {
  const items = [...kept].flatMap(([pageId, list]) => list.filter((a) => downloadIds.has(a.id)).map((a) => ({ pageId, attachment: a })));
  const total = items.length;
  let done = 0;
  job.onProgress({ stage: 'attachments', done, total });
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

/** Runs a full or update export in the browser and returns the zip with stats and warnings. */
export async function runExport({ client, target, options, previousManifest, siteUrl, signal, onProgress, now, convert = storageToMarkdown }) {
  throwIfAborted(signal);
  const source = { siteUrl, spaceKey: target.spaceKey, rootPageId: target.kind === 'space' ? null : target.pageId };
  const job = { client, target, options, previousManifest, siteUrl, spaceKey: target.spaceKey, source, onProgress, convert, wait: guard(signal) };
  job.tree = await job.wait(scanTree(client, target, onProgress, signal));
  job.meta = await loadMetadata(job);
  job.titles = new Map([...job.tree.nodes.values()].reverse().map((n) => [n.title, n.id]));
  job.decision = decideMode(previousManifest, source, options);
  job.plan = planPaths(job.tree, options, job.decision.names);
  job.attachments = await collectAttachments(job);
  const { fetchIds, stats } = planChanges(job, job.attachments.candidates);
  const content = await fetchContent(job, fetchIds);
  job.zip = createZipWriter();
  const used = new Set();
  const converted = writePages(job, content, used);
  const kept = keptAttachments(job, used, fetchIds);
  const { downloadIds, deletePaths } = planChanges(job, kept);
  const attachments = await writeAttachments(job, kept, downloadIds);
  const warnings = collectWarnings(job, converted);
  const blob = await pack(job, finalManifestPages(job, content, converted, kept), warnings, deletePaths);
  return {
    blob,
    fileName: fileNameOf(job, now),
    mode: job.decision.mode,
    fullReason: job.decision.fullReason,
    stats: { pages: job.tree.nodes.size, written: converted.size, attachments, skippedAttachments: job.attachments.skipped.length, deleted: deletePaths.length, ...stats, bytes: blob.size },
    warnings: reportWarnings(job, warnings),
    deletePaths,
  };
}
