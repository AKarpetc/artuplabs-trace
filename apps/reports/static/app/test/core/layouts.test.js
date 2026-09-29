import { describe, expect, it } from 'vitest';
import { buildLayout } from '../../src/core/layouts.js';
import { prepareIssue } from '../../src/core/prepare.js';
import { SITE, catalog, formats, makeIssue } from '../fixtures/issues.js';

const labels = {
  'layout.type': 'Type', 'layout.status': 'Status', 'layout.priority': 'Priority', 'layout.assignee': 'Assignee',
  'layout.reporter': 'Reporter', 'layout.created': 'Created', 'layout.updated': 'Updated', 'layout.due': 'Due',
  'layout.labels': 'Labels', 'layout.components': 'Components', 'layout.fixVersions': 'Fix versions',
  'layout.description': 'Description', 'layout.attachments': 'Attachments', 'layout.subtasks': 'Sub-tasks',
  'layout.links': 'Links', 'layout.comments': 'Comments', 'layout.key': 'Key', 'layout.summary': 'Summary',
  'layout.count': 'Count', 'layout.points': 'Points', 'layout.total': 'Total', 'layout.untitled': 'Untitled',
  'meta.jql': 'JQL', 'meta.exported': 'Exported', 'meta.count': 'Issues',
  partialBanner: (done, total) => `Partial: ${done} of ${total}`,
};
const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 2, siteUrl: SITE };
const prepare = (overrides) => prepareIssue(makeIssue(overrides), { catalog, siteUrl: SITE, formats });

const one = prepare();
const two = prepare({ id: '10002', key: 'RPT-2', fields: {
  summary: 'Summary two', issuetype: { name: 'Bug' }, status: { name: 'Done' }, priority: null, duedate: null,
  customfield_10016: 5, attachment: [], comment: { total: 0, comments: [] },
} });
const three = prepare({ id: '10003', key: 'RPT-3', fields: { summary: 'Summary three', customfield_10016: 2 } });

const build = (layout, issues, extra = {}) => buildLayout({ layout, issues, meta: { ...meta, ...extra }, labels, paper: 'A4' });
const runs = (text, style = {}) => (text ? [{ text, ...style }] : []);
const para = (content) => ({ type: 'para', runs: typeof content === 'string' ? runs(content) : content });
const heading = (level, content) => ({ type: 'heading', level, runs: typeof content === 'string' ? runs(content) : content });
const key = (issue) => [{ text: issue.key, link: `${SITE}/browse/${issue.key}`, bold: true }];
const cell = (content, header = false) => ({ header, colspan: 1, rowspan: 1, blocks: [para(content)] });
const table = (headers, rows) => ({
  type: 'table', header: true,
  rows: [{ cells: headers.map((h) => cell(runs(h, { bold: true }), true)) }, ...rows.map((r) => ({ cells: r.map((v) => cell(v)) }))],
});
const indexOf = (blocks, text) => blocks.findIndex((b) => b.type === 'heading' && b.runs[0]?.text === text);

describe('buildLayout single', () => {
  it('opens the issue with a heading of the linked key and the summary', () => {
    expect(build('single', [one]).blocks[0]).toEqual(heading(1, [...key(one), { text: ' Summary one' }]));
  });

  it('shows a key/value table of the non-empty values only', () => {
    const kv = (label, value) => ({ cells: [cell([{ text: label, bold: true }]), cell(value)] });
    expect(build('single', [two]).blocks[1]).toEqual({ type: 'table', header: false, rows: [
      kv('Type', 'Bug'), kv('Status', 'Done'), kv('Assignee', 'Ann'), kv('Reporter', 'Rob'),
      kv('Created', 'DT:2026-09-01T10:00:00.000Z'), kv('Updated', 'DT:2026-09-03T12:30:00.000Z'),
      kv('Labels', 'alpha, beta'), kv('Components', 'API'), kv('Fix versions', 'v1.0'),
    ] });
  });

  it('has a description section with the description blocks', () => {
    const blocks = build('single', [one]).blocks;
    const at = indexOf(blocks, 'Description');
    expect(blocks.slice(at, at + 4)).toEqual([heading(2, 'Description'), ...one.description]);
  });

  it('lists gallery images as image blocks under attachments', () => {
    const blocks = build('single', [one]).blocks;
    const at = indexOf(blocks, 'Attachments');
    expect(blocks.slice(at, at + 2)).toEqual([heading(2, 'Attachments'), { type: 'image', attachmentId: '10501', alt: '', width: null, height: null }]);
  });

  it('ends with comments, each under a bold author and date line', () => {
    const blocks = build('single', [one]).blocks;
    expect(blocks.slice(indexOf(blocks, 'Comments'))).toEqual([
      heading(2, 'Comments'),
      para([{ text: 'Ann · DT:2026-09-02T08:00:00.000Z', bold: true }]), ...one.comments[0].blocks,
      para([{ text: 'Rob · DT:2026-09-02T09:15:00.000Z', bold: true }]), ...one.comments[1].blocks,
    ]);
  });

  it('separates issues with a page break', () => {
    const blocks = build('single', [one, two]).blocks;
    const breaks = blocks.flatMap((b, i) => (b.type === 'pageBreak' ? [i] : []));
    expect({ breaks: breaks.length, next: blocks[breaks[0] + 1] }).toEqual({ breaks: 1, next: heading(1, [...key(two), { text: ' Summary two' }]) });
  });

  it('titles a one-issue export with its key and summary', () => {
    expect(build('single', [one]).title).toBe('RPT-1 Summary one');
  });
});

