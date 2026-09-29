// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { builtinById } from '../../src/core/builtins.js';
import { JiraError } from '../../src/infra/jira.js';
import { ReportError } from '../../src/export/errors.js';
import { createExportRun } from '../../src/export/pipeline.js';
import { SITE, catalog, formats } from '../fixtures/issues.js';
import { pngBytes } from '../fixtures/images.js';

const labels = new Proxy({ partialBanner: (done, total) => `${done} of ${total}` }, { get: (t, k) => t[k] ?? String(k) });
const meta = { exportedBy: 'Ann', siteUrl: SITE, now: new Date(2026, 8, 29, 10, 0), exportedAt: '29 Sep 2026', paper: 'A4' };
const XLSX = builtinById('xlsx-issues');
const SINGLE_DOCX = builtinById('docx-single');
const SINGLE_PDF = builtinById('pdf-single');
const LIST_DOCX = builtinById('docx-list');
const COLUMNS = { id: 't', format: 'xlsx', kind: 'columns', rowMode: 'issue', groupBy: null, summary: false, columns: ['key', 'summary'] };
const PNG = pngBytes(4, 3);

const doc = (...content) => ({ type: 'doc', version: 1, content });
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));
const abortError = () => new DOMException('Aborted', 'AbortError');

function issueOf(id, fields = {}) {
  return {
    id: String(id),
    key: `RPT-${id}`,
    fields: { summary: `Issue ${id}`, project: { key: 'RPT', name: 'Reports' }, status: { name: 'To Do' }, ...fields },
  };
}

function fakeClient({ count = 3, fields = () => ({}), ...overrides } = {}) {
  const all = ids(count);
  return {
    searchIds: vi.fn(async () => all),
    approximateCount: vi.fn(async () => count),
    boardJql: vi.fn(async () => ({ jql: 'project = RPT', name: 'Board' })),
    bulkFetch: vi.fn(async (batch) => ({ issues: batch.map((id) => issueOf(id, fields(id))), errors: [] })),
    listComments: vi.fn(async () => []),
    listWorklogs: vi.fn(async () => []),
    attachmentBytes: vi.fn(async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength)),
    attachmentThumbnail: vi.fn(async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength)),
    ...overrides,
  };
}

function fakeRenderers({ emojiDropped = 0, imagesDropped = 0 } = {}) {
  return {
    xlsx: vi.fn(async () => new Uint8Array([1])),
    docx: vi.fn(async () => new Uint8Array([1])),
    pdf: vi.fn(async () => ({ bytes: new Uint8Array([1]), emojiDropped, imagesDropped })),
    docxTemplate: vi.fn(async () => new Uint8Array([1])),
  };
}

function run(options = {}) {
  const client = options.client ?? fakeClient();
  const renderers = options.renderers ?? fakeRenderers();
  const onProgress = vi.fn();
  const times = [0, 12500];
  const exportRun = createExportRun({
    client,
    entry: { kind: 'jql', jql: 'project = RPT', label: 'mine' },
    template: XLSX,
    catalog,
    meta,
    labels,
    formats,
    renderers,
    clock: () => times.shift() ?? 12500,
    onProgress,
    ...options,
  });
  return { exportRun, client, renderers, onProgress };
}

const attachment = (id, mimeType = 'image/png') => ({ id, filename: `${id}.png`, mimeType });
const hasFields = (value) => {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'fields')) return true;
  return Object.values(value).some(hasFields);
};

