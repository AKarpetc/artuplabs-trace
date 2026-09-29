import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = /^(studio|action)-(.+)-(light|dark)-([a-z]{2}-[A-Z]{2})-(\d+)(\.bottom)?\.png$/;
const STATE_ORDER = ['form', 'form-update', 'running', 'done', 'done-update', 'failed', 'unlicensed'];

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function collect(dir) {
  const groups = new Map();
  for (const file of readdirSync(dir).sort()) {
    const match = file.match(NAME);
    if (!match) continue;
    const [, entry, state, theme, locale, width, bottom] = match;
    const key = `${entry}:${state}`;
    const group = groups.get(key) ?? { entry, state, shots: [] };
    group.shots.push({ file, theme, locale, width: Number(width), bottom: Boolean(bottom) });
    groups.set(key, group);
  }
  const rank = (group) => (group.entry === 'studio' ? 0 : 100) + STATE_ORDER.indexOf(group.state);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

function groupHtml(group) {
  const locales = [...new Set(group.shots.map((shot) => shot.locale))];
  const columns = [...new Set(group.shots.filter((shot) => !shot.bottom).map((shot) => `${shot.theme} ${shot.width}`))];
  const head = columns.map((column) => `<th>${escape(column)}</th>`).join('');
  const rows = locales.map((locale) => {
    const cells = columns.map((column) => {
      const [theme, width] = column.split(' ');
      const shots = group.shots.filter((shot) => shot.locale === locale && shot.theme === theme && String(shot.width) === width);
      const images = shots.map((shot) => `<a href="${escape(shot.file)}" target="_blank"><img loading="lazy" src="${escape(shot.file)}" alt="${escape(shot.file)}"></a>`).join('');
      return `<td>${images}</td>`;
    }).join('');
    return `<tr><th scope="row">${escape(locale)}</th>${cells}</tr>`;
  }).join('\n');
  return `<section id="${escape(group.entry)}-${escape(group.state)}"><h2>${escape(group.entry)} · ${escape(group.state)}</h2>
<div class="scroll"><table><thead><tr><th></th>${head}</tr></thead><tbody>
${rows}
</tbody></table></div></section>`;
}

/** Writes `index.html` in `dir`: Matrix A screenshots as a grid per entry and state (rows are locales, columns theme × width). */
export function writeContactSheet(dir) {
  const groups = collect(dir);
  const nav = groups.map((group) => `<a href="#${escape(group.entry)}-${escape(group.state)}">${escape(group.entry)} · ${escape(group.state)}</a>`).join(' ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArtUp Export screenshots</title>
<style>
:root { color-scheme: light dark; --bg: #f7f8f9; --fg: #172b4d; --line: #dcdfe4; }
@media (prefers-color-scheme: dark) { :root { --bg: #1d2125; --fg: #c7d1db; --line: #384048; } }
body { margin: 0; padding: 16px 24px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
nav { position: sticky; top: 0; padding: 8px 0; background: var(--bg); border-bottom: 1px solid var(--line); line-height: 2; }
nav a { margin-right: 12px; color: inherit; }
section { margin-top: 32px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 6px; vertical-align: top; text-align: left; }
td img { display: block; width: 260px; height: auto; margin-bottom: 4px; }
</style></head><body>
<h1>ArtUp Export — screenshot matrix</h1>
<p>Click a thumbnail to open it at full size. Action shots may have a second image: the bottom of the scrolled modal.</p>
<nav>${nav}</nav>
${groups.map(groupHtml).join('\n')}
</body></html>
`;
  const path = resolve(dir, 'index.html');
  writeFileSync(path, html);
  return path;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
  console.log(writeContactSheet(dir));
}