describe('buildLayout list', () => {
  it('is an untitled heading and one table of issues with linked keys', () => {
    expect(build('list', [one, two]).blocks).toEqual([
      heading(1, 'Untitled'),
      table(['Key', 'Summary', 'Type', 'Status', 'Priority', 'Assignee', 'Due'], [
        [key(one), 'Summary one', 'Story', 'In Progress', 'High', 'Ann', 'D:2026-09-30'],
        [key(two), 'Summary two', 'Bug', 'Done', '', 'Ann', ''],
      ]),
    ]);
  });

  it('uses the export title for the heading and the document', () => {
    const spec = build('list', [one], { title: 'My issues' });
    expect({ title: spec.title, first: spec.blocks[0] }).toEqual({ title: 'My issues', first: heading(1, 'My issues') });
  });
});

describe('buildLayout sprint', () => {
  it('opens with the sprint name, the count and a status table with a total row', () => {
    expect(build('sprint', [one, two, three]).blocks.slice(0, 3)).toEqual([
      heading(1, 'Sprint 7'),
      para('Count: 3'),
      table(['Status', 'Count', 'Points'], [
        ['In Progress', '2', '5'],
        ['Done', '1', '5'],
        [[{ text: 'Total', bold: true }], '3', '10'],
      ]),
    ]);
  });

  it('follows with one section per status in first-appearance order', () => {
    const headers = ['Key', 'Summary', 'Assignee', 'Points'];
    expect(build('sprint', [one, two, three]).blocks.slice(3)).toEqual([
      heading(2, 'In Progress'),
      table(headers, [[key(one), 'Summary one', 'Ann', '3'], [key(three), 'Summary three', 'Ann', '2']]),
      heading(2, 'Done'),
      table(headers, [[key(two), 'Summary two', 'Ann', '5']]),
    ]);
  });
});

describe('buildLayout release', () => {
  it('lists issues as bullets under one heading per issue type', () => {
    const item = (issue) => ({ blocks: [para([...key(issue), { text: ` ${issue.summary}` }])] });
    expect(build('release', [one, two]).blocks).toEqual([
      heading(1, 'v1.0'),
      heading(2, 'Story'), { type: 'list', ordered: false, start: 1, items: [item(one)] },
      heading(2, 'Bug'), { type: 'list', ordered: false, start: 1, items: [item(two)] },
    ]);
  });
});

describe('buildLayout document', () => {
  it('writes the query, export time and author, and count as meta lines', () => {
    expect(build('list', [one, two]).metaLines).toEqual(['JQL: project = RPT', 'Exported: 29 Sep 2026 10:00 · Ann', 'Issues: 2']);
  });

  it('opens a partial export with a warning panel', () => {
    expect(build('list', [one], { partial: { done: 1, total: 2 } }).blocks[0]).toEqual({
      type: 'panel', kind: 'warning', blocks: [{ type: 'para', runs: [{ text: 'Partial: 1 of 2' }] }],
    });
  });

  it('carries the paper size', () => {
    expect(buildLayout({ layout: 'list', issues: [one], meta, labels, paper: 'LETTER' }).paper).toBe('LETTER');
  });
});
