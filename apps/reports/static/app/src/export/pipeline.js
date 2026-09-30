import { entryLabel, jqlForEntry, withOrder } from '../core/entry.js';
import { planFetch } from '../core/fetchPlan.js';
import { renderFileName } from '../core/filename.js';
import { BULK_BATCH, ISSUE_CONCURRENCY, MAX_DOC_ISSUES } from '../core/limits.js';
import { JiraError } from '../infra/jira.js';
import { createPool } from '../infra/pool.js';
import { createBatchReader } from './batch.js';
import { createConsumer } from './consumers.js';
import { ReportError } from './errors.js';
import { downloadImages } from './images.js';

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

const isAbort = (error) => error?.name === 'AbortError';

function asReportError(error) {
  if (!(error instanceof JiraError)) return error;
  return error.status === 400 ? new ReportError('jql', { messages: error.messages }) : new ReportError('network', { status: error.status });
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Jira's parse errors when an empty result comes from a query it cannot parse; a failed check leaves the empty result as it is. */
async function parseErrors(client, jql) {
  try {
    return await client.validateJql(jql);
  } catch (error) {
    if (isAbort(error)) throw error;
    return [];
  }
}

async function resolveJql({ client, entry, jql }) {
  if (jql?.trim()) return withOrder(jql.trim());
  const direct = jqlForEntry(entry);
  if (direct) return withOrder(direct);
  if (entry.kind === 'board') return withOrder((await client.boardJql(entry.boardId)).jql);
  throw new ReportError('no-jql');
}

/**
 * @typedef {{ issues: number, total: number, skipped: number, seconds: number, retries: number, imagesMissing: number }} FileStats
 * imagesMissing: unique attachment ids that could not be downloaded or read, plus images the PDF renderer dropped.
 */

/** Export run over an injected client (or a factory given onRetry) and renderers: read ids, fetch in batches, complete, images, build; failed batches can be retried or skipped into a partial file. */
export function createExportRun({
  client: source, entry, jql: typedJql, template, catalog, meta, labels, formats, renderers, clock, onProgress = () => {}, signal, limit,
}) {
  let retries = 0;
  const client = typeof source === 'function' ? source({ onRetry: () => { retries += 1; } }) : source;
  const format = template.format;
  const plan = planFetch(template, catalog);
  const fetchOptions = { fields: plan.fields, expand: plan.rendered ? ['renderedFields'] : [] };
  const consumer = createConsumer({ template, catalog, meta, labels, formats });
  const runBatch = createPool(ISSUE_CONCURRENCY);
  const imageCache = new Map();
  const state = { started: 0, jql: '', ids: [], batches: [], read: 0 };

  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };

  const readBatch = createBatchReader({ client, plan, fetchOptions, consumer });

  const readBatches = async (batches) => {
    await Promise.all(batches.map((batch) => runBatch(async () => {
      checkAbort();
      try {
        const result = await readBatch(batch.ids);
        checkAbort();
        batch.result = result;
        batch.failed = false;
        state.read += batch.ids.length;
        onProgress({ phase: 'read', done: state.read, total: state.ids.length });
      } catch (error) {
        if (isAbort(error)) throw error;
        batch.failed = true;
      }
    })));
    checkAbort();
  };

  const prepare = async () => {
    if (template.kind === 'docx' && !template.bytes) throw new ReportError('template-missing');
    try {
      state.jql = await resolveJql({ client, entry, jql: typedJql });
      checkAbort();
      if (format !== 'xlsx') {
        const count = await client.approximateCount(state.jql);
        if (count > MAX_DOC_ISSUES) throw new ReportError('too-many-for-document', { count, max: MAX_DOC_ISSUES });
      }
      checkAbort();
      state.ids = await client.searchIds(state.jql, limit > 0 ? { limit } : {});
      if (state.ids.length === 0) {
        const messages = await parseErrors(client, state.jql);
        checkAbort();
        if (messages.length) throw new ReportError('jql', { messages });
      }
      if (format !== 'xlsx' && state.ids.length > MAX_DOC_ISSUES) {
        throw new ReportError('too-many-for-document', { count: state.ids.length, max: MAX_DOC_ISSUES });
      }
    } catch (error) {
      throw asReportError(error);
    }
    if (state.ids.length === 0) throw new ReportError('no-issues');
    onProgress({ phase: 'count', done: state.ids.length, total: state.ids.length });
    state.batches = chunk(state.ids, BULK_BATCH).map((ids) => ({ ids, result: null, failed: false }));
  };

  const build = async (partial) => {
    const present = state.batches.filter((b) => b.result);
    const items = present.flatMap((b) => b.result.items);
    const fileMeta = { ...meta, jql: state.jql, count: items.length, ...(partial ? { partial: { done: state.read, total: state.ids.length } } : {}) };
    const { images, missing } = await downloadImages({ client, ids: consumer.imageIds(items), cache: imageCache, onProgress, signal });
    checkAbort();
    onProgress({ phase: 'build', done: 0, total: 1 });
    const rendered = await consumer.render({ items, meta: fileMeta, images, renderers });
    checkAbort();
    images.clear();
    imageCache.clear();
    const warnings = [...present.flatMap((b) => b.result.warnings), ...consumer.warnings(items, missing)];
    if (rendered.emojiDropped > 0) warnings.push({ kind: 'pdf-emoji', detail: String(rendered.emojiDropped) });
    const fileName = renderFileName({
      pattern: template.fileNamePattern ?? meta.fileNamePattern,
      values: { project: present[0]?.result.project ?? '', filter: entryLabel(entry), format, count: items.length },
      now: meta.now,
      extension: format,
      partial,
    });
    return {
      bytes: rendered.bytes,
      fileName,
      mime: MIME[format],
      stats: {
        issues: items.length,
        total: state.ids.length,
        skipped: present.reduce((sum, b) => sum + b.result.skipped, 0),
        seconds: (clock() - state.started) / 1000,
        retries,
        imagesMissing: missing.size + (rendered.imagesDropped ?? 0),
      },
      warnings,
    };
  };

  const outcome = async () => {
    const failed = state.batches.filter((b) => b.failed);
    if (failed.length) return { status: 'incomplete', done: state.read, total: state.ids.length, failedBatches: failed.length };
    return { status: 'done', file: await build(false) };
  };

  const released = (fn) => async () => {
    try {
      return await fn();
    } catch (error) {
      if (isAbort(error)) imageCache.clear();
      throw error;
    }
  };

  return {
    start: released(async () => {
      state.started = clock();
      await prepare();
      onProgress({ phase: 'read', done: 0, total: state.ids.length });
      await readBatches(state.batches);
      return outcome();
    }),
    retryMissing: released(async () => {
      await readBatches(state.batches.filter((b) => b.failed));
      return outcome();
    }),
    buildPartial: released(() => build(true)),
  };
}