describe('createExportRun: query', () => {
  it.each([
    [{ kind: 'issue', key: 'RPT-9' }, 'key = "RPT-9" ORDER BY key ASC'],
    [{ kind: 'sprint', sprintId: 12 }, 'sprint = 12 ORDER BY Rank ASC'],
    [{ kind: 'board', boardId: 3 }, 'project = RPT ORDER BY key ASC'],
    [{ kind: 'jql', jql: 'project = RPT' }, 'project = RPT ORDER BY key ASC'],
  ])('resolves the JQL of entry %j', async (entry, jql) => {
    const { exportRun, client } = run({ entry });
    await exportRun.start();
    expect(client.searchIds.mock.calls[0][0]).toEqual(jql);
  });

  it('asks the board for its filter JQL', async () => {
    const { exportRun, client } = run({ entry: { kind: 'board', boardId: 3 } });
    await exportRun.start();
    expect(client.boardJql.mock.calls).toEqual([[3]]);
  });

  it('prefers the typed JQL over the entry', async () => {
    const { exportRun, client } = run({ entry: { kind: 'none' }, jql: 'status = Done ORDER BY created DESC' });
    await exportRun.start();
    expect(client.searchIds.mock.calls[0][0]).toEqual('status = Done ORDER BY created DESC');
  });

  it('rejects an entry without JQL with no-jql', async () => {
    const { exportRun } = run({ entry: { kind: 'none' } });
    await expect(exportRun.start()).rejects.toEqual(new ReportError('no-jql'));
  });

  it('reads the ids once and fetches them in batches of 100 with the plan fields and no expand for columns', async () => {
    const { exportRun, client } = run({ client: fakeClient({ count: 250 }), template: COLUMNS });
    await exportRun.start();
    const options = { fields: ['summary', 'status', 'issuetype', 'priority', 'assignee', 'project'], expand: [] };
    expect({ searches: client.searchIds.mock.calls.length, batches: client.bulkFetch.mock.calls }).toEqual({
      searches: 1,
      batches: [[ids(100), options], [ids(100, 101), options], [ids(50, 201), options]],
    });
  });

  it('expands rendered fields when the plan needs rendered HTML', async () => {
    const { exportRun, client } = run({ template: SINGLE_DOCX });
    await exportRun.start();
    expect(client.bulkFetch.mock.calls[0][1].expand).toEqual(['renderedFields']);
  });

  it('passes a positive limit to the id search and leaves out a zero one', async () => {
    const limited = run({ limit: 5 });
    const unlimited = run({ limit: 0 });
    await limited.exportRun.start();
    await unlimited.exportRun.start();
    expect([limited.client.searchIds.mock.calls[0][1], unlimited.client.searchIds.mock.calls[0][1]]).toEqual([{ limit: 5 }, {}]);
  });

  it('refuses a Word or PDF run over 2 000 issues before reading ids', async () => {
    const client = fakeClient({ approximateCount: vi.fn(async () => 2001) });
    const { exportRun } = run({ client, template: SINGLE_PDF });
    await expect(exportRun.start()).rejects.toEqual(new ReportError('too-many-for-document', { count: 2001, max: 2000 }));
    expect(client.searchIds).not.toHaveBeenCalled();
  });

  it('never counts issues for Excel', async () => {
    const { exportRun, client } = run();
    await exportRun.start();
    expect(client.approximateCount).not.toHaveBeenCalled();
  });

  it('rejects an empty result with no-issues', async () => {
    const { exportRun } = run({ client: fakeClient({ searchIds: vi.fn(async () => []) }) });
    await expect(exportRun.start()).rejects.toEqual(new ReportError('no-issues'));
  });

  it('turns a 400 from the id search into a jql error with Jira messages', async () => {
    const searchIds = vi.fn(async () => { throw new JiraError(400, '/rest/api/3/search/jql', ['Field x does not exist']); });
    const { exportRun } = run({ client: fakeClient({ searchIds }) });
    await expect(exportRun.start()).rejects.toEqual(new ReportError('jql', { messages: ['Field x does not exist'] }));
  });

  it('turns another Jira failure before reading into a network error with its status', async () => {
    const boardJql = vi.fn(async () => { throw new JiraError(503, '/rest/agile/1.0/board/3/configuration'); });
    const { exportRun } = run({ client: fakeClient({ boardJql }), entry: { kind: 'board', boardId: 3 } });
    await expect(exportRun.start()).rejects.toEqual(new ReportError('network', { status: 503 }));
  });

  it('rejects a custom Word template without its file with template-missing', async () => {
    const { exportRun } = run({ template: { id: 'c', format: 'docx', kind: 'docx', placeholders: [] } });
    await expect(exportRun.start()).rejects.toEqual(new ReportError('template-missing'));
  });
});

