import { chromium } from '/Users/artyomkarpets/Projects/My/artuplabs-export/static/app/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5391/';
const OUT = process.argv[2];
const ONLY = process.argv[3];
mkdirSync(OUT, { recursive: true });
const icon = `data:image/svg+xml;base64,${readFileSync('/Users/artyomkarpets/Projects/My/artuplabs-export/resources/icon.svg').toString('base64')}`;

const SHOTS = [
  {
    name: '1-studio-form', entry: 'studio', state: '', theme: 'light', scroll: 0,
    title: 'Confluence to git-ready Markdown',
    sub: 'The whole page tree in Confluence order, YAML front-matter and attachments. See the files before you export.',
  },
  {
    name: '2-update-mode', entry: 'studio', state: 'done-update', theme: 'light', scroll: 318, expand: true,
    title: 'Update mode: only what changed',
    sub: 'Drop the previous zip. Get changed pages, a list of files to delete and one command to apply it.',
  },
  {
    name: '3-progress', entry: 'studio', state: 'running', theme: 'light', scroll: 0,
    title: 'Runs in your browser, on Atlassian',
    sub: 'No external servers, no egress. Pages go from Confluence straight into your zip, with your permissions.',
  },
  {
    name: '4-result-warnings', entry: 'studio', state: 'done', theme: 'light', scroll: 318,
    title: 'Nothing is dropped silently',
    sub: 'Every macro, table, user or attachment that could not be converted exactly is listed with its page.',
  },
  {
    name: '5-page-action', entry: 'action', state: '', theme: 'light', scroll: 0, branch: true, height: 640, width: 960, url: 'your-site.atlassian.net/wiki/spaces/DOCS/pages/Runbooks',
    title: 'Export a branch from the page menu',
    sub: '••• → Export to Markdown: this page, or this page with every page below it.',
  },
  {
    name: '6-studio-form-dark', entry: 'studio', state: '', theme: 'dark', scroll: 586,
    title: 'Light and dark, 26 languages',
    sub: 'Follows the Confluence theme and language. YAML front-matter on every page: id, version, author, labels.',
  },
];

