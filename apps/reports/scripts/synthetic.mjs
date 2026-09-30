#!/usr/bin/env node
/**
 * Builds fake issues in memory (RPT field shapes, text in Latin, Cyrillic and CJK), runs the
 * row builder, sheet assembly and the .xlsx renderer, and prints seconds and peak memory.
 *
 * Usage (from apps/reports): node scripts/synthetic.mjs --issues 50000
 */

import { createRequire } from 'node:module';
import { clock, fileLabels, load, mb, sampleMemory } from './lib/node-env.mjs';

const require = createRequire(new URL('../static/app/package.json', import.meta.url));
const HEAP_LIMIT_MB = 1536;
const SUMMARIES = [
  'Customer cannot open the export dialog after the upgrade',
  'Клиент не может открыть диалог выгрузки после обновления',
  '升级后客户无法打开导出对话框',
  'Ошибка при сохранении отчёта на Windows и macOS',
  'レポートの保存中にエラーが発生しました',
];
const STATUSES = ['To Do', 'In Progress', 'Done', 'Backlog'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
const PEOPLE = ['Artyom Karpets', 'Анна Иванова', '田中太郎', 'Ann Lee', 'Olga Petrova'];

function parse(argv) {
  const options = { issues: 50000 };
  for (let i = 0; i < argv.length; i += 2) options[argv[i].replace(/^--/, '')] = Number(argv[i + 1]);
  return options;
}

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

function fakeIssue(makeIssue, n) {
  const day = String(1 + (n % 28)).padStart(2, '0');
  return makeIssue({
    id: String(10000 + n),
    key: `RPT-${n}`,
    fields: {
      summary: `${SUMMARIES[n % SUMMARIES.length]} ${n}`,
      status: { name: STATUSES[n % STATUSES.length] },
      priority: { name: PRIORITIES[n % PRIORITIES.length] },
      assignee: { accountId: `a${n % 5}`, displayName: PEOPLE[n % PEOPLE.length] },
      reporter: { accountId: `r${n % 7}`, displayName: PEOPLE[(n + 2) % PEOPLE.length] },
      created: `2026-08-${day}T10:00:00.000+0000`,
      updated: `2026-09-${day}T12:30:00.000+0000`,
      description: { type: 'doc', version: 1, content: [para(`${SUMMARIES[(n + 1) % SUMMARIES.length]}. ${SUMMARIES[(n + 2) % SUMMARIES.length]}`), para(`Steps ${n}: open, click, save.`)] },
      labels: ['seed', `batch-${n % 50}`],
    },
  });
}

async function main() {
  const { issues: count } = parse(process.argv.slice(2));
  const { makeIssue, catalog, SITE } = await load('test/fixtures/issues.js');
  const { builtinById } = await load('src/core/builtins.js');
  const { assembleSheets, createRowBuilder, createSummary } = await load('src/core/rows.js');
  const { renderXlsx } = await load('src/render/xlsx.js');
  const { default: ExcelJS } = await import(require.resolve('exceljs'));
  const labels = await fileLabels();
  const base = builtinById('xlsx-issues');
  const template = { ...base, columns: [...base.columns, 'description', '@storyPoints', '@sprint'] };
  const memory = sampleMemory();
  const started = clock();
  const builder = createRowBuilder({ template, catalog, siteUrl: SITE, labels });
  const summary = createSummary(labels);
  const rows = [];
  for (let n = 1; n <= count; n += 1) {
    const issue = fakeIssue(makeIssue, n);
    summary.add(issue);
    rows.push(...builder.rowsFor(issue));
    if (n % 5000 === 0) await new Promise((resolve) => { setImmediate(resolve); });
  }
  const readSeconds = (clock() - started) / 1000;
  const afterRows = process.memoryUsage().heapUsed;
  const assembled = assembleSheets({ columns: builder.columns, rows, grouped: builder.grouped, summary: true, labels });
  const meta = { exportedBy: 'Synthetic', now: new Date(), jql: 'synthetic', count };
  const bytes = await renderXlsx({ assembled, summary: summary.result(), meta, labels, ExcelJS });
  const seconds = (clock() - started) / 1000;
  const peak = memory.stop();
  const result = {
    issues: count, rows: rows.length, columns: builder.columns.length,
    rowBuildSeconds: Number(readSeconds.toFixed(1)), heapAfterRowsMB: mb(afterRows), totalSeconds: Number(seconds.toFixed(1)),
    fileMB: Number((bytes.length / 1048576).toFixed(2)), peakRssMB: mb(peak.rss), peakHeapMB: mb(peak.heapUsed),
    heapUnder1_5GB: mb(peak.heapUsed) < HEAP_LIMIT_MB,
  };
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