describe('createExportRun: reading', () => {
  it('keeps issues in id order when batches and issues resolve out of order', async () => {
    const bulkFetch = vi.fn(async (batch) => {
      await new Promise((r) => setTimeout(r, batch[0] === '1' ? 20 : 1));
      return { issues: [...batch].reverse().map((id) => issueOf(id)), errors: [] };
    });
    const { exportRun, renderers } = run({ client: fakeClient({ count: 250, bulkFetch }), template: COLUMNS });
    await exportRun.start();
    const keys = renderers.xlsx.mock.calls[0][0].assembled.sheets[0].rows.map((r) => r[0].text);
    expect(keys).toEqual(ids(250).map((id) => `RPT-${id}`));
  });

  it('counts issue errors as skipped and the id count as total', async () => {
    const bulkFetch = vi.fn(async (batch) => ({
      issues: batch.filter((id) => id !== '2').map((id) => issueOf(id)),
      errors: [{ issueIdsOrKeys: ['2'], status: 404, elementErrors: {} }],
    }));
    const { exportRun } = run({ client: fakeClient({ bulkFetch }) });
    const outcome = await exportRun.start();
    expect({ issues: outcome.file.stats.issues, total: outcome.file.stats.total, skipped: outcome.file.stats.skipped })
      .toEqual({ issues: 2, total: 3, skipped: 1 });
  });

  it('reads every comment of an issue whose embedded comments are truncated', async () => {
    const full = [1, 2, 3].map((n) => ({ id: String(n), body: doc(para(`c${n}`)), renderedBody: `<p>c${n}</p>`, author: { displayName: 'Ann' } }));
    const client = fakeClient({
      count: 2,
      fields: (id) => ({ comment: { total: id === '1' ? 3 : 1, comments: [full[0]] } }),
      listComments: vi.fn(async () => full),
    });
    const { exportRun, renderers } = run({ client, template: builtinById('xlsx-comments') });
    await exportRun.start();
    const bodies = renderers.xlsx.mock.calls[0][0].assembled.sheets[0].rows.map((r) => r[4].text);
    expect({ calls: client.listComments.mock.calls, bodies }).toEqual({ calls: [['1']], bodies: ['c1', 'c2', 'c3', 'c1'] });
  });

  it('reads every worklog of an issue whose embedded worklogs are truncated', async () => {
    const log = (n) => ({ id: String(n), timeSpentSeconds: 3600 * n, started: '2026-09-01T10:00:00.000+0000', author: { displayName: 'Ann' } });
    const client = fakeClient({
      count: 2,
      fields: (id) => ({ worklog: { total: id === '2' ? 2 : 1, worklogs: [log(1)] } }),
      listWorklogs: vi.fn(async () => [log(1), log(2)]),
    });
    const { exportRun, renderers } = run({ client, template: builtinById('xlsx-worklogs') });
    await exportRun.start();
    const hours = renderers.xlsx.mock.calls[0][0].assembled.sheets[0].rows.map((r) => r[4].value);
    expect({ calls: client.listWorklogs.mock.calls, hours }).toEqual({ calls: [['2']], hours: [1, 1, 2] });
  });

  it('hands the Excel renderer assembled sheets and the summary, without raw issue fields', async () => {
    const { exportRun, renderers } = run();
    await exportRun.start();
    const input = renderers.xlsx.mock.calls[0][0];
    expect({
      sheets: input.assembled.sheets.map((s) => [s.name, s.rows.length]),
      summarySheet: input.assembled.summarySheet,
      summary: input.summary,
      meta: input.meta,
      rawFields: hasFields({ assembled: input.assembled, summary: input.summary }),
    }).toEqual({
      sheets: [['sheet.issues', 3]],
      summarySheet: 'sheet.summary',
      summary: { total: 3, byStatus: [['To Do', 3]], byAssignee: [['unassigned', 3]], byPriority: [['none', 3]] },
      meta: { ...meta, jql: 'project = RPT ORDER BY key ASC', count: 3 },
      rawFields: false,
    });
  });

  it('reports read progress rising to the id count, then images, then build', async () => {
    const { exportRun, onProgress } = run({ client: fakeClient({ count: 250 }), template: LIST_DOCX });
    await exportRun.start();
    const events = onProgress.mock.calls.map(([e]) => e).filter((e) => e.phase !== 'count');
    const reads = events.filter((e) => e.phase === 'read');
    expect({
      phases: events.map((e) => e.phase),
      rising: reads.every((e, i) => i === 0 || e.done > reads[i - 1].done),
      first: reads[0],
      last: reads.at(-1),
      after: events.slice(-2),
    }).toEqual({
      phases: ['read', 'read', 'read', 'read', 'images', 'build'],
      rising: true,
      first: { phase: 'read', done: 0, total: 250 },
      last: { phase: 'read', done: 250, total: 250 },
      after: [{ phase: 'images', done: 0, total: 0 }, { phase: 'build', done: 0, total: 1 }],
    });
  });

  it('counts retries reported by the client', async () => {
    const client = ({ onRetry }) => fakeClient({
      bulkFetch: vi.fn(async (batch) => {
        onRetry({ status: 429, path: '/rest/api/3/issue/bulkfetch' });
        onRetry({ status: 503, path: '/rest/api/3/issue/bulkfetch' });
        return { issues: batch.map((id) => issueOf(id)), errors: [] };
      }),
    });
    const { exportRun } = run({ client });
    const outcome = await exportRun.start();
    expect(outcome.file.stats.retries).toEqual(2);
  });

  it('rejects with AbortError when cancelled during reading and renders nothing', async () => {
    const controller = new AbortController();
    const bulkFetch = vi.fn(async () => {
      controller.abort();
      throw abortError();
    });
    const { exportRun, renderers } = run({ client: fakeClient({ bulkFetch }), signal: controller.signal });
    await expect(exportRun.start()).rejects.toMatchObject({ name: 'AbortError' });
    expect([renderers.xlsx.mock.calls.length, renderers.docx.mock.calls.length, renderers.pdf.mock.calls.length]).toEqual([0, 0, 0]);
  });
});

