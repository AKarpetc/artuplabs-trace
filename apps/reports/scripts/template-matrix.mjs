#!/usr/bin/env node
/**
 * Renders the 8 built-in Word and PDF layouts on A4 and Letter with Latin, Cyrillic and CJK sample
 * issues into data/matrix/, rasterises PDFs with pdftoppm (Word files first go through LibreOffice),
 * and writes data/matrix/index.html as a contact sheet.
 *
 * Usage (from apps/reports): node scripts/template-matrix.mjs [--only pdf-single] [--skip-raster]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFormats, fileLabels, load, nodeRenderers } from './lib/node-env.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data', 'matrix');
const SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
const PDFTOPPM = existsSync('/opt/homebrew/bin/pdftoppm') ? '/opt/homebrew/bin/pdftoppm' : 'pdftoppm';
const PAPERS = ['A4', 'LETTER'];
const SHEET_PAGES = 4;

const TEXTS = {
  latin: {
    summary: 'Customer cannot open the export dialog after the upgrade to the new release',
    long: 'Export fails when the summary is extremely long and keeps going without any natural break so that the layout has to wrap it across several lines inside a table cell or a heading',
    body: 'The export dialog does not open when the user clicks the button in the issue navigator. Steps: open the navigator, select more than fifty issues, choose the app in the menu.',
    token: 'https://artuplabs-dev.atlassian.net/browse/RPT-10001?focusedCommentId=100200300400&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel',
    names: ['Artyom Karpets', 'Ann Lee', 'Olga Petrova', 'Robert Miller'],
  },
  cyrillic: {
    summary: 'Клиент не может открыть диалог выгрузки после обновления до новой версии приложения',
    long: 'Выгрузка завершается ошибкой, когда заголовок задачи очень длинный и не содержит естественных разрывов, поэтому вёрстке приходится переносить его на несколько строк внутри ячейки таблицы или заголовка раздела',
    body: 'Диалог выгрузки не открывается при нажатии на кнопку в навигаторе задач. Шаги: открыть навигатор, выбрать больше пятидесяти задач, выбрать приложение в меню.',
    token: 'Сверхдлинноесловобезпробеловкотороенедолжновыходитьзаграницыстраницыиобрезатьсяприпечатиивпросмотре1234567890',
    names: ['Артём Карпец', 'Анна Иванова', 'Ольга Петрова', 'Сергей Смирнов'],
  },
  cjk: {
    summary: '升级到新版本后客户无法打开导出对话框，レポートの保存中にエラーが発生しました',
    long: '当摘要非常长并且没有任何自然断点时导出失败，因此版面必须把它折成多行放进表格单元格或标题里，エクスポート画面が開かない問題を調査してください，내보내기 대화 상자가 열리지 않습니다',
    body: '在问题导航器中点击按钮时导出对话框不会打开。步骤：打开导航器，选择五十多个问题，在菜单中选择应用。エクスポートダイアログが開きません。내보내기 대화 상자가 열리지 않습니다.',
    token: '超长没有空格的连续文字用于检查换行是否会超出页面边界并且被裁剪掉无法阅读的情况一二三四五六七八九十',
    names: ['田中太郎', '王小明', '김민수', '李雷'],
  },
};

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const item = (...content) => ({ type: 'listItem', content });
const cell = (type, text) => ({ type, attrs: {}, content: [para(text)] });

function extraBlocks(t) {
  const columns = ['ID', 'Name', 'Owner', 'Status', 'Estimate', 'Note', 'Link'];
  const row = (type, n) => ({ type: 'tableRow', content: columns.map((c, i) => cell(type, type === 'tableHeader' ? c : i === 5 ? t.long : i === 6 ? t.token : `${c} ${n}`)) });
  return [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t.summary }] },
    para(t.body),
    para(t.token),
    { type: 'bulletList', content: [item(para(t.body), { type: 'bulletList', content: [item(para(t.long)), item(para(t.summary))] }), item(para(t.summary))] },
    { type: 'orderedList', content: [item(para(t.summary)), item(para(t.long))] },
    { type: 'table', attrs: {}, content: [row('tableHeader', 0), row('tableCell', 1), row('tableCell', 2)] },
    { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: `const ${'veryLongIdentifier'.repeat(8)} = "${t.token}";\nfunction run() { return ${JSON.stringify(t.summary)}; }` }] },
    { type: 'blockquote', content: [para(t.body)] },
    { type: 'panel', attrs: { panelType: 'warning' }, content: [para(t.long)] },
  ];
}

function sampleIssues({ makeIssue, DESCRIPTION, FIRST_COMMENT }, script, count) {
  const t = TEXTS[script];
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return makeIssue({
      id: String(10000 + n),
      key: `RPT-${n}`,
      fields: {
        summary: i % 3 === 1 ? t.long : `${t.summary} ${n}`,
        assignee: { accountId: 'a1', displayName: t.names[i % t.names.length] },
        reporter: { accountId: 'r1', displayName: t.names[(i + 1) % t.names.length] },
        labels: ['alpha', t.token.slice(0, 40), t.names[0]],
        components: [{ name: t.summary.slice(0, 30) }, { name: 'API' }],
        fixVersions: [{ name: '2026.10' }],
        description: { type: 'doc', version: 1, content: [...DESCRIPTION.content, ...extraBlocks(t)] },
        attachment: [
          { id: '10500', filename: 'diagram-1.png', mimeType: 'image/png' },
          { id: '10501', filename: 'screen.png', mimeType: 'image/png' },
          { id: '10502', filename: 'spec.pdf', mimeType: 'application/pdf' },
          { id: '10503', filename: 'photo.jpg', mimeType: 'image/jpeg' },
        ],
        comment: { total: 2, comments: [
          { id: '1', author: { accountId: 'a1', displayName: t.names[0] }, created: '2026-09-02T08:00:00.000+0000', body: FIRST_COMMENT },
          { id: '2', author: { accountId: 'a2', displayName: t.names[1] }, created: '2026-09-02T09:15:00.000+0000', body: { type: 'doc', version: 1, content: [para(t.body)] } },
        ] },
      },
    });
  });
}

function run(command, args) {
  return execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
}

function rasterise(pdfPath, prefix) {
  run(PDFTOPPM, ['-r', '60', '-png', pdfPath, prefix]);
  const stem = prefix.split('/').pop();
  return readdirSync(resolve(prefix, '..')).filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.png')).sort();
}

function sheet(rows) {
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const strip = (r) => r.images.slice(0, SHEET_PAGES).map((f) => `<a href="${escape(f)}"><img loading="lazy" src="${escape(f)}" alt="${escape(f)}"></a>`).join('');
  const body = rows.map((r) => `<section><h2>${escape(r.name)} <small>${r.pages} pages</small></h2><div class="strip">${strip(r)}</div></section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Template matrix</title>
<style>body{font:14px system-ui,sans-serif;margin:16px}h2{font-size:15px;margin:24px 0 6px}small{color:#666;font-weight:400}.strip{display:flex;gap:8px;overflow-x:auto}img{height:360px;border:1px solid #bbb;background:#fff}</style></head>
<body><h1>Template matrix: 8 layouts x A4/Letter x Latin/Cyrillic/CJK</h1>
${body}
</body></html>
`;
}

async function renderAll(templates, context) {
  const { fixtures, images, formats, labels, renderers, prepareIssue, buildLayout } = context;
  const failures = [];
  for (const template of templates) {
    for (const paper of PAPERS) {
      for (const script of Object.keys(TEXTS)) {
        const name = `${template.id}_${paper}_${script}`;
        const count = template.layout === 'single' ? 3 : 12;
        const prepared = sampleIssues(fixtures, script, count).map((issue) => prepareIssue(issue, { catalog: fixtures.catalog, siteUrl: fixtures.SITE, formats }));
        const meta = { jql: 'project = RPT AND status != Done ORDER BY key ASC', exportedAt: formats.dateTime(new Date()), exportedBy: TEXTS[script].names[0], count: prepared.length };
        const spec = buildLayout({ layout: template.layout, issues: prepared, meta, labels, paper });
        const file = join(ROOT, `${name}.${template.format}`);
        try {
          if (template.format === 'pdf') {
            const out = await renderers.pdf({ spec, images, labels, meta });
            writeFileSync(file, out.bytes);
            if (out.emojiDropped || out.imagesDropped) failures.push(`${name}: emojiDropped ${out.emojiDropped}, imagesDropped ${out.imagesDropped}`);
          } else {
            writeFileSync(file, await renderers.docx({ spec, images, labels, meta }));
          }
        } catch (error) {
          failures.push(`${name}: render failed ${error.message}`);
        }
      }
    }
  }
  return failures;
}

function rasteriseAll(failures) {
  const rows = [];
  const wordFiles = readdirSync(ROOT).filter((f) => f.endsWith('.docx'));
  if (wordFiles.length && existsSync(SOFFICE)) {
    for (const f of wordFiles) {
      try {
        run(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', join(ROOT, 'word-pdf'), join(ROOT, f)]);
      } catch (error) {
        failures.push(`${f}: soffice failed ${error.message.slice(0, 120)}`);
      }
    }
  }
  for (const f of readdirSync(ROOT).sort()) {
    const isPdf = f.endsWith('.pdf');
    if (!isPdf && !f.endsWith('.docx')) continue;
    const source = isPdf ? join(ROOT, f) : join(ROOT, 'word-pdf', f.replace(/\.docx$/, '.pdf'));
    if (!existsSync(source)) continue;
    const base = f.replace(/\.(pdf|docx)$/, '');
    const stem = isPdf ? base : `${base}.word`;
    const shots = rasterise(source, join(ROOT, stem));
    rows.push({ name: `${base} (${isPdf ? 'pdf' : 'docx via LibreOffice'})`, pages: shots.length, images: shots });
  }
  writeFileSync(join(ROOT, 'index.html'), sheet(rows));
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const fixtures = await load('test/fixtures/issues.js');
  const { pngBytes } = await load('test/fixtures/images.js');
  const { readImageInfo } = await load('src/core/imageSize.js');
  const { BUILTINS } = await load('src/core/builtins.js');
  const { prepareIssue } = await load('src/core/prepare.js');
  const { buildLayout } = await load('src/core/layouts.js');
  const images = new Map([['10500', pngBytes(1600, 600, 3)], ['10501', pngBytes(320, 200, 9)], ['10503', pngBytes(640, 360, 5)]].map(([id, bytes]) => [id, { ...readImageInfo(bytes), bytes }]));
  const context = {
    fixtures, images, prepareIssue, buildLayout,
    renderers: await nodeRenderers(), labels: await fileLabels(), formats: await fileFormats(),
  };
  const templates = BUILTINS.filter((b) => b.kind === 'layout').filter((b) => !only || b.id === only);
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  const failures = await renderAll(templates, context);
  const rows = args.includes('--skip-raster') ? [] : rasteriseAll(failures);
  const files = readdirSync(ROOT).filter((f) => /\.(pdf|docx)$/.test(f)).length;
  console.log(JSON.stringify({ files, sheets: rows.length, pages: rows.reduce((n, r) => n + r.pages, 0), failures }, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
