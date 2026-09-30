import { chromium } from '/Users/artyomkarpets/IncomeApps/projects/DistributB2B/apps/reports/static/app/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const ROOT = '/Users/artyomkarpets/IncomeApps/projects/DistributB2B/apps/reports';
const SHOTS_DIR = `${ROOT}/static/app/screenshots`;
const OUT = process.argv[2];
const ONLY = process.argv[3];
const PDF_PAGE = process.argv[4] ?? `${ROOT}/data/matrix/pdf-sprint_A4_latin-1.png`;
mkdirSync(OUT, { recursive: true });
const uri = (path, type = 'image/png') => `data:${type};base64,${readFileSync(path).toString('base64')}`;
const icon = uri(`${ROOT}/resources/icon.svg`, 'image/svg+xml');

const SHOTS = [
  { name: '1-wizard', file: 'global-export-form-light-en-US-1280.png', scroll: 0,
    title: 'Excel, Word and PDF from Jira', sub: 'Pick issues by filter or JQL, choose a format and a template, and download. The file is built in your browser.' },
  { name: '2-excel-preview', file: 'global-preview-light-en-US-1280.png', scroll: 2020,
    title: 'Excel with the columns you choose', sub: 'Any field, real dates and numbers, key links, a frozen header and a summary sheet. Preview before you export.' },
  { name: '3-result', file: 'global-done-light-en-US-1280.png', scroll: 0,
    title: 'Nothing is dropped silently', sub: 'The result shows issues, time, skipped issues and missing images, and lists every warning.' },
  { name: '4-templates', file: 'global-templates-list-light-en-US-1280.png', scroll: 0,
    title: 'Templates for you, your project or the site', sub: 'Save Excel column sets and upload Word templates made in Word, with placeholders like {{summary}}. No code.' },
  { name: '5-pdf-page', page: true, title: 'PDF pages that stay inside the margins', sub: 'Built-in layouts for A4 and Letter, in Latin, Cyrillic and CJK. Repeating table headers and page numbers.' },
];

function html(shot) {
  const inner = shot.page
    ? `<div class="pdf"><img src="${uri(PDF_PAGE)}"></div>`
    : `<div class="view" style="top:calc(26px - ${shot.scroll}px * var(--s))"><img src="${uri(`${SHOTS_DIR}/${shot.file}`)}"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 920px; height: 450px; overflow: hidden; }
  body { font-family: -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif; position: relative; color: #172b4d;
    background: radial-gradient(900px 420px at 110% -20%, rgba(24,104,219,.20), transparent 60%), radial-gradient(700px 380px at -10% 120%, rgba(148,112,255,.16), transparent 60%), #f4f7fc; }
  .head { position: absolute; left: 44px; right: 44px; top: 26px; display: flex; gap: 14px; }
  .head img { width: 34px; height: 34px; margin-top: 2px; }
  h1 { margin: 0; font-size: 25px; line-height: 1.15; letter-spacing: -0.015em; font-weight: 750; }
  p { margin: 5px 0 0; font-size: 13.5px; line-height: 1.35; color: #44546f; max-width: 780px; }
  .win { position: absolute; left: 44px; right: 44px; top: 104px; height: 380px; border-radius: 12px 12px 0 0; overflow: hidden; background: #fff;
    border: 1px solid rgba(9,30,66,.10); box-shadow: 0 24px 60px -12px rgba(9,30,66,.28), 0 2px 6px rgba(9,30,66,.08); }
  .bar { position: relative; z-index: 2; height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 12px; background: #f1f2f4; border-bottom: 1px solid rgba(9,30,66,.08); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #d0d4db; }
  .url { margin-left: 14px; flex: 0 1 370px; height: 16px; border-radius: 8px; background: #fff; font-size: 9px; line-height: 16px; padding: 0 10px; color: #626f86; white-space: nowrap; overflow: hidden; }
  .view { --s: ${832 / 1280}; position: absolute; left: 0; width: 1280px; transform-origin: 0 0; transform: scale(var(--s)); }
  .view img { width: 1280px; display: block; }
  .pdf { position: absolute; top: 26px; left: 0; right: 0; bottom: 0; background: #e9ebef; display: flex; justify-content: center; overflow: hidden; }
  .pdf img { width: 520px; height: auto; align-self: flex-start; margin-top: 14px; box-shadow: 0 4px 18px rgba(9,30,66,.25); }
  </style></head><body>
  <div class="head"><img src="${icon}" alt=""><div><h1>${shot.title}</h1><p>${shot.sub}</p></div></div>
  <div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
  <span class="url">your-site.atlassian.net/jira/apps/artup-reports</span></div>${inner}</div>
  </body></html>`;
}

const browser = await chromium.launch();
for (const shot of SHOTS) {
  if (ONLY && !shot.name.startsWith(ONLY)) continue;
  const context = await browser.newContext({ viewport: { width: 920, height: 450 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(html(shot));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  await context.close();
}
await browser.close();