describe('createExportRun: failed batches', () => {
  const flaky = () => {
    let failing = true;
    const bulkFetch = vi.fn(async (batch) => {
      if (batch[0] === '101' && failing) throw new JiraError(503, '/rest/api/3/issue/bulkfetch');
      return { issues: batch.map((id) => issueOf(id)), errors: [] };
    });
    return { client: fakeClient({ count: 200, bulkFetch }), heal: () => { failing = false; } };
  };

  it('resolves incomplete when a batch still fails after the client retries', async () => {
    const { client } = flaky();
    const { exportRun, renderers } = run({ client });
    expect({ outcome: await exportRun.start(), rendered: renderers.xlsx.mock.calls.length })
      .toEqual({ outcome: { status: 'incomplete', done: 100, total: 200, failedBatches: 1 }, rendered: 0 });
  });

  it('re-reads only the failed batch on retryMissing and builds the full file', async () => {
    const { client, heal } = flaky();
    const { exportRun } = run({ client });
    await exportRun.start();
    heal();
    const outcome = await exportRun.retryMissing();
    expect({
      status: outcome.status,
      issues: outcome.file.stats.issues,
      fileName: outcome.file.fileName,
      rereads: client.bulkFetch.mock.calls.slice(2).map(([batch]) => batch[0]),
    }).toEqual({ status: 'done', issues: 200, fileName: 'RPT-2026-09-29-mine.xlsx', rereads: ['101'] });
  });

  it('builds a partial file with a banner and a -PARTIAL name from the batches that were read', async () => {
    const { client } = flaky();
    const { exportRun, renderers } = run({ client });
    await exportRun.start();
    const file = await exportRun.buildPartial();
    expect({ fileName: file.fileName, partial: renderers.xlsx.mock.calls[0][0].meta.partial, issues: file.stats.issues })
      .toEqual({ fileName: 'RPT-2026-09-29-mine-PARTIAL.xlsx', partial: { done: 100, total: 200 }, issues: 100 });
  });
});

