import { adfToModel, blocksToText } from './adf.js';
import { resolveColumn } from './columns.js';
import { cellValue, resolveField } from './fields.js';
import { createMediaResolver } from './media.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const DATETIME = { type: 'datetime' };

function display(cell, formats, warnings) {
  if (cell.kind === 'date') return formats.date(cell.value);
  if (cell.kind === 'datetime') return formats.dateTime(cell.value);
  if (cell.kind === 'adf') {
    const result = adfToModel(cell.value, { formatDate: (ms) => formats.date(new Date(ms)) });
    warnings.push(...result.warnings);
    return blocksToText(result.blocks);
  }
  return cell.text;
}

function collectImages(blocks, into) {
  for (const b of blocks) {
    if (b.type === 'image' && b.attachmentId) into.add(b.attachmentId);
    collectImages(b.blocks ?? [], into);
    for (const item of b.items ?? []) collectImages(item.blocks, into);
    for (const row of b.rows ?? []) for (const cell of row.cells) collectImages(cell.blocks, into);
  }
}

function withFileCards(blocks, files) {
  return blocks.map((b) => {
    if (b.type === 'image') return files.has(b.attachmentId) ? { type: 'para', runs: [{ text: files.get(b.attachmentId) }] } : b;
    const out = { ...b };
    if (b.blocks) out.blocks = withFileCards(b.blocks, files);
    if (b.items) out.items = b.items.map((item) => ({ ...item, blocks: withFileCards(item.blocks, files) }));
    if (b.rows) out.rows = b.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: withFileCards(c.blocks, files) })) }));
    return out;
  });
}

function linkOf(link, siteUrl) {
  const outward = Boolean(link.outwardIssue);
  const other = link.outwardIssue ?? link.inwardIssue ?? {};
  return {
    type: (outward ? link.type?.outward : link.type?.inward) ?? '',
    direction: outward ? 'outward' : 'inward',
    key: other.key ?? '',
    summary: other.fields?.summary ?? '',
    status: other.fields?.status?.name ?? '',
    url: `${siteUrl}/browse/${other.key ?? ''}`,
  };
}

/** Turns a bulkfetch issue into display strings and document blocks for layouts and Word templates; a non-image file card becomes its file name. */
export function prepareIssue(issue, { catalog, siteUrl, formats, fieldNames = [] }) {
  const f = issue.fields ?? {};
  const rendered = issue.renderedFields ?? {};
  const attachments = (f.attachment ?? []).map((a) => ({ id: String(a.id), filename: a.filename, mimeType: a.mimeType }));
  const files = new Map(attachments.filter((a) => !IMAGE_TYPES.has(a.mimeType)).map((a) => [a.id, a.filename ?? '']));
  const warnings = [];
  const inline = new Set();
  const convert = (doc, html) => {
    if (!doc) return [];
    const result = adfToModel(doc, { resolveMedia: createMediaResolver(attachments, html), formatDate: (ms) => formats.date(new Date(ms)) });
    warnings.push(...result.warnings);
    const blocks = files.size ? withFileCards(result.blocks, files) : result.blocks;
    collectImages(blocks, inline);
    return blocks;
  };
  const text = (id) => (id ? display(cellValue(catalog.byId.get(id) ?? null, Object.hasOwn(f, id) ? f[id] : null), formats, warnings) : '');
  const when = (raw) => display(cellValue(DATETIME, raw), formats, warnings);
  const points = resolveColumn(catalog, '@storyPoints');
  const sprint = resolveColumn(catalog, '@sprint');
  const pointsRaw = points.missing ? null : f[points.id];
  const prepared = {
    id: String(issue.id),
    key: issue.key,
    url: `${siteUrl}/browse/${issue.key}`,
    summary: f.summary ?? '',
    type: text('issuetype'),
    status: text('status'),
    priority: text('priority'),
    assignee: text('assignee'),
    reporter: text('reporter'),
    created: text('created'),
    updated: text('updated'),
    due: text('duedate'),
    resolved: text('resolutiondate'),
    resolution: text('resolution'),
    labels: text('labels'),
    components: text('components'),
    fixVersions: text('fixVersions'),
    project: text('project'),
    parent: f.parent?.key ?? '',
    timeSpent: text('timespent'),
    estimate: text('timeoriginalestimate'),
    storyPoints: points.missing ? '' : text(points.id),
    storyPointsValue: typeof pointsRaw === 'number' ? pointsRaw : null,
    sprint: sprint.missing ? '' : text(sprint.id),
    description: convert(f.description, rendered.description),
    environment: convert(f.environment, rendered.environment),
    comments: (f.comment?.comments ?? []).map((c, i) => ({
      author: c.author?.displayName ?? '',
      created: when(c.created),
      blocks: convert(c.body, c.renderedBody ?? rendered.comment?.comments?.[i]?.body),
    })),
    worklogs: (f.worklog?.worklogs ?? []).map((w) => ({
      author: w.author?.displayName ?? '',
      started: when(w.started),
      seconds: w.timeSpentSeconds ?? 0,
      hours: Number(((w.timeSpentSeconds ?? 0) / 3600).toFixed(2)),
      timeSpent: w.timeSpent ?? '',
      blocks: convert(w.comment),
    })),
    subtasks: (f.subtasks ?? []).map((s) => ({
      key: s.key, summary: s.fields?.summary ?? '', status: s.fields?.status?.name ?? '', type: s.fields?.issuetype?.name ?? '', url: `${siteUrl}/browse/${s.key}`,
    })),
    links: (f.issuelinks ?? []).map((l) => linkOf(l, siteUrl)),
    fields: Object.fromEntries(fieldNames.map((name) => [name, text(resolveField(catalog, name)?.id)])),
    warnings,
  };
  prepared.inlineImages = [...inline];
  prepared.gallery = attachments.filter((a) => IMAGE_TYPES.has(a.mimeType) && !inline.has(a.id)).map((a) => a.id);
  return prepared;
}

/** Attachment ids a template will show for one prepared issue. */
export function imagesFor(template, prepared) {
  if (template.kind === 'layout') return template.layout === 'single' ? [...prepared.inlineImages, ...prepared.gallery] : [];
  if (template.kind === 'docx') return prepared.inlineImages;
  return [];
}
