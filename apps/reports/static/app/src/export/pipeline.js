import { entryLabel, jqlForEntry, withOrder } from '../core/entry.js';
import { planFetch } from '../core/fetchPlan.js';
import { renderFileName } from '../core/filename.js';
import { BULK_BATCH, ISSUE_CONCURRENCY, MAX_DOC_ISSUES } from '../core/limits.js';
import { JiraError } from '../infra/jira.js';
import { createPool } from '../infra/pool.js';
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

const truncated = (page, key) => (page?.total ?? 0) > (page?.[key]?.length ?? 0);

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function resolveJql({ client, entry, jql }) {
  if (jql?.trim()) return withOrder(jql.trim());
  const direct = jqlForEntry(entry);
  if (direct) return withOrder(direct);
  if (entry.kind === 'board') return withOrder((await client.boardJql(entry.boardId)).jql);
  throw new ReportError('no-jql');
}

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

  const complete = async (issue) => {
    const f = issue.fields ?? {};
    const [comments, worklogs] = await Promise.all([
      plan.comments && truncated(f.comment, 'comments') ? client.listComments(issue.id) : null,
      plan.worklogs && truncated(f.worklog, 'worklogs') ? client.listWorklogs(issue.id) : null,
    ]);
    if (!comments && !worklogs) return issue;
    const fields = { ...f };
    if (comments) fields.comment = { ...f.comment, comments, total: comments.length };
    if (worklogs) fields.worklog = { ...f.worklog, worklogs, total: worklogs.length };
    return { ...issue, fields };
  };

  const readBatch = async (ids) => {
    const { issues, errors } = await client.bulkFetch(ids, fetchOptions);
    const position = new Map(ids.map((id, i) => [id, i]));
    const ordered = [...issues].sort((a, b) => (position.get(String(a.id)) ?? 0) - (position.get(String(b.id)) ?? 0));
    const completed = await Promise.all(ordered.map(complete));
    return { items: completed.map((issue) => consumer.consume(issue)), skipped: errors.length, project: completed[0]?.fields?.project?.key ?? '' };
  };

  const readBatches = async (batches) => {
    await Promise.all(batches.map((batch) => runBatch(async () => {
      checkAbort();
      try {
        batch.result = await readBatch(batch.ids);
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
    const { images, missing } = await downloadImages({ client, ids: consumer.imageIds(items), cache: imageCache, onProgress });
    checkAbort();
    onProgress({ phase: 'build', done: 0, total: 1 });
    const fileMeta = { ...meta, jql: state.jql, count: items.length, ...(partial ? { partial: { done: state.read, total: state.ids.length } } : {}) };
    const rendered = await consumer.render({ items, meta: fileMeta, images, renderers });
    checkAbort();
    const warnings = [...consumer.warnings(items, missing)];
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

  return {
    async start() {
      state.started = clock();
      await prepare();
      onProgress({ phase: 'read', done: 0, total: state.ids.length });
      await readBatches(state.batches);
      return outcome();
    },
    async retryMissing() {
      await readBatches(state.batches.filter((b) => b.failed));
      return outcome();
    },
    buildPartial: () => build(true),
  };
}