describe('createExportRun: images', () => {
  const imageClient = (overrides = {}) => fakeClient({
    count: 2,
    fields: (id) => ({ attachment: id === '1' ? [attachment('A'), attachment('B')] : [attachment('A'), attachment('C')] }),
    attachmentBytes: vi.fn(async (id) => {
      if (id === 'B') throw new JiraError(404, `/rest/api/3/attachment/content/${id}`);
      if (id === 'C') return new TextEncoder().encode('not an image').buffer;
      return PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength);
    }),
    ...overrides,
  });

  it('downloads each image once and counts 404 and unreadable images as missing', async () => {
    const client = imageClient();
    const { exportRun, renderers } = run({ client, template: SINGLE_DOCX });
    const { file } = await exportRun.start();
    const images = renderers.docx.mock.calls[0][0].images;
    expect({
      downloads: client.attachmentBytes.mock.calls.map(([id]) => id).sort(),
      images: [...images.entries()],
      missing: file.stats.imagesMissing,
      warnings: file.warnings,
    }).toEqual({
      downloads: ['A', 'B', 'C'],
      images: [['A', { type: 'png', width: 4, height: 3, bytes: PNG }]],
      missing: 2,
      warnings: [
        { kind: 'image-missing', detail: 'B', issueKey: 'RPT-1' },
        { kind: 'image-missing', detail: 'C', issueKey: 'RPT-2' },
      ],
    });
  });

  it('tries the thumbnail when the attachment fails with another status', async () => {
    const client = fakeClient({
      count: 1,
      fields: () => ({ attachment: [attachment('A')] }),
      attachmentBytes: vi.fn(async () => { throw new JiraError(500, '/rest/api/3/attachment/content/A'); }),
    });
    const { exportRun, renderers } = run({ client, template: SINGLE_DOCX });
    const { file } = await exportRun.start();
    expect({ thumbnails: client.attachmentThumbnail.mock.calls, images: [...renderers.docx.mock.calls[0][0].images.keys()], missing: file.stats.imagesMissing })
      .toEqual({ thumbnails: [['A']], images: ['A'], missing: 0 });
  });

  it('fills a custom Word template with prepared issues, its bytes and inline images', async () => {
    const template = { id: 'c', format: 'docx', kind: 'docx', bytes: new Uint8Array([9]), placeholders: [{ name: 'field "Team"', kind: 'value', children: [] }] };
    const client = fakeClient({ count: 1, fields: () => ({ customfield_10030: { value: 'Core' } }) });
    const { exportRun, renderers } = run({ client, template });
    await exportRun.start();
    const input = renderers.docxTemplate.mock.calls[0][0];
    expect({ template: input.template, keys: input.issues.map((i) => [i.key, i.fields]), images: input.images.size, count: input.meta.count })
      .toEqual({ template: new Uint8Array([9]), keys: [['RPT-1', { Team: 'Core' }]], images: 0, count: 1 });
  });
});

describe('createExportRun: file', () => {
  it.each([
    [XLSX, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    [SINGLE_DOCX, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    [SINGLE_PDF, 'pdf', 'application/pdf'],
  ])('names the file from the pattern with the first project and the entry label (%#)', async (template, ext, mime) => {
    const { exportRun } = run({ template: { ...template, fileNamePattern: '{project}_{filter}_{date}' } });
    const { file } = await exportRun.start();
    expect({ fileName: file.fileName, mime: file.mime, seconds: file.stats.seconds, bytes: file.bytes })
      .toEqual({ fileName: `RPT_mine_2026-09-29.${ext}`, mime, seconds: 12.5, bytes: new Uint8Array([1]) });
  });

  it('warns about columns the site does not have', async () => {
    const { exportRun } = run({ template: { ...COLUMNS, columns: ['key', 'Nope'] } });
    const { file } = await exportRun.start();
    expect(file.warnings).toEqual([{ kind: 'column-missing', detail: 'Nope' }]);
  });

  it('merges ADF warnings with the issue key, missing images and dropped emoji for PDF', async () => {
    const client = fakeClient({
      count: 1,
      fields: () => ({ description: doc({ type: 'mysteryNode', content: [{ type: 'text', text: 'x' }] }), attachment: [attachment('B')] }),
      attachmentBytes: vi.fn(async () => { throw new JiraError(404, '/rest/api/3/attachment/content/B'); }),
    });
    const { exportRun } = run({ client, template: SINGLE_PDF, renderers: fakeRenderers({ emojiDropped: 2, imagesDropped: 1 }) });
    const { file } = await exportRun.start();
    expect({ warnings: file.warnings, missing: file.stats.imagesMissing }).toEqual({
      warnings: [
        { kind: 'adf-fallback', detail: 'mysteryNode', issueKey: 'RPT-1' },
        { kind: 'image-missing', detail: 'B', issueKey: 'RPT-1' },
        { kind: 'pdf-emoji', detail: '2' },
      ],
      missing: 2,
    });
  });
});