function html(shot, src) {
  const dark = shot.theme === 'dark';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 920px; height: 450px; overflow: hidden; }
  body {
    font-family: -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    background:
      radial-gradient(900px 420px at 110% -20%, ${dark ? 'rgba(87,157,255,.28)' : 'rgba(24,104,219,.20)'}, transparent 60%),
      radial-gradient(700px 380px at -10% 120%, ${dark ? 'rgba(148,112,255,.22)' : 'rgba(148,112,255,.16)'}, transparent 60%),
      ${dark ? '#0f1318' : '#f4f7fc'};
    color: ${dark ? '#e3e8ef' : '#172b4d'};
    position: relative;
  }
  .head { position: absolute; left: 44px; right: 44px; top: 26px; display: flex; align-items: flex-start; gap: 14px; }
  .head img { width: 34px; height: 34px; margin-top: 2px; filter: drop-shadow(0 2px 6px rgba(24,104,219,.35)); }
  h1 { margin: 0; font-size: 25px; line-height: 1.15; letter-spacing: -0.015em; font-weight: 750; }
  p { margin: 5px 0 0; font-size: 13.5px; line-height: 1.35; color: ${dark ? '#a3adbb' : '#44546f'}; max-width: 720px; }
  .win {
    position: absolute; left: 44px; right: 44px; top: 104px; height: 380px;
    border-radius: 12px 12px 0 0; overflow: hidden;
    background: ${dark ? '#1d2125' : '#fff'};
    border: 1px solid ${dark ? 'rgba(255,255,255,.10)' : 'rgba(9,30,66,.10)'};
    box-shadow: 0 24px 60px -12px ${dark ? 'rgba(0,0,0,.6)' : 'rgba(9,30,66,.28)'}, 0 2px 6px ${dark ? 'rgba(0,0,0,.4)' : 'rgba(9,30,66,.08)'};
  }
  .bar { position: relative; z-index: 2; height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 12px;
    background: ${dark ? '#22272b' : '#f1f2f4'}; border-bottom: 1px solid ${dark ? 'rgba(255,255,255,.07)' : 'rgba(9,30,66,.08)'}; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: ${dark ? '#454f59' : '#d0d4db'}; }
  .url { margin-left: 14px; flex: 0 1 370px; height: 16px; border-radius: 8px; background: ${dark ? '#161a1d' : '#fff'};
    font-size: 9px; line-height: 16px; padding: 0 10px; color: ${dark ? '#8c9bab' : '#626f86'}; white-space: nowrap; overflow: hidden; }
  .view { position: absolute; top: calc(26px - ${shot.scroll ?? 0}px * var(--s)); left: 0; width: ${shot.width ?? 1280}px; height: ${(shot.height ?? 900) + (shot.scroll ?? 0)}px; transform-origin: 0 0; transform: scale(var(--s)); }
  iframe { width: 100%; height: 100%; border: 0; display: block; background: ${dark ? '#1d2125' : '#fff'}; }
  </style></head><body>
  <div class="head"><img src="${icon}" alt=""><div><h1>${shot.title}</h1><p>${shot.sub}</p></div></div>
  <div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
  <span class="url">${shot.url ?? 'your-site.atlassian.net/wiki/spaces/DOCS/apps/artup-export'}</span></div>
  <div class="view" style="--s:${832 / (shot.width ?? 1280)}"><iframe src="${src}"></iframe></div></div>
  </body></html>`;
}

async function ready(frame, shot) {
  const t = { timeout: 45000 };
  if (shot.state === 'running') {
    await frame.waitForSelector('[data-testid="run-view"]', t);
    await frame.waitForFunction(() => /[1-9]/.test(document.querySelector('[data-testid="run-percent"]')?.textContent ?? ''), null, t);
    let previous = '';
    for (let i = 0; i < 40; i += 1) {
      const current = await frame.textContent('[data-testid="run-percent"]');
      if (current === previous) break;
      previous = current;
      await frame.waitForTimeout(700);
    }
  } else if (shot.state.startsWith('done')) {
    await frame.waitForSelector('[data-testid="result-view"]', t);
  } else if (shot.entry === 'action') {
    await frame.waitForSelector('[data-testid="file-tree-row"]', t);
    await frame.waitForFunction(() => !document.querySelector('[data-testid="action-count-skeleton"]'), null, t);
  } else {
    await frame.waitForSelector('[data-testid="front-matter"]', t);
    await frame.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="studio-export"]')?.textContent ?? ''), null, t);
  }
  await frame.waitForTimeout(400);
}

const browser = await chromium.launch();
for (const shot of SHOTS) {
  if (ONLY && !shot.name.startsWith(ONLY)) continue;
  const context = await browser.newContext({ viewport: { width: 920, height: 450 }, deviceScaleFactor: 2, colorScheme: shot.theme });
  const page = await context.newPage();
  const src = `${BASE}?fixture=showcase&entry=${shot.entry}&locale=en-US&theme=${shot.theme}${shot.state ? `&state=${shot.state}` : ''}`;
  await page.setContent(html(shot, src));
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForLoadState();
  await ready(frame, shot);
  if (shot.branch) {
    await frame.click('[data-testid="action-branch"]');
    await frame.waitForTimeout(800);
  }
  if (shot.expand) {
    await frame.getByText('Apply this update').click();
    await frame.waitForTimeout(600);
  }
  if (shot.scroll === 'stats') {
    await frame.evaluate(() => { const r = document.querySelector('[data-testid="result-view"]'); const cards = [...r.querySelectorAll('*')].find((e) => e.textContent.trim() === 'Changed'); const top = cards.getBoundingClientRect().top + window.scrollY; window.scrollTo(0, top - 44); });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log('shot', shot.name);
  await context.close();
}
await browser.close();
