# ArtUp Export v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Forge app for Confluence Cloud that exports a page, a branch or a whole space as git-ready Markdown (full depth, Confluence order, stable paths, front-matter, attachments, incremental updates, manifest) into a zip the user downloads — with a polished native-looking UI in all 26 Confluence languages, light and dark.

**Architecture:** Variant A of the brief (assembly in the browser), confirmed or rejected by gate G4 in Phase 0. The Custom UI reads Confluence through `requestConfluence` from `@forge/bridge` (as the user, so permissions are exactly the user's), converts storage format to Markdown with pure functions, packs a zip with `fflate` and saves it as a Blob. **No server-side state:** stable paths and incremental updates come from the previous export's `export-manifest.json`, which the user drops in (the manifest lives in their git repo anyway). The only backend function is a license resolver.

**Tech Stack:** Forge (Custom UI, `confluence:spacePage`, `confluence:contentAction`, resolver on nodejs24.x), React 18, Vite, Atlaskit + `@atlaskit/tokens`, `htmlparser2` (storage-format parser), `fflate` (zip), Vitest + @testing-library/react + jsdom, Playwright (dev-only, screenshots).

**Spec:** `atlassian/20_app2_markdown_export.md` (brief, binding) + owner requirements of 2026-09-28: **visual parts are built beautiful from the first commit** (no "make it pretty later" task) and **all languages from the first commit** (no "translate later" task). Reference implementation of patterns: `~/Projects/My/artuplabs-trace` (main), plans `atlassian/plans/2026-09-24-artup-trace-v1*.md`, `2026-09-25-artup-trace-custom-ui.md`.

---

## Для владельца: что решено в плане без вас (нужно ваше «да»)

| # | Решение | Почему | Цена ошибки |
|---|---|---|---|
| D1 | **Сборка в браузере (вариант A)**; если G4 его не пропустит — стоп и перепланирование задач 10–12 под вариант B | нет лимитов 5 МБ / 900 с, права ровно пользовательские, почти нет хранения | переписать конвейер (ядро и UI остаются) |
| D2 | **Никакого хранения на сервере.** Инкремент и стабильные пути — из `export-manifest.json` прошлой выгрузки: пользователь перетаскивает прошлый zip или манифест | нет персональных данных, нет утечки путей чужих страниц между пользователями, нет Forge SQL, работает для любого репозитория/ветки; манифест и так лежит в git | лишнее действие пользователя; «помнить последнюю выгрузку» — в v1.1 (scope `storage:app` уже заявлен, D8) |
| D3 | **Порядок по умолчанию — поле в front-matter** (`weight` / `sidebar_position`), числовые префиксы `010-` — переключатель | префиксы меняются при перестановке страниц и ломают «стабильные пути» | — |
| D4 | **Путь следует за заголовком и родителем**: переименовали/переместили — новый путь, старый попадает в список удаления; при совпадении заголовков у соседей старшая (меньший id) страница получает чистое имя, остальные `имя-<id>`, и однажды выданное имя сохраняется между выгрузками | предсказуемо, git видит переименование | — |
| D5 | **Пресеты**: Generic, Hugo (`_index.md`, `weight`), Docusaurus (`sidebar_position`, `_category_.json`), MkDocs (`.pages` для awesome-pages) | «порядок как в Confluence» доезжает до реального сайта документации — этого нет ни у кого | четыре маленькие чистые функции |
| D6 | **Имена файлов**: ASCII-транслит (латиница с диакритикой, кириллица, греческий) по умолчанию, режим Unicode — переключатель; CJK в ASCII → `page-<id>` | дефект лидера «режет диакритику» | — |
| D7 | **Вложения** рядом со страницей: `page.md` → `page.assets/файл.png`; режимы «все / только используемые / без вложений», лимит размера файла (по умолчанию 50 МБ) | ноль коллизий, git-diff читаемый | — |
| D8 | Scopes v1 (только чтение + `storage:app` про запас под v1.1): финальный список фиксирует G4 | добавить scope позже = мажорная версия | вопрос ревьюера о неиспользуемом `storage:app` |
| D9 | Два входа: **страница пространства** «ArtUp Export» (студия экспорта) и **пункт «…» страницы** «Экспорт в Markdown» (модальное окно для страницы/ветки) | быстрый путь для одной ветки + полный для пространства | — |
| D10 | Нулевой diff: в выгруженных файлах **нет времени выгрузки**; время, счётчики и предупреждения — в отчёте в UI; удаления — в `export-deleted.txt`, только когда он не пуст | критерий приёмки брифа §10 | — |
| D11 | Названия модулей в меню Confluence тоже переведены на 26 языков (i18n манифеста Forge) | «все языки» — включая меню | — |

**До старта исполнения от владельца нужно:** подключить Confluence (Free) к `artuplabs-dev.atlassian.net`, если его нет (проверяется в Task 0.2, шаг 1).

---

## Global Constraints

- Only Forge; zero Connect modules; **zero egress** — no `permissions.external`, no remote fonts/CDN/images; `forge eligibility -e development --non-interactive` must print eligible for Runs on Atlassian after every deploy.
- Read-only product access. Scopes are declared in full in v1 (list fixed by Task 0.2): expected `read:page:confluence`, `read:space:confluence`, `read:attachment:confluence`, `read:label:confluence`, `read:hierarchical-content:confluence`, `read:confluence-user`, `search:confluence`, `storage:app`. Never add `write:*`.
- `permissions.content.styles: ['unsafe-inline']` (Atlaskit), like Trace.
- No personal data persisted anywhere: author display names are fetched at export time and written only into the user's zip.
- Custom UI: React 18 + Atlaskit components + `@atlaskit/primitives` (`Box`, `Stack`, `Inline`, `Grid`, `xcss`) + design tokens only. **No hex/rgb/hsl/named colours** in `static/app/src` (a test enforces it). Icons from `@atlaskit/icon` or own SVG components filled with `token(...)`.
- Every user-visible string goes through `t('key')`; `static/app/src/i18n/locales/en-US.json` is the key source; **all 26 locale files are complete and in sync in the same commit that introduces a key** (tests enforce key parity, placeholder parity and plural categories). Locales: zh-CN, zh-TW, cs-CZ, da-DK, nl-NL, en-US, en-GB, et-EE, fi-FI, fr-FR, de-DE, hu-HU, is-IS, it-IT, ja-JP, ko-KR, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, tr-TR, es-ES, sv-SE.
- Numbers, dates, sizes and durations via `Intl` with the resolved locale; plurals via `Intl.PluralRules` (Task 2).
- Exported content (Markdown text, front-matter keys, file names) is **not** translated — it is the customer's content.
- Visual standard (applies to every UI task, checked by screenshots in Task 17): full width with `space.300` side padding; sections separated by `space.400`; cards use `elevation.surface.raised` + `border.radius.200`; one primary button per view; headings via `@atlaskit/heading`; body 14px; long strings wrap, never overflow; below 900px the two-column layout becomes one column; loading states are skeletons or spinners in place, never blank; every empty/error state has an illustration + one sentence + one action.
- Core logic (`static/app/src/core/**`) is pure: no I/O, no `Date.now()`, no randomness; I/O in `static/app/src/infra/**`; orchestration in `static/app/src/export/**`; components thin.
- Output determinism: same Confluence content + same options + same previous manifest ⇒ byte-identical files (zip entry order may differ; file contents may not).
- Code style as in Trace: vanilla JS/JSX, ES modules, no `//` comments inside function bodies, JSDoc 1–2 lines on exported functions/components.
- Commits: `EXPORT-<n>: <Description>` + blank line + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push; never merge to main without the owner; the GitHub repo is created by the owner.
- Secrets: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a` before forge commands; never print tokens.
- `forge install --upgrade` may hang after success: run it as `perl -e 'alarm 300; exec @ARGV' forge install ...`.
- Decisions taken without the owner go to `atlassian/plans/2026-09-28-artup-export-v1-rulings.md` as `Ruling Rn: <decision> — <why> — cost if wrong: <…>` and are listed at the end of the session.

## Review Focus

1. **Sibling pages whose titles collide only by case or transliteration** ("API" / "api", "Café" / "Cafe", "Ёж" / "Еж") → distinct files on case-insensitive filesystems (macOS, Windows), same names on the next export. Tests: Task 4 `planPaths` collision cases.
2. **A page moved or renamed while its old path is reused by another page** (swap of two titles) → the update zip contains both new files and `export-deleted.txt` never lists a path that is written in the same export. Test: Task 8 `planUpdate` swap case.
3. **Restricted pages the current user cannot see, present in a manifest made by someone with more rights** → reported as "not found (deleted or no access)", listed for deletion only in the report, no crash, no title of an unseen page shown in the UI. Test: Task 8 missing-page case + Task 11 pipeline case.
4. **Storage format the converter does not know** (new-editor `ac:adf-extension`, third-party macros, nested tables, lists inside table cells, CDATA with `]]>`-like text, code containing backticks) → never lost silently: fallback content or a placeholder comment plus a warning row in the report. Tests: Task 5/6 cases.
5. **Long translations and long titles** (German/Finnish UI strings, 250-char page titles, CJK titles) → no clipped buttons/tabs/labels in any of 26 locales, tree preview wraps. Check: Task 17 overflow probe over all locales + screenshots.

---

## Phase 0 — gates before code (brief §3). Any "close" verdict → stop and report to the owner with numbers.

### Task 0.1: Desk gates G1–G3

**Files:**
- Create: `atlassian/tools/scan_export_competitors.py`
- Modify: `atlassian/20_app2_markdown_export.md` (§11 rows G1–G3)
- Data (gitignored): `atlassian/data/export_competitors.json`, `atlassian/data/reviews_export.json`

- [ ] **Step 1: G1 — built-in export.** Read Atlassian docs (search "Confluence Cloud export page to Markdown", "export space", "copy as Markdown") and record: which scopes of export exist (page / tree / space), which formats, whether links and attachments are kept. Manual confirmation happens in Task 0.2 Step 2 on the dev site. Verdict "close" only if the built-in export already produces a **hierarchy with attachments** in Markdown.

- [ ] **Step 2: G2 — competitor scan script.** Reuse the HTTP helper pattern from `atlassian/tools/fetch_marketplace.py` (retry, failures list, UA). Query `https://marketplace.atlassian.com/rest/2/addons?text=<word>&application=confluence&hosting=cloud&limit=50` for each word in `export, markdown, git, github, gitlab, docs-as-code, static site, mkdocs, docusaurus, hugo, backup`; dedupe by addon key; for each addon fetch `/rest/2/addons/<key>` and keep: key, name, installs (`distribution.totalInstalls`), tagLine, summary, description text, Forge/Connect flag (as in `check_forge_native.py`). Flag an addon when its text mentions **all three**: stable/deterministic paths (regex `stable|deterministic|same path|consistent path`), front-matter (`front.?matter|yaml header|metadata header`), incremental (`incremental|only changed|delta|since last`).

```bash
cd /Users/artyomkarpets/IncomeApps/projects/DistributB2B/atlassian
python3 tools/scan_export_competitors.py --out data/export_competitors.json
python3 -c "import json;d=json.load(open('data/export_competitors.json'));print(len(d['apps']),'apps');[print(a['installs'],a['name'],a['flags']) for a in sorted(d['apps'],key=lambda a:-a['installs'])[:25]]"
```

Read the descriptions of the top 25 by installs and every flagged addon (lesson from `10_action_list.md` §1: names lie). Verdict "close" if a Forge app has all three features and ≥200 installs.

- [ ] **Step 3: G3 — price tolerance.** `python3 tools/fetch_reviews.py` for "Git for Confluence" and "Markdown Exporter for Confluence" (by addon key, all stars, not only 1–2 — add a `--all-stars` flag if the script lacks it). Count reviews mentioning price (`price|expensive|cost|pricing|cheap|money`). ≥3 price complaints for Git for Confluence → recompute the price in §2 of the brief, do not close.

- [ ] **Step 4: Record** G1–G3 in §11 of the brief (result with numbers, date 2026-09-2x, verdict). Commit in the DistributB2B repo:

```bash
cd /Users/artyomkarpets/IncomeApps/projects/DistributB2B
git add atlassian/tools/scan_export_competitors.py atlassian/20_app2_markdown_export.md
git commit -m "Record export gates G1-G3 for ArtUp Export

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 0.2: G4 — feasibility spike on 1 000 pages (throwaway code)

**Files:**
- Create: `~/Projects/My/artuplabs-export-spike/` (throwaway Forge app, never shipped; deleted after the gate) — `forge create -t confluence-space-page-ui-kit artuplabs-export-spike`, then converted to Custom UI exactly like Task 1 but with one screen and a "Run spike" button.
- Create (kept, moves to the product repo in Task 1): `scripts/seed-space.mjs`
- Modify: `atlassian/20_app2_markdown_export.md` §11 row G4

- [ ] **Step 1: Confluence on the dev site.** `curl -s -u "$FORGE_EMAIL:$FORGE_API_TOKEN" https://artuplabs-dev.atlassian.net/wiki/api/v2/spaces?limit=1 -o /dev/null -w '%{http_code}'` → 200 means Confluence is there. Anything else → stop, ask the owner to add Confluence Free to artuplabs-dev (browser, admin.atlassian.com → Products → Add).

- [ ] **Step 2: G1 manual check.** On one page with a child and an attachment: page "…" → Export — note every format offered and whether a tree/space Markdown export exists. Record for §11.

- [ ] **Step 3: Seed script.** `scripts/seed-space.mjs` (Node 22, `fetch` with basic auth from env, no dependencies): creates space `EXPT` ("Export test") via `POST /wiki/api/v2/spaces` (fallback `POST /wiki/rest/api/space`), then a tree of `--pages` (default 1000) pages, branching factor 4, depth ≥ 6, created in batches of 5 concurrent requests with `Retry-After` handling. Title generator cycles through: plain English, diacritics (`Café Déjà vu`, `Łódź plan`, `Straße`), Cyrillic (`Привет, мир`, `Щука и ёж`), Greek (`Αθήνα`), CJK (`设计文档`, `日本語のページ`), duplicates among siblings (`Notes` ×3, `API` + `api`), 250-char titles, emoji. Body template (storage format) includes: headings, nested lists, a task list, a 4×3 table, a table with `colspan`, a `code` macro with backticks inside, `info`/`warning` panels, an `expand`, a `status` macro, a `toc` macro, links to 2 random earlier pages by title (`<ac:link><ri:page ri:content-title="…"/></ac:link>`), an image of an attachment. Every 10th page gets 2 attachments (a 1×1 PNG and a generated 2 MB binary) via `POST /wiki/rest/api/content/{id}/child/attachment` with `X-Atlassian-Token: no-check`. Writes `data/seed-EXPT.json` (ids, titles, parents) for later checks. Flags: `--space`, `--pages`, `--dry-run`.

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
node scripts/seed-space.mjs --space EXPT --pages 1000
```

Expected: `created 1000 pages, 200 attachments, depth 6` and the space visible in the browser.

- [ ] **Step 4: Spike measurements** from inside the Custom UI (space page of EXPT, as the user) — each prints a line into the page and `console.log`:
  1. Tree scan by BFS over `GET /wiki/api/v2/pages/{id}/children?limit=250` (also try `GET /wiki/api/v2/spaces/{id}/pages?depth=root`): time, number of calls, is the order equal to the sidebar order (compare with `childPosition`)? Does the v2 page object carry `position`?
  2. Batch bodies: `GET /wiki/api/v2/pages?id=<250 ids>&body-format=storage&limit=250` — works? time for 1 000 pages; response size.
  3. Attachments: `GET /wiki/api/v2/pages/{id}/attachments`, download `/wiki` + `downloadLink` through `requestConfluence` — does `response.arrayBuffer()` (or `.blob()`) return the exact bytes (compare size)? Time for 200 files / 200 MB.
  4. Users: `GET /wiki/rest/api/user/bulk?accountId=…` — works, max ids per call.
  5. Search for the picker: `GET /wiki/rest/api/search?cql=type=page and space="EXPT" and title~"caf*"&limit=20`.
  6. Rate limiting: run steps 1–3 with concurrency 4, 6, 8 — count 429s, record `Retry-After` values.
  7. Zip: parse all bodies with `htmlparser2`, zip with `fflate` streaming (`Zip` + `ZipDeflate`, attachments `ZipPassThrough`), save Blob — total time, peak JS heap (`performance.memory` in Chrome), final size; does the download start inside the iframe?
  8. Scopes: remove one scope at a time from the spike manifest and redeploy only if a call fails with 403 — record the minimal working list; add `storage:app` per D8.
  9. Context shape: log `view.getContext()` for `confluence:spacePage` and `confluence:contentAction` (paths of space key/id, content id, `siteUrl`, `locale`, `license`).

- [ ] **Step 5: Verdict.** G4 passes if full export of 1 000 pages with 200 attachments completes in the browser within 10 minutes without a tab crash, with correct order and exact attachment bytes. Otherwise measure variant B (queue consumer, 900 s, KVS chunks) the same way; if neither fits the Forge limits without egress → close. Record numbers in §11 (every number measured, per `context/method.md`), and adjust this plan's API paths/scopes in Tasks 1 and 10 to the measured ones **before** Task 1 starts (commit the plan change). Delete the spike app: `forge settings`… then `rm -rf ~/Projects/My/artuplabs-export-spike` after copying `scripts/seed-space.mjs` into the product repo in Task 1.

- [ ] **Step 6: Gate report to the owner.** One message: G1–G4 verdicts with numbers; if all pass — "Phase 0 passed, starting Task 1" (the owner already approved the plan); if any closes — stop.

---

## File Structure (product repository `~/Projects/My/artuplabs-export`)

```
manifest.yml                         spacePage + contentAction, resolver, scopes, licensing, i18n
package.json                         root: @forge/resolver; lint/test/build scripts
src/index.js                         exports resolverHandler
src/access.js                        pure licence decision
src/resolvers.js                     getAccess resolver
test/access.test.js, test/resolvers.test.js
locales/*.json                       26 manifest translations (module titles)
resources/icon.svg                   app icon (also used by the content action)
scripts/seed-space.mjs               test data (from Task 0.2)
scripts/verify-zero-diff.mjs         acceptance: two zips → identical trees
.github/workflows/ci.yml, .github/dependabot.yml, AGENTS.md, README.md, .eslintrc
static/app/package.json, vite.config.js
static/app/space-page/index.html     entry: export studio
static/app/content-action/index.html entry: modal
static/app/preview/index.html        visual harness (dev only, not deployed)
static/app/src/theme.js              bootstrap: theme + context
static/app/src/api.js                invoke wrapper + error mapping
static/app/src/i18n/index.js         resolveLocale, createT (plurals), provider, formatters
static/app/src/i18n/locales/*.json   26 UI locales
static/app/src/core/slug.js          transliteration + slug
static/app/src/core/paths.js         stable path planner
static/app/src/core/presets.js       presets + preset extra files
static/app/src/core/frontMatter.js   YAML front-matter
static/app/src/core/links.js         relative paths, attachment paths
static/app/src/core/manifest.js      build/parse manifest
static/app/src/core/increment.js     update planning (changed/moved/deleted)
static/app/src/core/convert/*.js     storage → Markdown (parse, escape, inline, blocks, tables, macros, index)
static/app/src/infra/pool.js         concurrency pool
static/app/src/infra/confluence.js   REST client over requestConfluence
static/app/src/infra/zip.js          zip writer/reader (fflate)
static/app/src/infra/download.js     Blob save
static/app/src/export/tree.js        scan tree from a target
static/app/src/export/pipeline.js    export orchestration with progress + cancel
static/app/src/components/*.jsx      shared visual components
static/app/src/studio/*.jsx          space page (studio)
static/app/src/action/*.jsx          content action modal
static/app/src/illustrations/*.jsx   token-coloured SVG illustrations
static/app/test/**                   vitest
static/app/scripts/screenshots.mjs   Playwright screenshot matrix + overflow probe
```

---

### Task 1: Repository, Forge app, manifest (26-language module titles), CI

**Files:**
- Create: everything at repo root listed above except `static/app/**` and `scripts/verify-zero-diff.mjs`
- Test: `test/access.test.js`, `test/resolvers.test.js`

**Interfaces:**
- Produces: resolver key `getAccess` → `{ licensed: boolean, environmentType: string }`; `decideLicence({ environmentType, license })` in `src/access.js`.

- [ ] **Step 1: Create the app** (template per AGENTS.md rules, then converted to Custom UI in Task 2):

```bash
cd ~/Projects/My && test ! -e artuplabs-export && forge create -t confluence-space-page-ui-kit artuplabs-export
cd artuplabs-export && git init -b main && ls -la
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a && forge register
```

Choose Developer Space "ArtUp Labs". Delete the template's UI Kit frontend (`src/frontend`) and `@forge/react`. Copy `AGENTS.md`, `.eslintrc`, `.github/` and `vitest.config.mjs` from `~/Projects/My/artuplabs-trace`, replace "Jira" wording with "Confluence" in AGENTS.md. Copy `scripts/seed-space.mjs` from the spike.

- [ ] **Step 2: Write the failing licence test** `test/access.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { decideLicence } from '../src/access.js';

describe('decideLicence', () => {
  it('allows any non-production environment', () => {
    expect(decideLicence({ environmentType: 'DEVELOPMENT' })).toEqual({ licensed: true });
  });
  it('allows production with an active licence (active or isActive)', () => {
    expect(decideLicence({ environmentType: 'PRODUCTION', license: { active: true } })).toEqual({ licensed: true });
    expect(decideLicence({ environmentType: 'PRODUCTION', license: { isActive: true } })).toEqual({ licensed: true });
  });
  it('denies production with a missing or inactive licence', () => {
    expect(decideLicence({ environmentType: 'PRODUCTION' })).toEqual({ licensed: false });
    expect(decideLicence({ environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ licensed: false });
  });
});
```

- [ ] **Step 3: Run** `npx vitest run test/access.test.js` → FAIL (module not found).

- [ ] **Step 4: Implement** `src/access.js`, `src/resolvers.js`, `src/index.js`:

```js
/** Licence decision: production needs an active licence, other environments are always licensed. */
export function decideLicence({ environmentType, license }) {
  if (environmentType !== 'PRODUCTION') {
    return { licensed: true };
  }
  return { licensed: (license?.active ?? license?.isActive) === true };
}
```

```js
import Resolver from '@forge/resolver';
import { decideLicence } from './access.js';

const resolver = new Resolver();

resolver.define('getAccess', ({ context }) => ({
  ...decideLicence({ environmentType: context.environmentType, license: context.license }),
  environmentType: context.environmentType ?? '',
}));

/** Forge resolver entry point. */
export const handler = resolver.getDefinitions();
```

```js
export { handler as resolverHandler } from './resolvers.js';
```

`test/resolvers.test.js` mocks `@forge/resolver` (as Trace's `test/handlers/resolvers.test.js` does) and asserts `getAccess` returns `{ licensed: false, environmentType: 'PRODUCTION' }` for a production context without licence and `{ licensed: true, environmentType: 'DEVELOPMENT' }` otherwise.

- [ ] **Step 5: Manifest** `manifest.yml` (API paths/scopes adjusted to Task 0.2 findings):

```yaml
modules:
  confluence:spacePage:
    - key: export-space-page
      resource: space-page
      resolver:
        function: resolver
      title:
        i18n: module.spacePage.title
      route: artup-export
      icon: resource:icons;icon.svg
  confluence:contentAction:
    - key: export-content-action
      resource: content-action
      resolver:
        function: resolver
      title:
        i18n: module.contentAction.title
      viewportSize: large
  function:
    - key: resolver
      handler: index.resolverHandler
resources:
  - key: space-page
    path: static/app/dist/space-page
  - key: content-action
    path: static/app/dist/content-action
  - key: icons
    path: resources
translations:
  resources:
    - key: en-US
      path: locales/en-US.json
    # one entry per locale, 26 in total, same order as Global Constraints
  fallback:
    default: en-US
permissions:
  scopes:
    - read:page:confluence
    - read:space:confluence
    - read:attachment:confluence
    - read:label:confluence
    - read:hierarchical-content:confluence
    - read:confluence-user
    - search:confluence
    - storage:app
  content:
    styles:
      - 'unsafe-inline'
app:
  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64
  id: <from forge register>
  licensing:
    enabled: true
```

Write all 26 `translations.resources` entries explicitly (no comment in the committed file). `locales/<locale>.json` each contains exactly two keys, translated:

```json
{ "module.spacePage.title": "ArtUp Export", "module.contentAction.title": "Export to Markdown" }
```

(e.g. ru-RU: `"Экспорт в Markdown"`, de-DE: `"Als Markdown exportieren"`, ja-JP: `"Markdown にエクスポート"`; "ArtUp Export" stays untranslated everywhere). Add `test/manifestLocales.test.js`: every file in `locales/` has exactly the keys of `locales/en-US.json`, non-empty strings, and `manifest.yml` lists all 26 (parse with a regex over `- key:` lines under `translations`).

- [ ] **Step 6: Root `package.json`** (versions: current at install, pinned exactly):

```json
{
  "name": "artuplabs-export",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "eslint src/**/*",
    "test": "vitest run",
    "build:ui": "npm --prefix static/app run build",
    "test:ui": "npm --prefix static/app test",
    "screenshots": "npm --prefix static/app run screenshots"
  }
}
```

CI copied from Trace (`lint`, `test`, `test:ui`, `build:ui`, `npm audit` for both). `.gitignore`: `node_modules/`, `static/app/dist/`, `static/app/screenshots/`, `data/`, `.env`.

- [ ] **Step 7: Run** `npm test` → PASS; `forge lint` → no errors (fix i18n syntax here if lint complains — record a Ruling).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "EXPORT-1: Scaffold the Forge app with licence resolver and translated module titles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Custom UI shell, theme, i18n with plurals, guard tests

**Files:**
- Create: `static/app/package.json`, `static/app/vite.config.js`, `static/app/space-page/index.html`, `static/app/content-action/index.html`, `static/app/src/theme.js`, `static/app/src/api.js`, `static/app/src/i18n/index.js`, `static/app/src/i18n/locales/*.json` (26), `static/app/src/studio/main.jsx`, `static/app/src/action/main.jsx`, `static/app/src/studio/StudioApp.jsx` (placeholder shell), `static/app/src/action/ActionApp.jsx` (placeholder shell), `static/app/test/setup.js`
- Test: `static/app/test/i18n.test.js`, `static/app/test/guards.test.js`, `static/app/test/smoke.test.jsx`

**Interfaces:**
- Consumes: resolver `getAccess` (Task 1).
- Produces: `bootstrap()` → `{ context }`; `I18nProvider({ locale })`, `useT()`, `useLocale()`, `createT(locale, dictionaries)`, `resolveLocale(raw)`, `SUPPORTED_LOCALES`, `formatNumber(locale, n)`, `formatDate(locale, iso)`, `formatBytes(locale, bytes)`, `formatDuration(t, ms)`; `call(key, payload)`, `AppError`, `errorMessage(t, error)`.

- [ ] **Step 1: Package and Vite.** Copy `static/app/package.json` and `vite.config.js` from Trace; entries become `space-page`, `content-action`, `preview` (preview is built only by the harness, not by `build`):

```js
const pageDirs = { 'space-page': 'space-page', 'content-action': 'content-action', preview: 'preview' };
```

`"build": "vite build --mode space-page && vite build --mode content-action"`, `"screenshots": "node scripts/screenshots.mjs"`. Dependencies (exact pins; the Trace ones at Trace's versions, new ones current): Trace set + `@atlaskit/radio`, `@atlaskit/toggle`, `@atlaskit/progress-tracker`, `@atlaskit/badge`, `@atlaskit/modal-dialog`, `@atlaskit/tooltip`, `@atlaskit/icon`, `@atlaskit/skeleton`, `htmlparser2`, `fflate`; devDependencies Trace set + `playwright`.

- [ ] **Step 2: Write the failing i18n tests** `static/app/test/i18n.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createT, resolveLocale, SUPPORTED_LOCALES, localeDictionaries, formatBytes } from '../src/i18n/index.js';

const en = localeDictionaries['en-US'];
const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

describe('resolveLocale', () => {
  it.each([
    ['ru_RU', 'ru-RU'], ['ru', 'ru-RU'], ['pt', 'pt-BR'], ['en_GB', 'en-GB'], ['nb-NO', 'no-NO'],
    ['zh', 'zh-CN'], ['zh_TW', 'zh-TW'], ['xx_YY', 'en-US'], ['', 'en-US'], [undefined, 'en-US'],
  ])('%s → %s', (raw, expected) => expect(resolveLocale(raw)).toBe(expected));
});

describe('locale files', () => {
  it('ship all 26 locales', () => {
    expect(Object.keys(localeDictionaries).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
  it.each(SUPPORTED_LOCALES)('%s has exactly the en-US keys and entry shapes', (locale) => {
    const dict = localeDictionaries[locale];
    expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(typeof dict[key]).toBe(typeof en[key]);
    }
  });
  it.each(SUPPORTED_LOCALES)('%s keeps placeholders and plural categories', (locale) => {
    const dict = localeDictionaries[locale];
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, value] of Object.entries(en)) {
      if (typeof value === 'string') {
        expect([...placeholders(dict[key])].sort(), `${locale} ${key}`).toEqual([...placeholders(value)].sort());
        continue;
      }
      for (const category of categories) {
        expect(dict[key][category], `${locale} ${key}.${category}`).toBeTypeOf('string');
        expect([...placeholders(dict[key][category])].every((p) => placeholders(value.other).has(p))).toBe(true);
      }
    }
  });
  it.each(SUPPORTED_LOCALES)('%s has no empty strings', (locale) => {
    const flat = Object.values(localeDictionaries[locale]).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)));
    expect(flat.every((s) => s.trim().length > 0)).toBe(true);
  });
});

describe('createT', () => {
  const dicts = {
    'en-US': { hello: 'Hello {name}', pages: { one: '{count} page', other: '{count} pages' } },
    'ru-RU': { hello: 'Привет {name}', pages: { one: '{count} страница', few: '{count} страницы', many: '{count} страниц', other: '{count} страницы' } },
  };
  it('fills placeholders and formats numbers per locale', () => {
    const t = createT('ru-RU', dicts);
    expect(t('hello', { name: 'Аня' })).toBe('Привет Аня');
    expect(t('pages', { count: 1 })).toBe('1 страница');
    expect(t('pages', { count: 3 })).toBe('3 страницы');
    expect(t('pages', { count: 1024 })).toBe('1\u00a0024 страницы');
    expect(t('pages', { count: 5 })).toBe('5 страниц');
  });
  it('falls back to en-US, then to the key', () => {
    const t = createT('ja-JP', dicts);
    expect(t('pages', { count: 2 })).toBe('2 pages');
    expect(t('missing.key')).toBe('missing.key');
  });
});

describe('formatBytes', () => {
  it('uses locale units', () => {
    expect(formatBytes('en-US', 1536)).toBe('1.5 kB');
    expect(formatBytes('en-US', 5 * 1024 * 1024)).toBe('5 MB');
  });
});
```

(`Intl` output for `1 024` uses the locale's group separator; if the Node ICU prints a narrow NBSP `\u202f`, assert with `new Intl.NumberFormat('ru-RU').format(1024)` instead of a literal.)

- [ ] **Step 3: Write the failing guard tests** `static/app/test/guards.test.js`:

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src', import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
const code = files(SRC).filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('/locales/'));

describe('source guards', () => {
  it('uses no hard-coded colours', () => {
    const offenders = code.filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('renders no literal text in JSX', () => {
    const literal = /<[A-Za-z][^<>]*>\s*[\p{L}][^<>{}]*<\//u;
    const offenders = code.filter((f) => f.endsWith('.jsx') && literal.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('has no comments inside function bodies', () => {
    const offenders = code.filter((f) => /^\s+\/\/(?!\s*eslint)/m.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Run** `npm --prefix static/app test` → FAIL.

- [ ] **Step 5: Implement i18n** — copy Trace's `static/app/src/i18n/index.js` and change `createT`/`applyPlaceholders`, add `formatBytes`, `formatDuration`:

```js
function applyPlaceholders(locale, template, values) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values?.[name];
    if (value === undefined || value === null) return '';
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : String(value);
  });
}

function pick(entry, locale, values) {
  if (entry === undefined || entry === null || typeof entry === 'string') return entry;
  const category = new Intl.PluralRules(locale).select(Number(values?.count ?? 0));
  return entry[category] ?? entry.other;
}

/** Builds t(key, values): locale entry, then en-US, then the key; plural entries pick by values.count. */
export function createT(locale, dictionaries) {
  const dict = dictionaries[locale] || {};
  const fallback = dictionaries[DEFAULT_LOCALE] || {};
  return function t(key, values) {
    const own = pick(dict[key], locale, values);
    if (own !== undefined && own !== null) return applyPlaceholders(locale, own, values);
    const base = pick(fallback[key], DEFAULT_LOCALE, values);
    return base !== undefined && base !== null ? applyPlaceholders(DEFAULT_LOCALE, base, values) : key;
  };
}

/** Formats a byte count as kB/MB/GB with locale digits. */
export function formatBytes(locale, bytes) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let value = Math.max(0, Number(bytes) || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: 'unit', unit: units[index], unitDisplay: 'short', maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
  }).format(value);
}

/** Formats milliseconds as "1 min 5 s" through translated units. */
export function formatDuration(t, ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? t('time.minutesSeconds', { minutes, seconds: seconds % 60 })
    : t('time.seconds', { seconds });
}
```

`SUPPORTED_LOCALES`, `resolveLocale`, `LANGUAGE_PREFERENCE`, provider and hooks unchanged from Trace.

- [ ] **Step 6: Base locale keys** — `en-US.json` (every other locale fully translated, same keys):

```json
{
  "app.name": "ArtUp Export",
  "app.tagline": "Git-ready Markdown from Confluence",
  "loading": "Loading…",
  "errors.generic": "Something went wrong: {message}",
  "errors.bad-request": "The request was not valid. Reload the page and try again.",
  "errors.unlicensed": "Your ArtUp Export licence is not active.",
  "unlicensed.title": "ArtUp Export needs an active licence",
  "unlicensed.body": "Ask your Confluence administrator to start a trial or renew the subscription in Manage apps.",
  "time.seconds": "{seconds} s",
  "time.minutesSeconds": "{minutes} min {seconds} s"
}
```

Translation rule for every task: translate with the product's tone (short, neutral, imperative for actions), keep `{placeholders}` and the brand names ArtUp Export, Confluence, Markdown, Git, Hugo, Docusaurus, MkDocs, YAML untranslated; use the target language's own quotation marks and number formatting is left to Intl.

- [ ] **Step 7: Theme, API, entries.** `theme.js` and `api.js` copied from Trace (`KNOWN_CODES = ['unlicensed', 'bad-request']`). `studio/main.jsx`:

```jsx
import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { StudioApp } from './StudioApp.jsx';

/** Boots the space page: theme, locale, then the studio. */
async function main() {
  const { context } = await bootstrap();
  createRoot(document.getElementById('root')).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <StudioApp context={context} />
    </I18nProvider>,
  );
}

main();
```

`action/main.jsx` is the same with `ActionApp`. The placeholder `StudioApp`/`ActionApp` render `<Heading size="large">{t('app.name')}</Heading>` in a `Box padding="space.300"`. Smoke test renders both with a mocked `@forge/bridge` (copy Trace `test/setup.js`) and finds the translated app name.

- [ ] **Step 8: Run** `npm --prefix static/app test` → PASS; `npm run build:ui` → `dist/space-page/index.html` and `dist/content-action/index.html` exist.

- [ ] **Step 9: Deploy to development.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
npm run build:ui && forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install --site artuplabs-dev.atlassian.net --product confluence -e development --non-interactive
forge eligibility -e development --non-interactive
```

Expected: eligible; "ArtUp Export" appears in the EXPT space sidebar; "Export to Markdown" in the page "…" menu (translated when the Confluence profile language is switched to Русский).

- [ ] **Step 10: Commit** `EXPORT-2: Add the Custom UI shell with theme and 26-locale i18n with plurals`.

### Task 3: File-name slugs and transliteration

**Files:**
- Create: `static/app/src/core/slug.js`
- Test: `static/app/test/core/slug.test.js`

**Interfaces:**
- Produces: `toSlug(title: string, { fileNames?: 'ascii'|'unicode' }) → string` (may be `''`); `MAX_SLUG_BYTES = 200`; `attachmentFileName(title, { fileNames }) → string`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { attachmentFileName, toSlug } from '../../src/core/slug.js';

describe('toSlug ascii', () => {
  it.each([
    ['Getting Started', 'getting-started'],
    ['Café Déjà vu', 'cafe-deja-vu'],
    ['Straße', 'strasse'],
    ['Łódź plan', 'lodz-plan'],
    ['Æsir Øresund', 'aesir-oresund'],
    ['Привет, мир!', 'privet-mir'],
    ['Щука и ёж', 'shchuka-i-ezh'],
    ['Йогурт', 'yogurt'],
    ['Київ', 'kiyiv'],
    ['Αθήνα', 'athina'],
    ['API v2.0 (beta)', 'api-v2-0-beta'],
    ['  --Hello__World--  ', 'hello-world'],
    ['ﬁnal Ｐlan', 'final-plan'],
    ['设计文档', ''],
    ['日本語 Guide', 'guide'],
    ['🚀 Launch', 'launch'],
  ])('%s → %s', (title, slug) => expect(toSlug(title)).toBe(slug));

  it('avoids reserved Windows and index names', () => {
    expect(toSlug('CON')).toBe('con-page');
    expect(toSlug('nul')).toBe('nul-page');
    expect(toSlug('Index')).toBe('index-page');
    expect(toSlug('_index')).toBe('index-page');
  });

  it('cuts long titles at a dash, without a trailing dash, within 80 characters', () => {
    const slug = toSlug('word '.repeat(60));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('word-word')).toBe(true);
  });
});

describe('toSlug unicode', () => {
  it('keeps letters of every script, lower-cased, NFC', () => {
    expect(toSlug('设计文档', { fileNames: 'unicode' })).toBe('设计文档');
    expect(toSlug('Привет, Мир!', { fileNames: 'unicode' })).toBe('привет-мир');
    expect(toSlug('Cafe\u0301', { fileNames: 'unicode' })).toBe('café');
  });
  it('stays within 200 UTF-8 bytes', () => {
    const slug = toSlug('漢'.repeat(120), { fileNames: 'unicode' });
    expect(new TextEncoder().encode(slug).length).toBeLessThanOrEqual(200);
  });
});

describe('attachmentFileName', () => {
  it('slugs the base name and keeps a lower-case extension', () => {
    expect(attachmentFileName('Архитектура v2.PNG')).toBe('arkhitektura-v2.png');
    expect(attachmentFileName('report')).toBe('report');
    expect(attachmentFileName('设计.pdf')).toBe('file.pdf');
    expect(attachmentFileName('.env')).toBe('file.env');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core/slug.test.js` (in `static/app`) → FAIL.

- [ ] **Step 3: Implement** `static/app/src/core/slug.js`:

```js
const TABLE = {
  ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u', ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u',
  һ: 'h', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz',
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul', 'index',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);
const MAX_CHARS = 80;
export const MAX_SLUG_BYTES = 200;
const encoder = new TextEncoder();

function transliterate(ch) {
  const direct = TABLE[ch];
  if (direct !== undefined) {
    return direct;
  }
  return [...ch.normalize('NFKD').replace(/\p{M}/gu, '')].map((c) => TABLE[c] ?? c).join('');
}

function trimDashes(text) {
  return text.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function cut(slug) {
  const chars = [...slug];
  let end = Math.min(chars.length, MAX_CHARS);
  while (end > 0 && encoder.encode(chars.slice(0, end).join('')).length > MAX_SLUG_BYTES) {
    end -= 1;
  }
  if (end === chars.length) {
    return slug;
  }
  const head = chars.slice(0, end).join('');
  const dash = head.lastIndexOf('-');
  return trimDashes(dash > head.length / 2 ? head.slice(0, dash) : head);
}

/** Lower-case dash-separated slug of a title for file names; '' when nothing usable remains. */
export function toSlug(title, { fileNames = 'ascii' } = {}) {
  const lower = String(title ?? '').normalize('NFC').toLowerCase();
  const mapped = fileNames === 'unicode'
    ? [...lower].map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? ch : '-')).join('')
    : [...lower].map((ch) => transliterate(ch).replace(/[^a-z0-9]/g, '-')).join('');
  const slug = cut(trimDashes(mapped));
  const bare = slug.replace(/^_+/, '');
  return RESERVED.has(bare) ? `${bare}-page` : slug;
}

/** Safe attachment file name: slugged base (or "file") plus the lower-cased extension. */
export function attachmentFileName(title, options = {}) {
  const text = String(title ?? '');
  const dot = text.lastIndexOf('.');
  const hasExt = dot >= 0 && /^[A-Za-z0-9]{1,10}$/.test(text.slice(dot + 1));
  const base = toSlug(hasExt ? text.slice(0, dot) : text, options) || 'file';
  return hasExt ? `${base}.${text.slice(dot + 1).toLowerCase()}` : base;
}
```

- [ ] **Step 4: Run** → PASS. Fix table entries only if a case fails; never weaken a case.
- [ ] **Step 5: Commit** `EXPORT-3: Add transliterating file-name slugs`.

### Task 4: Presets and the stable path planner

**Files:**
- Create: `static/app/src/core/presets.js`, `static/app/src/core/paths.js`
- Test: `static/app/test/core/paths.test.js`, `static/app/test/core/presets.test.js`

**Interfaces:**
- Consumes: `toSlug` (Task 3).
- Produces:
  - `ExportTree = { rootIds: string[], nodes: Map<string, { id: string, title: string, parentId: string|null, childIds: string[] }> }` (childIds in Confluence order).
  - `ExportOptions = { preset: 'generic'|'hugo'|'docusaurus'|'mkdocs', ordering: 'weight'|'prefix', fileNames: 'ascii'|'unicode', attachments: 'all'|'referenced'|'none', maxAttachmentMb: number }`; `DEFAULT_OPTIONS`.
  - `PRESETS`, `presetOf(key) → { indexFile: string, orderKey: string|null, extras: null|'category'|'pages' }`.
  - `planPaths(tree, options, previousNames: Map<string,string>) → Map<string, { path: string, name: string, weight: number, isIndex: boolean }>`.
  - `presetFiles(tree, plan, options) → { path: string, content: string }[]`.

- [ ] **Step 1: Write the failing tests** `paths.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { planPaths } from '../../src/core/paths.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

/** Builds an ExportTree from [id, title, parentId] rows in sibling order. */
export function treeOf(rows) {
  const nodes = new Map(rows.map(([id, title, parentId]) => [id, { id, title, parentId: parentId ?? null, childIds: [] }]));
  const rootIds = [];
  for (const [id, , parentId] of rows) {
    if (parentId && nodes.has(parentId)) nodes.get(parentId).childIds.push(id);
    else rootIds.push(id);
  }
  return { rootIds, nodes };
}
const paths = (plan) => Object.fromEntries([...plan].map(([id, p]) => [id, p.path]));

describe('planPaths', () => {
  const tree = treeOf([
    ['1', 'Engineering'], ['2', 'Getting Started', '1'], ['3', 'API', '1'], ['4', 'Auth', '3'], ['5', 'Café', null],
  ]);

  it('makes directories for parents and files for leaves, in Confluence order', () => {
    const plan = planPaths(tree, DEFAULT_OPTIONS, new Map());
    expect(paths(plan)).toEqual({
      1: 'engineering/index.md', 2: 'engineering/getting-started.md', 3: 'engineering/api/index.md',
      4: 'engineering/api/auth.md', 5: 'cafe.md',
    });
    expect(plan.get('3')).toMatchObject({ weight: 20, isIndex: true, name: 'api' });
  });

  it('uses _index.md for Hugo', () => {
    expect(planPaths(tree, { ...DEFAULT_OPTIONS, preset: 'hugo' }, new Map()).get('3').path).toBe('engineering/api/_index.md');
  });

  it('adds zero-padded prefixes when ordering is prefix', () => {
    const plan = planPaths(tree, { ...DEFAULT_OPTIONS, ordering: 'prefix' }, new Map());
    expect(plan.get('4').path).toBe('010-engineering/020-api/010-auth.md');
    expect(plan.get('4').name).toBe('auth');
  });

  it('resolves case-insensitive collisions: lowest id keeps the plain name', () => {
    const plan = planPaths(treeOf([['20', 'Notes'], ['7', 'notes'], ['9', 'NOTES'], ['30', 'API'], ['31', 'api']]), DEFAULT_OPTIONS, new Map());
    expect(paths(plan)).toEqual({ 20: 'notes-20.md', 7: 'notes.md', 9: 'notes-9.md', 30: 'api.md', 31: 'api-31.md' });
  });

  it('collides titles that transliterate to the same slug', () => {
    const plan = planPaths(treeOf([['1', 'Café'], ['2', 'Cafe']]), DEFAULT_OPTIONS, new Map());
    expect(paths(plan)).toEqual({ 1: 'cafe.md', 2: 'cafe-2.md' });
  });

  it('keeps names from the previous export when still valid', () => {
    const previous = new Map([['9', 'notes-9']]);
    const plan = planPaths(treeOf([['9', 'Notes']]), DEFAULT_OPTIONS, previous);
    expect(plan.get('9').path).toBe('notes-9.md');
  });

  it('drops a previous name that no longer matches the title', () => {
    const plan = planPaths(treeOf([['9', 'Renamed']]), DEFAULT_OPTIONS, new Map([['9', 'notes']]));
    expect(plan.get('9').path).toBe('renamed.md');
  });

  it('falls back to page-<id> when the title has no usable characters', () => {
    expect(planPaths(treeOf([['42', '设计文档']]), DEFAULT_OPTIONS, new Map()).get('42').path).toBe('page-42.md');
  });

  it('widens the prefix for more than 99 siblings', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [String(i + 1), `P${i + 1}`]);
    const plan = planPaths(treeOf(rows), { ...DEFAULT_OPTIONS, ordering: 'prefix' }, new Map());
    expect(plan.get('1').path).toBe('0010-p1.md');
    expect(plan.get('120').path).toBe('1200-p120.md');
  });

  it('is deterministic', () => {
    expect(paths(planPaths(tree, DEFAULT_OPTIONS, new Map()))).toEqual(paths(planPaths(tree, DEFAULT_OPTIONS, new Map())));
  });
});
```

Move `treeOf` into `static/app/test/fixtures/tree.js` and import it from there in every test that needs it.

`presets.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { planPaths } from '../../src/core/paths.js';
import { DEFAULT_OPTIONS, presetFiles, presetOf } from '../../src/core/presets.js';
import { treeOf } from '../fixtures/tree.js';

const tree = treeOf([['1', 'Guide'], ['2', 'Intro', '1'], ['3', 'Deep Dive', '1'], ['4', 'Part', '3'], ['5', 'FAQ']]);

describe('presetFiles', () => {
  it('writes nothing for generic and hugo', () => {
    for (const preset of ['generic', 'hugo']) {
      const options = { ...DEFAULT_OPTIONS, preset };
      expect(presetFiles(tree, planPaths(tree, options, new Map()), options)).toEqual([]);
    }
  });
  it('writes _category_.json per directory for docusaurus', () => {
    const options = { ...DEFAULT_OPTIONS, preset: 'docusaurus' };
    expect(presetFiles(tree, planPaths(tree, options, new Map()), options)).toEqual([
      { path: 'guide/_category_.json', content: '{\n  "label": "Guide",\n  "position": 10\n}\n' },
      { path: 'guide/deep-dive/_category_.json', content: '{\n  "label": "Deep Dive",\n  "position": 20\n}\n' },
    ]);
  });
  it('writes ordered .pages files for mkdocs', () => {
    const options = { ...DEFAULT_OPTIONS, preset: 'mkdocs' };
    const files = presetFiles(tree, planPaths(tree, options, new Map()), options);
    expect(files).toEqual([
      { path: '.pages', content: 'nav:\n  - "guide"\n  - "faq.md"\n' },
      { path: 'guide/.pages', content: 'title: "Guide"\nnav:\n  - "index.md"\n  - "intro.md"\n  - "deep-dive"\n' },
      { path: 'guide/deep-dive/.pages', content: 'title: "Deep Dive"\nnav:\n  - "index.md"\n  - "part.md"\n' },
    ]);
  });
  it('knows every preset', () => {
    expect(presetOf('hugo')).toEqual({ indexFile: '_index.md', orderKey: 'weight', extras: null });
    expect(presetOf('unknown')).toEqual(presetOf('generic'));
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `presets.js` (`yamlString` imported from Task 5's `frontMatter.js` would create an order dependency — define the tiny quoting helper here and re-export it from `frontMatter.js`):

```js
/** Output presets: index file name, front-matter order key and extra navigation files. */
export const PRESETS = {
  generic: { indexFile: 'index.md', orderKey: 'weight', extras: null },
  hugo: { indexFile: '_index.md', orderKey: 'weight', extras: null },
  docusaurus: { indexFile: 'index.md', orderKey: 'sidebar_position', extras: 'category' },
  mkdocs: { indexFile: 'index.md', orderKey: null, extras: 'pages' },
};

/** Default export options shown in the studio. */
export const DEFAULT_OPTIONS = {
  preset: 'generic', ordering: 'weight', fileNames: 'ascii', attachments: 'all', maxAttachmentMb: 50,
};

/** Preset by key; unknown keys fall back to generic. */
export function presetOf(key) {
  return PRESETS[key] ?? PRESETS.generic;
}

/** YAML double-quoted scalar with escapes for quotes, backslashes and control characters. */
export function yamlString(value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `"${escaped}"`;
}

function dirOf(path) {
  return path.split('/').slice(0, -1).join('/');
}

function entryName(entry) {
  const parts = entry.path.split('/');
  return entry.isIndex ? parts[parts.length - 2] : parts[parts.length - 1];
}

function categoryFiles(tree, plan) {
  return [...plan].filter(([, entry]) => entry.isIndex).map(([id, entry]) => ({
    path: `${dirOf(entry.path)}/_category_.json`,
    content: `${JSON.stringify({ label: tree.nodes.get(id).title, position: entry.weight }, null, 2)}\n`,
  }));
}

function pagesFile(dir, title, indexFile, childIds, plan) {
  const nav = [...(title === null ? [] : [indexFile]), ...childIds.map((id) => entryName(plan.get(id)))];
  const head = title === null ? '' : `title: ${yamlString(title)}\n`;
  return {
    path: dir ? `${dir}/.pages` : '.pages',
    content: `${head}nav:\n${nav.map((n) => `  - ${yamlString(n)}`).join('\n')}\n`,
  };
}

function mkdocsFiles(tree, plan, preset) {
  const files = [pagesFile('', null, preset.indexFile, tree.rootIds, plan)];
  const visit = (ids) => {
    for (const id of ids) {
      const entry = plan.get(id);
      const node = tree.nodes.get(id);
      if (!entry.isIndex) continue;
      files.push(pagesFile(dirOf(entry.path), node.title, preset.indexFile, node.childIds, plan));
      visit(node.childIds);
    }
  };
  visit(tree.rootIds);
  return files;
}

/** Extra navigation files a preset needs, in a stable order. */
export function presetFiles(tree, plan, options) {
  const preset = presetOf(options.preset);
  if (preset.extras === 'category') return categoryFiles(tree, plan);
  if (preset.extras === 'pages') return mkdocsFiles(tree, plan, preset);
  return [];
}
```

`categoryFiles` must follow tree order (depth-first) — iterate `plan` in insertion order, which `planPaths` produces depth-first. `paths.js`:

```js
import { toSlug } from './slug.js';
import { presetOf } from './presets.js';

function byNumericId(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function join(...parts) {
  return parts.filter(Boolean).join('/');
}

function nameSiblings(ids, nodes, options, previousNames) {
  const base = (id) => toSlug(nodes.get(id).title, options) || `page-${id}`;
  const taken = new Set();
  const names = new Map();
  for (const id of ids) {
    const previous = previousNames.get(id);
    const plain = base(id);
    if ((previous === plain || previous === `${plain}-${id}`) && !taken.has(previous.toLowerCase())) {
      names.set(id, previous);
      taken.add(previous.toLowerCase());
    }
  }
  for (const id of ids.filter((x) => !names.has(x)).sort(byNumericId)) {
    const plain = base(id);
    const name = taken.has(plain.toLowerCase()) ? `${plain}-${id}` : plain;
    names.set(id, name);
    taken.add(name.toLowerCase());
  }
  return names;
}

/** Plans a stable file path per page: parents become folders with an index file, leaves become .md files. */
export function planPaths(tree, options, previousNames) {
  const preset = presetOf(options.preset);
  const plan = new Map();
  const walk = (ids, dir) => {
    const names = nameSiblings(ids, tree.nodes, options, previousNames);
    const width = Math.max(3, String(ids.length * 10).length);
    ids.forEach((id, index) => {
      const node = tree.nodes.get(id);
      const weight = (index + 1) * 10;
      const name = names.get(id);
      const shown = options.ordering === 'prefix' ? `${String(weight).padStart(width, '0')}-${name}` : name;
      const isIndex = node.childIds.length > 0;
      plan.set(id, { path: isIndex ? join(dir, shown, preset.indexFile) : join(dir, `${shown}.md`), name, weight, isIndex });
      if (isIndex) walk(node.childIds, join(dir, shown));
    });
  };
  walk(tree.rootIds, '');
  return plan;
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `EXPORT-4: Plan stable paths and preset navigation files`.

### Task 5: Front-matter, relative links, attachment paths

**Files:**
- Create: `static/app/src/core/frontMatter.js`, `static/app/src/core/links.js`
- Test: `static/app/test/core/frontMatter.test.js`, `static/app/test/core/links.test.js`

**Interfaces:**
- Consumes: `yamlString`, `presetOf` (Task 4), `attachmentFileName` (Task 3).
- Produces:
  - `renderFrontMatter(meta, options) → string` where `meta = { id, title, spaceKey, parentId|null, version: number, author: string|null, updated: string (ISO), labels: string[], url: string, weight: number }`.
  - `relativePath(fromFile, toFile) → string`, `encodeLinkTarget(href) → string`, `assetsDir(pagePath) → string`, `planAttachments(pagePath, attachments: {id,title}[], options) → Map<attachmentId, path>`.

- [ ] **Step 1: Failing tests**

```js
import { describe, expect, it } from 'vitest';
import { renderFrontMatter } from '../../src/core/frontMatter.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

const meta = {
  id: '123', title: 'Say "hi"\\ now', spaceKey: 'ENG', parentId: '100', version: 7, author: 'Анна Ким',
  updated: '2026-09-01T10:00:00.000Z', labels: ['b', 'a'], url: 'https://x.atlassian.net/wiki/spaces/ENG/pages/123', weight: 20,
};

describe('renderFrontMatter', () => {
  it('writes stable YAML with sorted labels and the preset order key', () => {
    expect(renderFrontMatter(meta, DEFAULT_OPTIONS)).toBe([
      '---',
      'title: "Say \\"hi\\"\\\\ now"',
      'confluence_id: "123"',
      'space: "ENG"',
      'parent_id: "100"',
      'version: 7',
      'author: "Анна Ким"',
      'updated: "2026-09-01T10:00:00.000Z"',
      'weight: 20',
      'labels:',
      '  - "a"',
      '  - "b"',
      'source: "https://x.atlassian.net/wiki/spaces/ENG/pages/123"',
      '---',
      '',
    ].join('\n'));
  });
  it('uses sidebar_position for docusaurus, nothing for mkdocs, [] for no labels, skips null fields', () => {
    const docu = renderFrontMatter({ ...meta, labels: [], parentId: null, author: null }, { ...DEFAULT_OPTIONS, preset: 'docusaurus' });
    expect(docu).toContain('sidebar_position: 20');
    expect(docu).toContain('labels: []');
    expect(docu).not.toContain('parent_id');
    expect(docu).not.toContain('author');
    expect(renderFrontMatter(meta, { ...DEFAULT_OPTIONS, preset: 'mkdocs' })).not.toMatch(/weight|sidebar_position/);
  });
  it('escapes control characters', () => {
    expect(renderFrontMatter({ ...meta, title: 'a\u0007b\nc' }, DEFAULT_OPTIONS)).toContain('title: "a\\x07b\\nc"');
  });
});
```

```js
import { describe, expect, it } from 'vitest';
import { assetsDir, encodeLinkTarget, planAttachments, relativePath } from '../../src/core/links.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

describe('relativePath', () => {
  it.each([
    ['a/b/c.md', 'a/b/d.md', 'd.md'],
    ['a/b/c.md', 'a/x/y.md', '../x/y.md'],
    ['c.md', 'a/b/d.md', 'a/b/d.md'],
    ['a/b/c.md', 'd.md', '../../d.md'],
    ['a/index.md', 'a/index.assets/x.png', 'index.assets/x.png'],
    ['a/b.md', 'a/b.md', 'b.md'],
  ])('%s → %s = %s', (from, to, expected) => expect(relativePath(from, to)).toBe(expected));
});

describe('encodeLinkTarget', () => {
  it('encodes only characters that break Markdown links', () => {
    expect(encodeLinkTarget('a b/(c)<d>.md#x')).toBe('a%20b/%28c%29%3Cd%3E.md#x');
    expect(encodeLinkTarget('привет/файл.md')).toBe('привет/файл.md');
  });
});

describe('planAttachments', () => {
  it('puts files next to the page, deduplicated in id order', () => {
    const map = planAttachments('eng/api.md', [{ id: 'att3', title: 'Diagram.PNG' }, { id: 'att2', title: 'diagram.png' }, { id: 'att9', title: 'Схема.pdf' }], DEFAULT_OPTIONS);
    expect(Object.fromEntries(map)).toEqual({
      att2: 'eng/api.assets/diagram.png', att3: 'eng/api.assets/diagram-2.png', att9: 'eng/api.assets/skhema.pdf',
    });
    expect(assetsDir('eng/_index.md')).toBe('eng/_index.assets');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
import { presetOf, yamlString } from './presets.js';

export { yamlString };

/** YAML front-matter for a page; contains no export time so repeated exports are identical. */
export function renderFrontMatter(meta, options) {
  const { orderKey } = presetOf(options.preset);
  const labels = [...meta.labels].sort();
  const lines = ['---', `title: ${yamlString(meta.title)}`, `confluence_id: ${yamlString(meta.id)}`, `space: ${yamlString(meta.spaceKey)}`];
  if (meta.parentId) lines.push(`parent_id: ${yamlString(meta.parentId)}`);
  lines.push(`version: ${Number(meta.version)}`);
  if (meta.author) lines.push(`author: ${yamlString(meta.author)}`);
  lines.push(`updated: ${yamlString(meta.updated)}`);
  if (orderKey) lines.push(`${orderKey}: ${meta.weight}`);
  lines.push(labels.length ? `labels:\n${labels.map((l) => `  - ${yamlString(l)}`).join('\n')}` : 'labels: []');
  lines.push(`source: ${yamlString(meta.url)}`, '---', '');
  return lines.join('\n');
}
```

```js
import { attachmentFileName } from './slug.js';

/** Relative POSIX path from one exported file to another. */
export function relativePath(fromFile, toFile) {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
}

/** Percent-encodes the characters that break a Markdown link target, keeping letters of every script. */
export function encodeLinkTarget(href) {
  return String(href).replace(/[ ()<>\u00a0]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** Folder holding a page's attachments: page.md → page.assets. */
export function assetsDir(pagePath) {
  return pagePath.replace(/\.md$/, '.assets');
}

/** Stable path per attachment id: slugged names next to the page, duplicates numbered in id order. */
export function planAttachments(pagePath, attachments, options) {
  const dir = assetsDir(pagePath);
  const taken = new Set();
  const result = new Map();
  const sorted = [...attachments].sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
  for (const attachment of sorted) {
    const file = attachmentFileName(attachment.title, options);
    const dot = file.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
    let candidate = file;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${base}-${n}${ext}`;
    taken.add(candidate.toLowerCase());
    result.set(attachment.id, `${dir}/${candidate}`);
  }
  return result;
}
```

(Encoded `%28` etc. — hex of the code unit; the test's expected string is the contract. `att2` sorts before `att3`, `att9` by the same length-then-lexical rule used for page ids.)

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `EXPORT-5: Add front-matter, relative links and attachment paths`.

### Task 6: Storage format → Markdown converter

**Files:**
- Create: `static/app/src/core/convert/parse.js`, `escape.js`, `inline.js`, `blocks.js`, `tables.js`, `macros.js`, `index.js`
- Test: `static/app/test/core/convert.test.js`, fixtures `static/app/test/fixtures/storage/*.xml` + expected `*.md`

**Interfaces:**
- Consumes: `encodeLinkTarget` (Task 5).
- Produces: `storageToMarkdown(xhtml: string, ctx: ConvertContext) → { markdown: string, links: string[], attachments: string[], mentions: string[], warnings: { kind: string, detail: string }[] }` where

```
ConvertContext = {
  siteUrl: string,
  resolvePage({ title, spaceKey }) → { id: string|null, href: string },
  resolveAttachment(filename, owner?: { title, spaceKey }) → string|null,
  resolveUser(accountId) → string|null,
  childLinks() → { title: string, href: string }[],
}
```

Warning kinds (fixed set, used by the UI for translation): `unknown-macro`, `dynamic-macro`, `complex-table`, `missing-attachment`, `adf-extension`, `unresolved-user`.
`collectMentions(xhtml) → string[]` (account ids, for the user lookup before conversion).

- [ ] **Step 1: Failing tests** `convert.test.js` — table-driven; each case is storage input → exact Markdown:

```js
import { describe, expect, it } from 'vitest';
import { collectMentions, storageToMarkdown } from '../../src/core/convert/index.js';

const ctx = (over = {}) => ({
  siteUrl: 'https://x.atlassian.net',
  resolvePage: ({ title }) => (title === 'Target' ? { id: '9', href: '../api/target.md' } : { id: null, href: `https://x.atlassian.net/wiki/display/ENG/${encodeURIComponent(title)}` }),
  resolveAttachment: (name) => (name === 'missing.png' ? null : `page.assets/${name}`),
  resolveUser: (id) => (id === 'u1' ? 'Анна Ким' : null),
  childLinks: () => [{ title: 'Child A', href: 'page/child-a.md' }],
  ...over,
});
const md = (xhtml, c) => storageToMarkdown(xhtml, ctx(c)).markdown;

describe('blocks', () => {
  it.each([
    ['<h1>Title</h1><p>Text</p>', '# Title\n\nText\n'],
    ['<h3>A <em>b</em></h3>', '### A *b*\n'],
    ['<p>a <strong>b</strong> <em>c</em> <s>d</s> <code>e`f</code></p>', 'a **b** *c* ~~d~~ ``e`f``\n'],
    ['<p>line<br/>next</p>', 'line\\\nnext\n'],
    ['<p># not heading and 1. not list</p>', '\\# not heading and 1. not list\n'],
    ['<p>1. starts like a list</p>', '1\\. starts like a list\n'],
    ['<p>a*b_c [d] &lt;e&gt;</p>', 'a\\*b\\_c \\[d\\] \\<e\\>\n'],
    ['<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>', '- a\n- b\n  - c\n'],
    ['<ol start="3"><li><p>x</p><p>y</p></li><li>z</li></ol>', '3. x\n\n   y\n4. z\n'],
    ['<blockquote><p>q1</p><p>q2</p></blockquote>', '> q1\n>\n> q2\n'],
    ['<hr/>', '---\n'],
    ['<pre>raw *text*</pre>', '```\nraw *text*\n```\n'],
    ['<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>done</ac:task-body></ac:task><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>todo</ac:task-body></ac:task></ac:task-list>', '- [x] done\n- [ ] todo\n'],
    ['<ac:layout><ac:layout-section><ac:layout-cell><p>L</p></ac:layout-cell><ac:layout-cell><p>R</p></ac:layout-cell></ac:layout-section></ac:layout>', 'L\n\nR\n'],
    ['<p>a&nbsp;b &amp; c</p>', 'a b & c\n'],
  ])('%s', (input, expected) => expect(md(input)).toBe(expected));
});

describe('links, images, mentions', () => {
  it('rewrites page links to relative paths and records the target id', () => {
    const result = storageToMarkdown('<p><ac:link><ri:page ri:content-title="Target"/><ac:plain-text-link-body><![CDATA[the target]]></ac:plain-text-link-body></ac:link></p>', ctx());
    expect(result.markdown).toBe('[the target](../api/target.md)\n');
    expect(result.links).toEqual(['9']);
  });
  it('links outside the export go to Confluence', () => {
    expect(md('<p><ac:link><ri:page ri:content-title="Other Page" ri:space-key="HR"/></ac:link></p>')).toBe('[Other Page](https://x.atlassian.net/wiki/display/ENG/Other%20Page)\n');
  });
  it('keeps anchors', () => {
    expect(md('<p><ac:link ac:anchor="setup"><ri:page ri:content-title="Target"/></ac:link></p>')).toBe('[Target](../api/target.md#setup)\n');
  });
  it('rewrites attachment images and links, warns on missing files', () => {
    const result = storageToMarkdown('<p><ac:image ac:alt="Diagram"><ri:attachment ri:filename="d 1.png"/></ac:image> <ac:image><ri:attachment ri:filename="missing.png"/></ac:image></p>', ctx());
    expect(result.markdown).toBe('![Diagram](page.assets/d%201.png) missing.png\n');
    expect(result.attachments).toEqual(['d 1.png']);
    expect(result.warnings).toEqual([{ kind: 'missing-attachment', detail: 'missing.png' }]);
  });
  it('keeps external images and links', () => {
    expect(md('<p><ac:image><ri:url ri:value="https://img.example/a.png"/></ac:image> <a href="https://e.com/a b">site</a></p>')).toBe('![](https://img.example/a.png) [site](https://e.com/a%20b)\n');
  });
  it('turns mentions into @names and warns on unknown users', () => {
    const result = storageToMarkdown('<p><ac:link><ri:user ri:account-id="u1"/></ac:link> and <ac:link><ri:user ri:account-id="u2"/></ac:link></p>', ctx());
    expect(result.markdown).toBe('@Анна Ким and @unknown-user\n');
    expect(result.warnings).toEqual([{ kind: 'unresolved-user', detail: 'u2' }]);
    expect(collectMentions('<ri:user ri:account-id="u1"/><ri:user ri:account-id="u2"/><ri:user ri:account-id="u1"/>')).toEqual(['u1', 'u2']);
  });
});

describe('macros', () => {
  const macro = (name, params, body) => `<ac:structured-macro ac:name="${name}">${Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`).join('')}${body}</ac:structured-macro>`;
  it.each([
    [macro('code', { language: 'js' }, '<ac:plain-text-body><![CDATA[const a = `x`;\n```\n]]></ac:plain-text-body>'), '````js\nconst a = `x`;\n```\n````\n'],
    [macro('noformat', {}, '<ac:plain-text-body><![CDATA[plain]]></ac:plain-text-body>'), '```\nplain\n```\n'],
    [macro('info', { title: 'Heads up' }, '<ac:rich-text-body><p>Body</p></ac:rich-text-body>'), '> [!NOTE]\n> **Heads up**\n> Body\n'],
    [macro('tip', {}, '<ac:rich-text-body><p>T</p></ac:rich-text-body>'), '> [!TIP]\n> T\n'],
    [macro('note', {}, '<ac:rich-text-body><p>N</p></ac:rich-text-body>'), '> [!WARNING]\n> N\n'],
    [macro('warning', {}, '<ac:rich-text-body><p>W</p></ac:rich-text-body>'), '> [!CAUTION]\n> W\n'],
    [macro('panel', { title: 'P' }, '<ac:rich-text-body><p>x</p></ac:rich-text-body>'), '> **P**\n>\n> x\n'],
    [macro('expand', { title: 'More <info>' }, '<ac:rich-text-body><p>hidden</p></ac:rich-text-body>'), '<details>\n<summary>More &lt;info&gt;</summary>\n\nhidden\n\n</details>\n'],
    [`<p>State: ${macro('status', { title: 'In progress', colour: 'Blue' }, '')}</p>`, 'State: `IN PROGRESS`\n'],
    [`<p>${macro('jira', { key: 'ENG-12' }, '')}</p>`, '[ENG-12](https://x.atlassian.net/browse/ENG-12)\n'],
    [`<p>${macro('anchor', { '': 'setup' }, '')}Setup</p>`, '<a id="setup"></a>Setup\n'],
    [macro('children', {}, ''), '- [Child A](page/child-a.md)\n'],
    [macro('excerpt', {}, '<ac:rich-text-body><p>E</p></ac:rich-text-body>'), 'E\n'],
  ])('%s', (input, expected) => expect(md(input)).toBe(expected));

  it('marks dynamic macros and warns', () => {
    const result = storageToMarkdown(macro('toc', {}, ''), ctx());
    expect(result.markdown).toBe('<!-- confluence:toc -->\n');
    expect(result.warnings).toEqual([{ kind: 'dynamic-macro', detail: 'toc' }]);
  });
  it('never drops an unknown macro silently', () => {
    const result = storageToMarkdown(macro('drawio', { diagramName: 'x' }, '<ac:rich-text-body><p>fallback</p></ac:rich-text-body>'), ctx());
    expect(result.markdown).toBe('<!-- confluence:drawio -->\n\nfallback\n');
    expect(result.warnings).toEqual([{ kind: 'unknown-macro', detail: 'drawio' }]);
  });
  it('renders adf-extension fallback content', () => {
    const result = storageToMarkdown('<ac:adf-extension><ac:adf-node type="decision-list"></ac:adf-node><ac:adf-fallback><p>Decided</p></ac:adf-fallback></ac:adf-extension>', ctx());
    expect(result.markdown).toBe('Decided\n');
    expect(result.warnings).toEqual([{ kind: 'adf-extension', detail: 'decision-list' }]);
  });
  it('keeps emoticons', () => {
    expect(md('<p><ac:emoticon ac:name="tick" ac:emoji-fallback="✅"/> ok <ac:emoticon ac:name="warning"/></p>')).toBe('✅ ok ⚠️\n');
  });
});

describe('tables', () => {
  it('writes GFM tables for simple tables, escaping pipes', () => {
    const input = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td><td><p>x</p><p>y</p></td></tr><tr><td>only</td></tr></tbody></table>';
    expect(md(input)).toBe('| A | B |\n| --- | --- |\n| 1 \\| 2 | x<br>y |\n| only |  |\n');
  });
  it('falls back to HTML for merged cells or block content, with a warning', () => {
    const result = storageToMarkdown('<table><tbody><tr><th colspan="2">H</th></tr><tr><td><ul><li>a</li></ul></td><td>b</td></tr></tbody></table>', ctx());
    expect(result.markdown).toBe('<table>\n<tr>\n<th colspan="2">\n\nH\n\n</th>\n</tr>\n<tr>\n<td>\n\n- a\n\n</td>\n<td>\n\nb\n\n</td>\n</tr>\n</table>\n');
    expect(result.warnings).toEqual([{ kind: 'complex-table', detail: '' }]);
  });
});

describe('robustness', () => {
  it('returns a newline-terminated empty document for empty input', () => {
    expect(md('')).toBe('\n');
  });
  it('is deterministic', () => {
    const input = '<p>a</p><table><tbody><tr><th>x</th></tr></tbody></table>';
    expect(md(input)).toBe(md(input));
  });
});
```

Also add fixture pairs in `test/fixtures/storage/` copied from 3 real pages of the seeded EXPT space (fetch with `curl … /wiki/api/v2/pages/<id>?body-format=storage`, save the `body.storage.value`), with expected `.md` written by hand after review; test: `storageToMarkdown(readFileSync(xml)).markdown === readFileSync(md)`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `parse.js` and `escape.js`**

```js
import { parseDocument } from 'htmlparser2';

/** Parses Confluence storage format (XHTML with ac:/ri: tags, CDATA) into a DOM tree. */
export function parseStorage(xhtml) {
  return parseDocument(String(xhtml ?? ''), {
    recognizeCDATA: true, recognizeSelfClosing: true, decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true,
  });
}

/** Attribute value or ''. */
export function attr(node, name) {
  return node?.attribs?.[name] ?? '';
}

/** Element children of a node. */
export function elements(node) {
  return (node?.children ?? []).filter((c) => c.type === 'tag');
}

/** First child element with the given tag name, or null. */
export function childTag(node, name) {
  return elements(node).find((c) => c.name === name) ?? null;
}

/** Concatenated text of a node, CDATA included. */
export function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  return (node.children ?? []).map(textOf).join('');
}

/** Value of a structured-macro parameter, trimmed; '' when absent. */
export function param(macro, name) {
  const found = elements(macro).find((c) => c.name === 'ac:parameter' && attr(c, 'ac:name') === name);
  return found ? textOf(found).trim() : '';
}
```

```js
/** Escapes Markdown-significant characters in inline text. */
export function escapeText(text) {
  return text.replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`);
}

/** Escapes a line start that Markdown would read as a heading, quote, list item or ordered list. */
export function escapeLineStart(line) {
  if (/^\s*(#{1,6}|>|[-+*])(\s|$)/.test(line)) return line.replace(/^(\s*)/, '$1\\');
  return line.replace(/^(\s*\d+)([.)])(\s|$)/, '$1\\$2$3');
}

/** Escapes text for HTML element content and attributes. */
export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline code span whose fence is longer than any backtick run inside. */
export function codeSpan(text, inTable) {
  const runs = [...text.matchAll(/`+/g)].map((m) => m[0].length);
  const fence = '`'.repeat(runs.length ? Math.max(...runs) + 1 : 1);
  const body = inTable ? text.replace(/\|/g, '\\|') : text;
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

/** Fenced code block with a fence longer than any backtick run in the code. */
export function fence(code, language) {
  const runs = [...code.matchAll(/`{3,}/g)].map((m) => m[0].length);
  const marks = '`'.repeat(runs.length ? Math.max(...runs) + 1 : 3);
  const lang = String(language ?? '').replace(/[^\w+#.-]/g, '');
  return `${marks}${lang}\n${code.replace(/\n+$/, '')}\n${marks}`;
}

/** Prefixes every line with "> " ("> " lines stay ">" when empty). */
export function quote(text) {
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}
```

- [ ] **Step 4: Implement `inline.js`**

```js
import { encodeLinkTarget } from '../links.js';
import { attr, childTag, textOf } from './parse.js';
import { codeSpan, escapeHtml, escapeText } from './escape.js';
import { renderInlineMacro } from './macros.js';

const EMOTICONS = {
  smile: '🙂', sad: '🙁', cheeky: '😛', laugh: '😀', wink: '😉', 'thumbs-up': '👍', 'thumbs-down': '👎',
  information: 'ℹ️', tick: '✅', cross: '❌', warning: '⚠️', plus: '➕', minus: '➖', question: '❓',
  'light-on': '💡', 'light-off': '💡', 'yellow-star': '⭐', 'red-star': '⭐', 'green-star': '⭐', 'blue-star': '⭐', heart: '❤️',
};

function wrap(mark, inner) {
  const match = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return match[2] ? `${match[1]}${mark}${match[2]}${mark}${match[3]}` : inner;
}

/** Markdown link with an encoded target. */
export function link(text, href) {
  return `[${text}](${encodeLinkTarget(href)})`;
}

function withAnchor(href, anchor) {
  return anchor ? `${href}#${anchor}` : href;
}

function acLink(node, ctx) {
  const page = childTag(node, 'ri:page');
  const attachment = childTag(node, 'ri:attachment');
  const user = childTag(node, 'ri:user');
  const rich = childTag(node, 'ac:link-body');
  const plain = childTag(node, 'ac:plain-text-link-body');
  const body = rich ? renderInline(rich.children, ctx).trim() : plain ? escapeText(textOf(plain)) : '';
  const anchor = attr(node, 'ac:anchor');
  if (user) {
    const id = attr(user, 'ri:account-id');
    const name = ctx.resolveUser(id);
    if (!name) ctx.warn('unresolved-user', id);
    return `@${escapeText(name ?? 'unknown-user')}`;
  }
  if (attachment) {
    const name = attr(attachment, 'ri:filename');
    const href = ctx.attachment(name, childTag(attachment, 'ri:page'));
    return href ? link(body || escapeText(name), href) : body || escapeText(name);
  }
  if (page) {
    const title = attr(page, 'ri:content-title');
    const target = ctx.page({ title, spaceKey: attr(page, 'ri:space-key') });
    return link(body || escapeText(title), withAnchor(target.href, anchor));
  }
  if (anchor) return link(body || escapeText(anchor), `#${anchor}`);
  return body;
}

function acImage(node, ctx) {
  const attachment = childTag(node, 'ri:attachment');
  const url = childTag(node, 'ri:url');
  const alt = escapeText(attr(node, 'ac:alt') || attr(node, 'ac:title'));
  if (url) return `![${alt}](${encodeLinkTarget(attr(url, 'ri:value'))})`;
  if (!attachment) return '';
  const name = attr(attachment, 'ri:filename');
  const href = ctx.attachment(name, childTag(attachment, 'ri:page'));
  if (!href) {
    ctx.warn('missing-attachment', name);
    return alt || escapeText(name);
  }
  return `![${alt}](${encodeLinkTarget(href)})`;
}

function emoticon(node) {
  return attr(node, 'ac:emoji-fallback') || EMOTICONS[attr(node, 'ac:name')] || '';
}

function inlineNode(node, ctx) {
  if (node.type === 'text') return escapeText(node.data.replace(/\s+/g, ' '));
  if (node.type === 'cdata') return escapeText(textOf(node));
  if (node.type !== 'tag') return '';
  const inner = () => renderInline(node.children, ctx);
  switch (node.name) {
    case 'strong': case 'b': return wrap('**', inner());
    case 'em': case 'i': return wrap('*', inner());
    case 's': case 'del': case 'strike': return wrap('~~', inner());
    case 'code': return codeSpan(textOf(node), ctx.inTable);
    case 'br': return ctx.inTable ? '<br>' : '\\\n';
    case 'sub': case 'sup': return `<${node.name}>${inner()}</${node.name}>`;
    case 'a': return attr(node, 'href') ? link(inner() || escapeText(attr(node, 'href')), attr(node, 'href')) : inner();
    case 'ac:link': return acLink(node, ctx);
    case 'ac:image': return acImage(node, ctx);
    case 'ac:emoticon': return emoticon(node);
    case 'ac:structured-macro': return renderInlineMacro(node, ctx);
    case 'time': return escapeText(attr(node, 'datetime'));
    case 'ac:placeholder': return '';
    case 'script': case 'style': return '';
    default: return inner();
  }
}

/** Renders inline nodes to Markdown text. */
export function renderInline(nodes, ctx) {
  return (nodes ?? []).map((node) => inlineNode(node, ctx)).join('');
}

export { escapeHtml };
```

`ctx` inside the converter is the **internal** context built by `index.js` (Step 7): `{ siteUrl, inTable, page(), attachment(), resolveUser(), childLinks(), warn() }` — `page()`/`attachment()` wrap the public resolvers and record `links`/`attachments`.

- [ ] **Step 5: Implement `blocks.js` and `tables.js`**

```js
import { attr, elements, textOf } from './parse.js';
import { escapeLineStart, fence, quote } from './escape.js';
import { renderInline } from './inline.js';
import { isInlineMacro, renderMacro } from './macros.js';
import { renderTable } from './tables.js';

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'table', 'div', 'section',
  'ac:layout', 'ac:layout-section', 'ac:layout-cell', 'ac:task-list', 'ac:adf-extension', 'ac:rich-text-body', 'tbody',
]);

function isBlock(node) {
  if (node.type !== 'tag') return false;
  if (node.name === 'ac:structured-macro') return !isInlineMacro(node);
  return BLOCK_TAGS.has(node.name);
}

function paragraph(nodes, ctx) {
  return renderInline(nodes, ctx).trim().split('\n').map(escapeLineStart).join('\n');
}

function indentItem(marker, body) {
  const pad = ' '.repeat(marker.length + 1);
  const [first, ...rest] = body.split('\n');
  return [`${marker} ${first}`.trimEnd(), ...rest.map((line) => (line ? pad + line : line))].join('\n');
}

function renderList(node, ctx) {
  const ordered = node.name === 'ol';
  const start = Number(attr(node, 'start')) || 1;
  return elements(node).filter((li) => li.name === 'li').map((li, index) => {
    const blocks = renderBlockArray(li.children, ctx);
    const loose = elements(li).some((c) => c.name === 'p') && blocks.length > 1;
    return indentItem(ordered ? `${start + index}.` : '-', blocks.join(loose ? '\n\n' : '\n'));
  }).join('\n');
}

function renderTaskList(node, ctx) {
  return elements(node).filter((c) => c.name === 'ac:task').map((task) => {
    const status = elements(task).find((c) => c.name === 'ac:task-status');
    const body = elements(task).find((c) => c.name === 'ac:task-body');
    return `- [${textOf(status).trim() === 'complete' ? 'x' : ' '}] ${renderInline(body?.children, ctx).trim()}`;
  }).join('\n');
}

function renderAdf(node, ctx) {
  const type = attr(elements(node).find((c) => c.name === 'ac:adf-node'), 'type');
  ctx.warn('adf-extension', type);
  const fallback = elements(node).find((c) => c.name === 'ac:adf-fallback');
  return fallback ? renderBlocks(fallback.children, ctx) : '';
}

function renderBlock(node, ctx) {
  const heading = /^h([1-6])$/.exec(node.name);
  if (heading) return `${'#'.repeat(Number(heading[1]))} ${renderInline(node.children, ctx).trim()}`;
  switch (node.name) {
    case 'p': return paragraph(node.children, ctx);
    case 'ul': case 'ol': return renderList(node, ctx);
    case 'blockquote': return quote(renderBlocks(node.children, ctx));
    case 'pre': return fence(textOf(node), '');
    case 'hr': return '---';
    case 'table': return renderTable(node, ctx);
    case 'ac:task-list': return renderTaskList(node, ctx);
    case 'ac:structured-macro': return renderMacro(node, ctx);
    case 'ac:adf-extension': return renderAdf(node, ctx);
    default: return renderBlocks(node.children, ctx);
  }
}

/** Renders block and loose inline content to an array of Markdown blocks. */
export function renderBlockArray(nodes, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    const text = paragraph(run, ctx);
    if (text) out.push(text);
    run = [];
  };
  for (const node of nodes ?? []) {
    if (!isBlock(node)) {
      run.push(node);
      continue;
    }
    flush();
    const block = renderBlock(node, ctx);
    if (block.trim()) out.push(block);
  }
  flush();
  return out;
}

/** Renders nodes to Markdown blocks separated by blank lines. */
export function renderBlocks(nodes, ctx) {
  return renderBlockArray(nodes, ctx).join('\n\n');
}
```

```js
import { attr, elements } from './parse.js';
import { renderBlockArray, renderBlocks } from './blocks.js';

const BLOCKY = new Set(['ul', 'ol', 'table', 'pre', 'blockquote', 'ac:task-list', 'ac:structured-macro', 'ac:adf-extension', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function rowsOf(table) {
  return elements(table).flatMap((c) => (c.name === 'tr' ? [c] : ['thead', 'tbody', 'tfoot'].includes(c.name) ? elements(c).filter((r) => r.name === 'tr') : []));
}

function cellsOf(row) {
  return elements(row).filter((c) => c.name === 'td' || c.name === 'th');
}

function span(cell, name) {
  return Number(attr(cell, name)) > 1 ? Number(attr(cell, name)) : 1;
}

function isSimple(cell) {
  const blocky = (node) => elements(node).some((c) => (BLOCKY.has(c.name) && !(c.name === 'ac:structured-macro' && ['status', 'jira', 'anchor'].includes(attr(c, 'ac:name')))) || blocky(c));
  return span(cell, 'colspan') === 1 && span(cell, 'rowspan') === 1 && !blocky(cell);
}

function htmlTable(rows, ctx) {
  const cell = (c) => {
    const spans = ['colspan', 'rowspan'].filter((a) => span(c, a) > 1).map((a) => ` ${a}="${span(c, a)}"`).join('');
    return `<${c.name}${spans}>\n\n${renderBlocks(c.children, { ...ctx, inTable: false })}\n\n</${c.name}>`;
  };
  return ['<table>', ...rows.map((row) => `<tr>\n${cellsOf(row).map(cell).join('\n')}\n</tr>`), '</table>'].join('\n');
}

/** GFM table for simple tables, HTML (with a complex-table warning) for merged cells or block content. */
export function renderTable(node, ctx) {
  const rows = rowsOf(node);
  if (!rows.length) return '';
  if (!rows.every((row) => cellsOf(row).every(isSimple))) {
    ctx.warn('complex-table', '');
    return htmlTable(rows, ctx);
  }
  const grid = rows.map((row) => cellsOf(row).map((c) => renderBlockArray(c.children, { ...ctx, inTable: true }).join('<br>').replace(/\n/g, ' ')));
  const width = Math.max(...grid.map((r) => r.length));
  const line = (cells) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
  return [line(grid[0]), line(Array(width).fill('---')), ...grid.slice(1).map(line)].join('\n');
}
```

(An empty trailing cell renders as `|  |` — two spaces between pipes — which the test expects.)

- [ ] **Step 6: Implement `macros.js`**

```js
import { attr, childTag, param, textOf } from './parse.js';
import { codeSpan, escapeHtml, escapeText, fence, quote } from './escape.js';
import { renderBlocks } from './blocks.js';
import { link } from './inline.js';

const PANELS = { info: 'NOTE', tip: 'TIP', note: 'WARNING', warning: 'CAUTION' };
const BODY_ONLY = new Set(['excerpt', 'section', 'column', 'details', 'div']);
const DYNAMIC = new Set([
  'toc', 'toc-zone', 'pagetree', 'pagetreesearch', 'recently-updated', 'contentbylabel', 'livesearch', 'blog-posts',
  'attachments', 'include', 'excerpt-include', 'detailssummary', 'tasks-report-macro', 'content-report-table', 'profile',
]);
const INLINE = new Set(['status', 'jira', 'anchor']);

/** True for macros rendered inside a paragraph. */
export function isInlineMacro(node) {
  return INLINE.has(attr(node, 'ac:name'));
}

/** Renders an inline macro (status, single Jira issue, anchor). */
export function renderInlineMacro(node, ctx) {
  const name = attr(node, 'ac:name');
  if (name === 'status') return codeSpan((param(node, 'title') || param(node, 'colour')).toUpperCase(), ctx.inTable);
  if (name === 'jira') {
    const key = param(node, 'key');
    if (key) return link(escapeText(key), `${ctx.siteUrl}/browse/${key}`);
    ctx.warn('dynamic-macro', 'jira');
    return '<!-- confluence:jira -->';
  }
  if (name === 'anchor') return `<a id="${escapeHtml(param(node, '') || textOf(node).trim())}"></a>`;
  return renderMacro(node, ctx);
}

function admonition(kind, title, body) {
  return quote([`[!${kind}]`, ...(title ? [`**${escapeText(title)}**`] : []), body].filter(Boolean).join('\n'));
}

/** Renders a block macro; unknown macros keep their body and add a warning. */
export function renderMacro(node, ctx) {
  const name = attr(node, 'ac:name');
  const rich = childTag(node, 'ac:rich-text-body');
  const plain = childTag(node, 'ac:plain-text-body');
  const body = () => renderBlocks(rich?.children, ctx);
  if (name === 'code' || name === 'noformat') return fence(textOf(plain), name === 'code' ? param(node, 'language') : '');
  if (PANELS[name]) return admonition(PANELS[name], param(node, 'title'), body());
  if (name === 'panel') return quote([param(node, 'title') && `**${escapeText(param(node, 'title'))}**`, body()].filter(Boolean).join('\n\n'));
  if (name === 'expand') return `<details>\n<summary>${escapeHtml(param(node, 'title') || 'Details')}</summary>\n\n${body()}\n\n</details>`;
  if (BODY_ONLY.has(name)) return body();
  if (name === 'children') return ctx.childLinks().map((c) => `- ${link(escapeText(c.title), c.href)}`).join('\n');
  if (INLINE.has(name)) return renderInlineMacro(node, ctx);
  if (DYNAMIC.has(name)) {
    ctx.warn('dynamic-macro', name);
    return `<!-- confluence:${name} -->`;
  }
  ctx.warn('unknown-macro', name);
  const inner = rich ? body() : plain ? fence(textOf(plain), '') : '';
  return [`<!-- confluence:${name} -->`, inner].filter(Boolean).join('\n\n');
}
```

- [ ] **Step 7: Implement `index.js`**

```js
import { parseStorage } from './parse.js';
import { renderBlocks } from './blocks.js';

/** Unique account ids mentioned in a storage document, in order of appearance. */
export function collectMentions(xhtml) {
  return [...new Set([...String(xhtml ?? '').matchAll(/ri:account-id="([^"]+)"/g)].map((m) => m[1]))];
}

/** Converts Confluence storage format to Markdown and reports links, attachments and warnings. */
export function storageToMarkdown(xhtml, context) {
  const links = new Set();
  const attachments = new Set();
  const warnings = [];
  const ctx = {
    siteUrl: context.siteUrl,
    inTable: false,
    resolveUser: context.resolveUser,
    childLinks: context.childLinks,
    warn: (kind, detail) => warnings.push({ kind, detail: String(detail ?? '') }),
    page: (ref) => {
      const target = context.resolvePage(ref);
      if (target.id) links.add(target.id);
      return target;
    },
    attachment: (name, ownerNode) => {
      const owner = ownerNode ? { title: ownerNode.attribs?.['ri:content-title'] ?? '', spaceKey: ownerNode.attribs?.['ri:space-key'] ?? '' } : undefined;
      const href = context.resolveAttachment(name, owner);
      if (href && !owner) attachments.add(name);
      return href;
    },
  };
  const markdown = renderBlocks(parseStorage(xhtml).children, ctx).replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: `${markdown}\n`, links: [...links], attachments: [...attachments], mentions: collectMentions(xhtml), warnings };
}
```

There is a circular import `blocks ↔ inline ↔ macros ↔ tables`; ES modules resolve it because all cross-calls happen at render time, not at module evaluation. Keep all top-level code to constant definitions.

- [ ] **Step 8: Run** `npx vitest run test/core/convert.test.js` → PASS. When a case fails, fix the implementation, not the expected Markdown; if an expectation is genuinely wrong Markdown (check with a CommonMark/GFM renderer), change it and record a Ruling.
- [ ] **Step 9: Commit** `EXPORT-6: Convert Confluence storage format to Markdown`.

### Task 7: Manifest

**Files:**
- Create: `static/app/src/core/manifest.js`
- Test: `static/app/test/core/manifest.test.js`

**Interfaces:**
- Produces:
  - `MANIFEST_FILE = 'export-manifest.json'`, `DELETED_FILE = 'export-deleted.txt'`, `MANIFEST_FORMAT = 'artup-export'`, `MANIFEST_VERSION = 1`.
  - `ManifestPage = { id, title, parentId: string|null, version: number, path, name, weight, links: string[], attachments: { id, version: number, path }[] }`.
  - `buildManifest({ siteUrl, spaceKey, rootPageId: string|null, options, pages: ManifestPage[], warnings: {pageId, kind, detail}[] }) → string` (pretty JSON, pages sorted by path, arrays sorted, trailing newline, no timestamps).
  - `parseManifest(text) → { ok: true, manifest } | { ok: false, error: 'not-json'|'not-manifest'|'newer-version' }`.
  - `previousNames(manifest) → Map<id, name>`.
  - `sameSource(manifest, { siteUrl, spaceKey, rootPageId }) → boolean`, `sameOptions(manifest, options) → boolean`.

- [ ] **Step 1: Failing test**

```js
import { describe, expect, it } from 'vitest';
import { buildManifest, parseManifest, previousNames, sameOptions, sameSource } from '../../src/core/manifest.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';

const page = (id, path, over = {}) => ({ id, title: `T${id}`, parentId: null, version: 1, path, name: path.replace(/\.md$/, ''), weight: 10, links: [], attachments: [], ...over });
const input = {
  siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: null, options: DEFAULT_OPTIONS,
  pages: [page('2', 'b.md', { links: ['9', '1'] }), page('1', 'a.md', { attachments: [{ id: 'att2', version: 1, path: 'a.assets/z.png' }, { id: 'att1', version: 3, path: 'a.assets/y.png' }] })],
  warnings: [{ pageId: '2', kind: 'unknown-macro', detail: 'drawio' }, { pageId: '1', kind: 'dynamic-macro', detail: 'toc' }],
};

describe('manifest', () => {
  it('is deterministic regardless of input order', () => {
    const shuffled = { ...input, pages: [...input.pages].reverse(), warnings: [...input.warnings].reverse() };
    expect(buildManifest(shuffled)).toBe(buildManifest(input));
    expect(buildManifest(input).endsWith('\n')).toBe(true);
    expect(buildManifest(input)).not.toMatch(/"(generatedAt|exportedAt|time)"/);
  });
  it('sorts pages by path and nested arrays', () => {
    const parsed = JSON.parse(buildManifest(input));
    expect(parsed.pages.map((p) => p.id)).toEqual(['1', '2']);
    expect(parsed.pages[0].attachments.map((a) => a.id)).toEqual(['att1', 'att2']);
    expect(parsed.pages[1].links).toEqual(['1', '9']);
    expect(parsed.warnings.map((w) => w.pageId)).toEqual(['1', '2']);
  });
  it('round-trips and exposes previous names', () => {
    const result = parseManifest(buildManifest(input));
    expect(result.ok).toBe(true);
    expect(previousNames(result.manifest)).toEqual(new Map([['1', 'a'], ['2', 'b']]));
    expect(sameSource(result.manifest, { siteUrl: 'https://x.atlassian.net', spaceKey: 'ENG', rootPageId: null })).toBe(true);
    expect(sameSource(result.manifest, { siteUrl: 'https://x.atlassian.net', spaceKey: 'HR', rootPageId: null })).toBe(false);
    expect(sameOptions(result.manifest, DEFAULT_OPTIONS)).toBe(true);
    expect(sameOptions(result.manifest, { ...DEFAULT_OPTIONS, preset: 'hugo' })).toBe(false);
    expect(sameOptions(result.manifest, { ...DEFAULT_OPTIONS, maxAttachmentMb: 10 })).toBe(true);
  });
  it.each([
    ['{', 'not-json'],
    ['{"format":"other","version":1,"pages":[]}', 'not-manifest'],
    ['{"format":"artup-export","version":1}', 'not-manifest'],
    ['{"format":"artup-export","version":2,"pages":[]}', 'newer-version'],
  ])('rejects %s as %s', (text, error) => expect(parseManifest(text)).toEqual({ ok: false, error }));
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```js
export const MANIFEST_FILE = 'export-manifest.json';
export const DELETED_FILE = 'export-deleted.txt';
export const MANIFEST_FORMAT = 'artup-export';
export const MANIFEST_VERSION = 1;
const PATH_OPTIONS = ['preset', 'ordering', 'fileNames', 'attachments'];

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => a.id.length - b.id.length || byText(a.id, b.id);
const byNumeric = (a, b) => a.length - b.length || byText(a, b);

/** Serializes the export state; pages sorted by path, no timestamps, so unchanged content gives identical text. */
export function buildManifest({ siteUrl, spaceKey, rootPageId, options, pages, warnings }) {
  const manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    source: { siteUrl, spaceKey, rootPageId: rootPageId ?? null },
    options: Object.fromEntries(PATH_OPTIONS.map((key) => [key, options[key]])),
    pages: [...pages].sort((a, b) => byText(a.path, b.path)).map((p) => ({
      id: p.id, title: p.title, parentId: p.parentId ?? null, version: p.version, path: p.path, name: p.name, weight: p.weight,
      links: [...new Set(p.links)].sort(byNumeric),
      attachments: [...p.attachments].sort(byId).map((a) => ({ id: a.id, version: a.version, path: a.path })),
    })),
    warnings: [...warnings].sort((a, b) => byNumeric(a.pageId, b.pageId) || byText(a.kind, b.kind) || byText(a.detail, b.detail)),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Parses and validates a manifest text. */
export function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (data?.format !== MANIFEST_FORMAT || !Array.isArray(data.pages)) return { ok: false, error: 'not-manifest' };
  if (data.version > MANIFEST_VERSION) return { ok: false, error: 'newer-version' };
  return { ok: true, manifest: data };
}

/** Page id → file name used in the previous export. */
export function previousNames(manifest) {
  return new Map(manifest.pages.map((p) => [p.id, p.name]));
}

/** True when the manifest was made from the same site, space and root page. */
export function sameSource(manifest, { siteUrl, spaceKey, rootPageId }) {
  const s = manifest.source ?? {};
  return s.siteUrl === siteUrl && s.spaceKey === spaceKey && (s.rootPageId ?? null) === (rootPageId ?? null);
}

/** True when the options that shape paths match. */
export function sameOptions(manifest, options) {
  return PATH_OPTIONS.every((key) => manifest.options?.[key] === options[key]);
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `EXPORT-7: Add the deterministic export manifest`.

### Task 8: Update planning (changed, moved, deleted)

**Files:**
- Create: `static/app/src/core/increment.js`
- Test: `static/app/test/core/increment.test.js`

**Interfaces:**
- Consumes: `ManifestPage` (Task 7), plan entries from `planPaths` (Task 4).
- Produces: `planUpdate({ previous: Manifest, versions: Map<id, number>, plan: Map<id, {path, weight}>, attachments: Map<id, {id, version}[]>|null, attachmentPlan: Map<pageId, Map<attId, path>> }) → { fetchIds: Set<string>, downloadIds: Set<attachmentId>, deletePaths: string[], stats: { added, changed, moved, deleted, missing, unchanged } }`.

Rules (the tests are the contract):
1. New page (not in previous) → fetch. `added`.
2. Version or weight differs → fetch. `changed`.
3. Path differs → fetch, old page path and old attachment paths → delete. `moved`.
4. Page in previous, absent now → its path and attachment paths → delete; counts as `missing` (the UI says "deleted or no access"). Its id is added to the "gone" set.
5. An unchanged page whose `links` include a moved or gone id → fetch (links must be rewritten).
6. Attachments (when `attachments` map is given): for a fetched page — download all attachments planned for it; for an unfetched page — download new or version-changed ones; any previous attachment whose id is not planned now → delete its old path; an attachment whose path changed → download and delete the old path.
7. `deletePaths` never contains a path written by this export (page paths of `fetchIds`, attachment paths of `downloadIds`, and every planned path in general) — sorted, unique.

- [ ] **Step 1: Failing test**

```js
import { describe, expect, it } from 'vitest';
import { planUpdate } from '../../src/core/increment.js';

const prev = (pages) => ({ pages: pages.map((p) => ({ links: [], attachments: [], weight: 10, ...p })) });
const plan = (rows) => new Map(rows.map(([id, path, weight = 10]) => [id, { path, weight }]));

describe('planUpdate', () => {
  it('fetches only new and changed pages', () => {
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'a.md' }, { id: '2', version: 1, path: 'b.md' }]),
      versions: new Map([['1', 1], ['2', 2], ['3', 1]]),
      plan: plan([['1', 'a.md'], ['2', 'b.md'], ['3', 'c.md']]),
      attachments: null, attachmentPlan: new Map(),
    });
    expect([...result.fetchIds].sort()).toEqual(['2', '3']);
    expect(result.deletePaths).toEqual([]);
    expect(result.stats).toEqual({ added: 1, changed: 1, moved: 0, deleted: 0, missing: 0, unchanged: 1 });
  });

  it('refetches a reordered page (weight change)', () => {
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'a.md', weight: 10 }]),
      versions: new Map([['1', 1]]), plan: plan([['1', 'a.md', 20]]), attachments: null, attachmentPlan: new Map(),
    });
    expect([...result.fetchIds]).toEqual(['1']);
  });

  it('moves: deletes the old path, relinks pages pointing to it', () => {
    const result = planUpdate({
      previous: prev([
        { id: '1', version: 1, path: 'old.md', attachments: [{ id: 'a1', version: 1, path: 'old.assets/x.png' }] },
        { id: '2', version: 1, path: 'b.md', links: ['1'] },
      ]),
      versions: new Map([['1', 2], ['2', 1]]),
      plan: plan([['1', 'new.md'], ['2', 'b.md']]),
      attachments: new Map([['1', [{ id: 'a1', version: 1 }]], ['2', []]]),
      attachmentPlan: new Map([['1', new Map([['a1', 'new.assets/x.png']])], ['2', new Map()]]),
    });
    expect([...result.fetchIds].sort()).toEqual(['1', '2']);
    expect([...result.downloadIds]).toEqual(['a1']);
    expect(result.deletePaths).toEqual(['old.assets/x.png', 'old.md']);
    expect(result.stats.moved).toBe(1);
  });

  it('never deletes a path written in the same export (title swap)', () => {
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'x.md' }, { id: '2', version: 1, path: 'y.md' }]),
      versions: new Map([['1', 2], ['2', 2]]),
      plan: plan([['1', 'y.md'], ['2', 'x.md']]), attachments: null, attachmentPlan: new Map(),
    });
    expect(result.deletePaths).toEqual([]);
    expect([...result.fetchIds].sort()).toEqual(['1', '2']);
  });

  it('reports missing pages (deleted or restricted) and relinks their referrers', () => {
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'gone.md', attachments: [{ id: 'a9', version: 1, path: 'gone.assets/f.pdf' }] }, { id: '2', version: 1, path: 'b.md', links: ['1'] }]),
      versions: new Map([['2', 1]]), plan: plan([['2', 'b.md']]), attachments: null, attachmentPlan: new Map(),
    });
    expect(result.deletePaths).toEqual(['gone.assets/f.pdf', 'gone.md']);
    expect([...result.fetchIds]).toEqual(['2']);
    expect(result.stats).toMatchObject({ missing: 1, unchanged: 0 });
  });

  it('downloads new or changed attachments of unchanged pages and deletes removed ones', () => {
    const result = planUpdate({
      previous: prev([{ id: '1', version: 1, path: 'a.md', attachments: [{ id: 'a1', version: 1, path: 'a.assets/one.png' }, { id: 'a2', version: 1, path: 'a.assets/two.png' }, { id: 'a3', version: 1, path: 'a.assets/three.png' }] }]),
      versions: new Map([['1', 1]]), plan: plan([['1', 'a.md']]),
      attachments: new Map([['1', [{ id: 'a1', version: 1 }, { id: 'a2', version: 2 }, { id: 'a4', version: 1 }]]]),
      attachmentPlan: new Map([['1', new Map([['a1', 'a.assets/one.png'], ['a2', 'a.assets/two.png'], ['a4', 'a.assets/four.png']])]]),
    });
    expect([...result.fetchIds]).toEqual([]);
    expect([...result.downloadIds].sort()).toEqual(['a2', 'a4']);
    expect(result.deletePaths).toEqual(['a.assets/three.png']);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```js
/** Decides what an update export fetches, downloads and deletes relative to the previous manifest. */
export function planUpdate({ previous, versions, plan, attachments, attachmentPlan }) {
  const fetchIds = new Set();
  const downloadIds = new Set();
  const deletes = new Set();
  const gone = new Set();
  const stats = { added: 0, changed: 0, moved: 0, deleted: 0, missing: 0, unchanged: 0 };
  const byId = new Map(previous.pages.map((p) => [p.id, p]));

  for (const [id, version] of versions) {
    const old = byId.get(id);
    const now = plan.get(id);
    if (!old) {
      fetchIds.add(id);
      stats.added += 1;
      continue;
    }
    if (old.path !== now.path) {
      fetchIds.add(id);
      gone.add(id);
      stats.moved += 1;
      deletes.add(old.path);
      old.attachments.forEach((a) => deletes.add(a.path));
    } else if (old.version !== version || old.weight !== now.weight) {
      fetchIds.add(id);
      stats.changed += 1;
    }
  }
  for (const old of previous.pages) {
    if (versions.has(old.id)) continue;
    gone.add(old.id);
    stats.missing += 1;
    deletes.add(old.path);
    old.attachments.forEach((a) => deletes.add(a.path));
  }
  for (const old of previous.pages) {
    if (versions.has(old.id) && !fetchIds.has(old.id) && old.links.some((id) => gone.has(id))) fetchIds.add(old.id);
  }
  if (attachments) {
    for (const [pageId, list] of attachments) {
      const planned = attachmentPlan.get(pageId) ?? new Map();
      const oldById = new Map((byId.get(pageId)?.attachments ?? []).map((a) => [a.id, a]));
      for (const attachment of list) {
        const old = oldById.get(attachment.id);
        if (fetchIds.has(pageId) || !old || old.version !== attachment.version || old.path !== planned.get(attachment.id)) downloadIds.add(attachment.id);
        if (old && old.path !== planned.get(attachment.id)) deletes.add(old.path);
      }
      for (const old of oldById.values()) {
        if (!planned.has(old.id)) deletes.add(old.path);
      }
    }
  }
  const written = new Set([...plan.values()].map((p) => p.path));
  attachmentPlan.forEach((map) => map.forEach((path) => written.add(path)));
  stats.unchanged = [...versions.keys()].filter((id) => !fetchIds.has(id)).length;
  return { fetchIds, downloadIds, deletePaths: [...deletes].filter((p) => !written.has(p)).sort(), stats };
}
```

`stats.moved` counts path changes; in the "moves" test page 1 also changed version — it counts once as moved (path check first). Run the tests; `stats.unchanged` in the first test is 1 (page 1).

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `EXPORT-8: Plan update exports from the previous manifest`.

### Task 9: Confluence client, pool, zip

**Files:**
- Create: `static/app/src/infra/pool.js`, `static/app/src/infra/confluence.js`, `static/app/src/infra/zip.js`, `static/app/src/infra/download.js`
- Test: `static/app/test/infra/pool.test.js`, `static/app/test/infra/confluence.test.js`, `static/app/test/infra/zip.test.js`

**Interfaces:**
- Produces:
  - `createPool(concurrency) → run(fn) → Promise` (at most `concurrency` fns in flight).
  - `createConfluenceClient({ request, sleep, concurrency = 6, signal }) → { getSpace(key), listRootPages(spaceId), listChildren(pageId), getPages(ids, { withBody }), getLabels(pageId), listAttachments(pageId), download(downloadLink), getUsers(accountIds), searchPages(spaceKey, text) }`. `request(path, init)` is `requestConfluence` from `@forge/bridge`. Page shape returned by `getPages`: `{ id, title, parentId, spaceId, version: { number, createdAt, authorId }, body: string|null }`.
  - `createZipWriter() → { addText(path, text, mtime: Date), addBinary(path, bytes: Uint8Array, mtime: Date), finish() → Promise<Blob>, size() → number }`; `readManifestFromFile(file: File|Blob) → Promise<string|null>` (zip or plain JSON).
  - `saveBlob(fileName, blob, doc = document)`; `exportFileName({ spaceKey, rootTitle, mode, now: Date }) → string`.

The exact endpoints are the ones measured in Task 0.2; defaults below:

| Method | Endpoint |
|---|---|
| getSpace | `GET /wiki/api/v2/spaces?keys=<key>` → `results[0]` `{ id, key, name, homepageId }` |
| listRootPages | `GET /wiki/api/v2/spaces/<id>/pages?depth=root&limit=250` (paginated) |
| listChildren | `GET /wiki/api/v2/pages/<id>/children?limit=250` (paginated, sorted by `childPosition`) |
| getPages | `GET /wiki/api/v2/pages?id=<≤250 ids comma>&limit=250[&body-format=storage]` |
| getLabels | `GET /wiki/api/v2/pages/<id>/labels?limit=250` → names |
| listAttachments | `GET /wiki/api/v2/pages/<id>/attachments?limit=250` → `{ id, title, fileSize, mediaType, version.number, downloadLink }` |
| download | `GET /wiki<downloadLink>` → `Uint8Array` |
| getUsers | `GET /wiki/rest/api/user/bulk?accountId=<a>&accountId=<b>` (chunks of the measured max) → `Map<id, displayName>` |
| searchPages | `GET /wiki/rest/api/search?cql=<encoded>&limit=20` with `type=page AND space="<key>" AND title~"<text>*"` → `{ id, title }[]` |

Pagination: follow `_links.next` (relative, starts with `/wiki/…`) until absent.
Retries: 429 and 5xx → wait `Retry-After` seconds (header, default `2 ** attempt` s, max 30 s), up to 5 attempts, then throw `ConfluenceError(status, path)`. 401/403/404 → throw immediately. Every wait and request checks `signal.aborted` → throw `new DOMException('Aborted', 'AbortError')`.

- [ ] **Step 1: Failing tests** — `pool.test.js` (never more than N in flight; results in call order; a rejection rejects only its own promise); `confluence.test.js` with a fake `request` built from a route table:

```js
import { describe, expect, it, vi } from 'vitest';
import { createConfluenceClient } from '../../src/infra/confluence.js';

const json = (body, status = 200, headers = {}) => ({
  ok: status < 400, status, headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
});

describe('confluence client', () => {
  it('follows pagination and sorts children by position', async () => {
    const request = vi.fn(async (path) => {
      if (path === '/wiki/api/v2/pages/1/children?limit=250') return json({ results: [{ id: '3', title: 'B', childPosition: 2 }], _links: { next: '/wiki/api/v2/pages/1/children?cursor=x&limit=250' } });
      return json({ results: [{ id: '2', title: 'A', childPosition: 1 }], _links: {} });
    });
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect(await client.listChildren('1')).toEqual([{ id: '2', title: 'A', position: 1 }, { id: '3', title: 'B', position: 2 }]);
  });

  it('retries 429 using Retry-After, then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi.fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json({ results: [{ id: '5', key: 'ENG', name: 'Eng', homepageId: '6' }] }));
    const client = createConfluenceClient({ request, sleep });
    expect(await client.getSpace('ENG')).toEqual({ id: '5', key: 'ENG', name: 'Eng', homepageId: '6' });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('fails fast on 403 with the status', async () => {
    const client = createConfluenceClient({ request: async () => json({}, 403), sleep: async () => {} });
    await expect(client.getSpace('ENG')).rejects.toMatchObject({ name: 'ConfluenceError', status: 403 });
  });

  it('batches page ids by 250 and maps pages', async () => {
    const ids = Array.from({ length: 260 }, (_, i) => String(i + 1));
    const request = vi.fn(async (path) => {
      const batch = new URL(`https://h${path}`).searchParams.get('id').split(',');
      return json({ results: batch.map((id) => ({ id, title: `T${id}`, parentId: '0', spaceId: '5', version: { number: 1, createdAt: '2026-01-01T00:00:00Z', authorId: 'u1' }, body: { storage: { value: '<p/>' } } })) });
    });
    const pages = await createConfluenceClient({ request, sleep: async () => {} }).getPages(ids, { withBody: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(pages).toHaveLength(260);
    expect(pages[0]).toEqual({ id: '1', title: 'T1', parentId: '0', spaceId: '5', version: { number: 1, createdAt: '2026-01-01T00:00:00Z', authorId: 'u1' }, body: '<p/>' });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createConfluenceClient({ request: async () => json({}), sleep: async () => {}, signal: controller.signal });
    await expect(client.getSpace('ENG')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('downloads bytes and resolves users in chunks', async () => {
    const request = vi.fn(async (path) => (path.startsWith('/wiki/download') ? json({}) : json({ results: [{ accountId: 'u1', displayName: 'Ann' }] })));
    const client = createConfluenceClient({ request, sleep: async () => {} });
    expect([...(await client.download('/download/attachments/1/a.png'))]).toEqual([1, 2, 3]);
    expect(await client.getUsers(['u1'])).toEqual(new Map([['u1', 'Ann']]));
  });
});
```

`zip.test.js`: write two text files (one with a Cyrillic path) and one binary, `finish()`, read back with `unzipSync` from fflate: same names, same bytes, UTF-8 names; `readManifestFromFile` returns the manifest text from a zip that contains `export-manifest.json` at root, from a zip where it sits inside one top folder, from a plain `.json` Blob, and `null` for a zip without it.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `pool.js`**

```js
/** Runs async functions with at most `concurrency` in flight. */
export function createPool(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve().then(fn).then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
```

- [ ] **Step 4: Implement `confluence.js`**

```js
import { createPool } from './pool.js';

const BATCH = 250;
const USERS_BATCH = 100;

/** Confluence REST failure with its HTTP status. */
export class ConfluenceError extends Error {
  constructor(status, path) {
    super(`confluence ${status} ${path}`);
    this.name = 'ConfluenceError';
    this.status = status;
  }
}

function chunks(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}

/** Confluence REST client over requestConfluence with a concurrency pool, retries and cancellation. */
export function createConfluenceClient({ request, sleep, concurrency = 6, signal }) {
  const run = createPool(concurrency);
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const send = (path, parse) => run(async () => {
    for (let attempt = 0; ; attempt += 1) {
      checkAbort();
      const response = await request(path, { headers: { Accept: 'application/json' } });
      if (response.ok) return parse(response);
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt >= 4) throw new ConfluenceError(response.status, path);
      const header = Number(response.headers.get('retry-after'));
      await sleep(Math.min(30, Number.isFinite(header) && header > 0 ? header : 2 ** attempt) * 1000);
    }
  });
  const getJson = (path) => send(path, (r) => r.json());
  const all = async (path) => {
    const results = [];
    for (let next = path; next;) {
      const page = await getJson(next);
      results.push(...(page.results ?? []));
      next = page._links?.next ?? null;
    }
    return results;
  };
  return {
    async getSpace(key) {
      const page = await getJson(`/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}`);
      const space = page.results?.[0];
      if (!space) throw new ConfluenceError(404, `space ${key}`);
      return { id: String(space.id), key: space.key, name: space.name, homepageId: space.homepageId ? String(space.homepageId) : null };
    },
    async listRootPages(spaceId) {
      const rows = await all(`/wiki/api/v2/spaces/${spaceId}/pages?depth=root&limit=${BATCH}`);
      return rows.map((r) => ({ id: String(r.id), title: r.title, position: r.position ?? 0 })).sort((a, b) => a.position - b.position);
    },
    async listChildren(pageId) {
      const rows = await all(`/wiki/api/v2/pages/${pageId}/children?limit=${BATCH}`);
      return rows.map((r) => ({ id: String(r.id), title: r.title, position: r.childPosition ?? 0 })).sort((a, b) => a.position - b.position);
    },
    async getPages(ids, { withBody }) {
      const batches = await Promise.all(chunks(ids, BATCH).map((batch) => all(`/wiki/api/v2/pages?id=${batch.join(',')}&limit=${BATCH}${withBody ? '&body-format=storage' : ''}`)));
      return batches.flat().map((p) => ({
        id: String(p.id), title: p.title, parentId: p.parentId ? String(p.parentId) : null, spaceId: String(p.spaceId),
        version: { number: p.version?.number ?? 0, createdAt: p.version?.createdAt ?? '', authorId: p.version?.authorId ?? null },
        body: withBody ? p.body?.storage?.value ?? '' : null,
      }));
    },
    async getLabels(pageId) {
      return (await all(`/wiki/api/v2/pages/${pageId}/labels?limit=${BATCH}`)).map((l) => l.name);
    },
    async listAttachments(pageId) {
      return (await all(`/wiki/api/v2/pages/${pageId}/attachments?limit=${BATCH}`)).map((a) => ({
        id: String(a.id), title: a.title, fileSize: a.fileSize ?? 0, mediaType: a.mediaType ?? '', version: a.version?.number ?? 0,
        createdAt: a.version?.createdAt ?? '', downloadLink: a.downloadLink,
      }));
    },
    download(downloadLink) {
      return send(`/wiki${downloadLink}`, async (r) => new Uint8Array(await r.arrayBuffer()));
    },
    async getUsers(accountIds) {
      const result = new Map();
      for (const batch of chunks([...new Set(accountIds)], USERS_BATCH)) {
        const page = await getJson(`/wiki/rest/api/user/bulk?${batch.map((id) => `accountId=${encodeURIComponent(id)}`).join('&')}`);
        (page.results ?? []).forEach((u) => result.set(u.accountId, u.displayName ?? u.publicName ?? null));
      }
      return result;
    },
    async searchPages(spaceKey, text) {
      const escaped = String(text).replace(/["\\]/g, '');
      const cql = `type=page AND space="${spaceKey}" AND title~"${escaped}*"`;
      const page = await getJson(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=20`);
      return (page.results ?? []).map((r) => ({ id: String(r.content?.id ?? r.id), title: r.content?.title ?? r.title }));
    },
  };
}
```

- [ ] **Step 5: Implement `zip.js` and `download.js`**

```js
import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { MANIFEST_FILE } from '../core/manifest.js';

/** Streaming zip writer; text is deflated, binaries are stored as-is. Returns the zip as a Blob. */
export function createZipWriter() {
  const parts = [];
  let bytes = 0;
  let done;
  let failed;
  const finished = new Promise((resolve, reject) => {
    done = resolve;
    failed = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed(error);
      return;
    }
    parts.push(chunk);
    bytes += chunk.length;
    if (final) done(new Blob(parts, { type: 'application/zip' }));
  });
  const add = (file, data) => {
    zip.add(file);
    file.push(data, true);
  };
  return {
    addText(path, text, mtime) {
      add(new ZipDeflate(path, { level: 6, mtime }), strToU8(text));
    },
    addBinary(path, data, mtime) {
      const file = new ZipPassThrough(path);
      file.mtime = mtime;
      add(file, data);
    },
    finish() {
      zip.end();
      return finished;
    },
    size: () => bytes,
  };
}

/** Manifest text from a dropped previous export (zip or .json), or null when it has none. */
export async function readManifestFromFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  if (!isZip) return new TextDecoder().decode(data);
  const entries = unzipSync(data, { filter: (f) => f.name === MANIFEST_FILE || f.name.endsWith(`/${MANIFEST_FILE}`) });
  const name = Object.keys(entries).sort((a, b) => a.length - b.length)[0];
  return name ? new TextDecoder().decode(entries[name]) : null;
}
```

`download.js`: `saveBlob` (same as Trace `saveTextFile`, but takes a Blob) and

```js
/** Zip name: artup-export-<space>[-<root>]-<YYYY-MM-DD>[-update].zip in the user's local date. */
export function exportFileName({ spaceKey, rootSlug, mode, now }) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const key = String(spaceKey || 'space').replace(/[^A-Za-z0-9_-]/g, '');
  return ['artup-export', key, rootSlug, date, mode === 'update' ? 'update' : ''].filter(Boolean).join('-') + '.zip';
}
```

with a test: `exportFileName({ spaceKey: 'ENG', rootSlug: 'api', mode: 'update', now: new Date(2026, 8, 28) })` → `artup-export-ENG-api-2026-09-28-update.zip`.

- [ ] **Step 6: Run** → PASS. **Step 7: Commit** `EXPORT-9: Add the Confluence client, pool and zip I/O`.

### Task 10: Export pipeline (tree scan → convert → zip) with progress and cancel

**Files:**
- Create: `static/app/src/export/tree.js`, `static/app/src/export/pipeline.js`
- Test: `static/app/test/export/pipeline.test.js`, fake client `static/app/test/fixtures/fakeConfluence.js`

**Interfaces:**
- Consumes: everything from Tasks 3–9.
- Produces:
  - `scanTree(client, target, onProgress) → Promise<ExportTree>` where `target = { kind: 'space'|'branch'|'page', spaceKey, pageId?: string }`.
  - `runExport({ client, target, options, previousManifest: Manifest|null, siteUrl, signal, onProgress, now: Date }) → Promise<ExportResult>`.
  - `onProgress({ stage: 'scan'|'pages'|'attachments'|'pack', done: number, total: number })`.
  - `ExportResult = { blob: Blob, fileName: string, mode: 'full'|'update', stats: { pages, written, attachments, skippedAttachments, deleted, missing, added, changed, moved, unchanged, bytes }, warnings: { pageId, title, kind, detail }[], deletePaths: string[], fullReason: null|'options-changed'|'other-source' }`.

Behaviour:
1. `scanTree`: space → `listRootPages` then BFS `listChildren`; branch → the page + BFS; page → only the page (childIds `[]`). BFS level by level through the pool; `onProgress({ stage: 'scan', done: nodesFound, total: 0 })` (total unknown → UI shows indeterminate).
2. Metadata: `getPages(allIds, { withBody: false })` → versions, parentIds, authorIds; titles from here win over the child listing.
3. Mode: `update` when `previousManifest` is given, `sameSource` holds and `sameOptions` holds; otherwise `full` with `fullReason` (`'other-source'` / `'options-changed'`) — the UI warns before starting.
4. Paths: `planPaths(tree, options, previousManifest ? previousNames(previousManifest) : new Map())` (names are reused even for a forced full export when the source matches).
5. Attachments metadata: when `options.attachments !== 'none'`, `listAttachments` for every page (update needs it for all pages; full needs it for the pages it writes = all).
6. Update: `planUpdate(...)` → `fetchIds`, `downloadIds`, `deletePaths`, stats. Full: fetch all, download all (subject to filters).
7. Bodies: `getPages([...fetchIds], { withBody: true })`, labels per fetched page via the pool; `onProgress('pages', done, total)`.
8. Users: `getUsers(unique authorIds of fetched pages ∪ collectMentions of their bodies)`.
9. Convert each fetched page with a `ConvertContext`:
   - `resolvePage({ title, spaceKey })`: when `spaceKey` is empty or equals the export space and the title belongs to an exported page → `{ id, href: relativePath(fromPath, targetPath) }`; else `{ id: null, href: `${siteUrl}/wiki/display/${spaceKey || exportSpaceKey}/${encodeURIComponent(title)}` }`. Title lookup: `Map<title, id>`; duplicate titles within a space are impossible in Confluence, so first wins.
   - `resolveAttachment(filename, owner)`: owner absent → attachment of the current page by title → relative path from the page to its planned attachment path (only if that attachment will exist in the output: not `none`, not skipped by size); owner present and inside export → the owner page's attachment; else `null`.
   - `resolveUser(id)` → users map; `childLinks()` → children of the page in order with relative hrefs.
10. `referenced` mode: an attachment is written only if some converted page references it (current page's `attachments` result) — for unchanged pages in update mode, keep the previous manifest's attachment set.
11. Attachments over `maxAttachmentMb` → skipped, warning `attachment-too-large` (add this kind to the UI's warning dictionary), not written, not in manifest.
12. Zip: every fetched page → `renderFrontMatter(meta, options) + markdown` at its path, `mtime = new Date(version.createdAt)`; downloaded attachments at their paths (`mtime` = attachment `createdAt`); `presetFiles(...)` always; `export-manifest.json` built from **all** pages (previous entries for unchanged pages carry their old `links`/`attachments`, fetched pages carry new ones); `export-deleted.txt` (paths joined by `\n` + trailing newline) only when `deletePaths` is non-empty; `onProgress('pack', …)`.
13. The file name uses `now`; nothing inside the zip does.
14. Every await point checks `signal`; cancellation rejects with `AbortError` and leaves nothing behind.

- [ ] **Step 1: Fake client** `fakeConfluence.js`: `createFakeConfluence({ space, pages: [{ id, title, parentId, position, version, authorId, body, labels, attachments: [{ id, title, version, bytes }] }], users })` implementing the client interface in memory, counting calls per method (`calls.getPages`, `calls.download`), plus two mutators for update tests: `update(id, patch)` (merges `title`, `version`, `body`, `parentId`, `position`) and `remove(id)` (drops the page and detaches it from its parent). `listRootPages`/`listChildren` return pages sorted by `position`; `getPages` returns `version.createdAt` as `2026-01-0<version>T00:00:00.000Z` so front-matter is deterministic.

- [ ] **Step 2: Failing tests** `pipeline.test.js`:

```js
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { runExport } from '../../src/export/pipeline.js';
import { DEFAULT_OPTIONS } from '../../src/core/presets.js';
import { createFakeConfluence } from '../fixtures/fakeConfluence.js';

const PNG = new Uint8Array([137, 80, 78, 71]);
const pages = () => [
  { id: '1', title: 'Home', parentId: null, position: 0, version: 3, authorId: 'u1', labels: ['doc'], body: '<p>Welcome to <ac:link><ri:page ri:content-title="API"/></ac:link></p>', attachments: [] },
  { id: '2', title: 'API', parentId: '1', position: 0, version: 1, authorId: 'u1', labels: [], body: '<p><ac:image><ri:attachment ri:filename="d.png"/></ac:image></p>', attachments: [{ id: 'a1', title: 'd.png', version: 1, bytes: PNG }] },
  { id: '3', title: 'Café', parentId: '1', position: 1, version: 1, authorId: 'u2', labels: [], body: '<p>Back to <ac:link><ri:page ri:content-title="Home"/></ac:link></p>', attachments: [] },
];
const files = async (result) => Object.fromEntries(Object.entries(unzipSync(new Uint8Array(await result.blob.arrayBuffer()))).map(([k, v]) => [k, k.endsWith('.png') ? [...v] : strFromU8(v)]));
const run = (fake, over = {}) => runExport({
  client: fake.client, target: { kind: 'space', spaceKey: 'ENG' }, options: DEFAULT_OPTIONS, previousManifest: null,
  siteUrl: 'https://x.atlassian.net', signal: new AbortController().signal, onProgress: () => {}, now: new Date(2026, 8, 28), ...over,
});

describe('runExport', () => {
  it('exports the whole space with paths, front-matter, links and attachments', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const out = await files(await run(fake));
    expect(Object.keys(out).sort()).toEqual(['export-manifest.json', 'home/api.assets/d.png', 'home/api.md', 'home/cafe.md', 'home/index.md']);
    expect(out['home/index.md']).toContain('title: "Home"');
    expect(out['home/index.md']).toContain('Welcome to [API](api.md)');
    expect(out['home/cafe.md']).toContain('Back to [Home](index.md)');
    expect(out['home/api.md']).toContain('![](api.assets/d.png)');
    expect(out['home/api.assets/d.png']).toEqual([...PNG]);
  });

  it('gives byte-identical files on a repeated export (zero diff)', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const first = await files(await run(fake));
    const second = await files(await run(fake, { now: new Date(2027, 0, 1) }));
    expect(second).toEqual(first);
  });

  it('update export writes only changed pages and lists deletions', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const first = await files(await run(fake));
    const previousManifest = JSON.parse(first['export-manifest.json']);
    fake.update('3', { title: 'Cafe Renamed', version: 2 });
    fake.remove('2');
    const result = await run(fake, { previousManifest });
    const out = await files(result);
    expect(result.mode).toBe('update');
    expect(Object.keys(out).sort()).toEqual(['export-deleted.txt', 'export-manifest.json', 'home/cafe-renamed.md', 'home/index.md']);
    expect(out['export-deleted.txt']).toBe('home/api.assets/d.png\nhome/api.md\nhome/cafe.md\n');
    expect(out['home/index.md']).toContain('[API](https://x.atlassian.net/wiki/display/ENG/API)');
    expect(result.stats).toMatchObject({ moved: 1, missing: 1 });
  });

  it('an update with no changes writes only the manifest, identical to the previous one', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: { u1: 'Ann', u2: 'Bo' } });
    const first = await files(await run(fake));
    const result = await run(fake, { previousManifest: JSON.parse(first['export-manifest.json']) });
    const out = await files(result);
    expect(Object.keys(out)).toEqual(['export-manifest.json']);
    expect(out['export-manifest.json']).toBe(first['export-manifest.json']);
    expect(fake.calls.download).toBe(1);
  });

  it('falls back to a full export when options changed', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: {} });
    const first = await files(await run(fake));
    const result = await run(fake, { previousManifest: JSON.parse(first['export-manifest.json']), options: { ...DEFAULT_OPTIONS, preset: 'hugo' } });
    expect(result).toMatchObject({ mode: 'full', fullReason: 'options-changed' });
  });

  it('skips attachments above the size limit with a warning', async () => {
    const big = pages();
    big[1].attachments[0].bytes = new Uint8Array(2 * 1024 * 1024);
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: big, users: {} });
    const result = await run(fake, { options: { ...DEFAULT_OPTIONS, maxAttachmentMb: 1 } });
    expect(Object.keys(await files(result))).not.toContain('home/api.assets/d.png');
    expect(result.warnings).toContainEqual({ pageId: '2', title: 'API', kind: 'attachment-too-large', detail: 'd.png' });
  });

  it('exports a branch and a single page', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: {} });
    const branch = await files(await run(fake, { target: { kind: 'branch', spaceKey: 'ENG', pageId: '1' } }));
    expect(Object.keys(branch)).toContain('home/cafe.md');
    const single = await files(await run(fake, { target: { kind: 'page', spaceKey: 'ENG', pageId: '3' } }));
    expect(Object.keys(single).sort()).toEqual(['cafe.md', 'export-manifest.json']);
  });

  it('reports progress per stage and can be cancelled', async () => {
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: pages(), users: {} });
    const stages = [];
    await run(fake, { onProgress: (p) => stages.push(p.stage) });
    expect([...new Set(stages)]).toEqual(['scan', 'pages', 'attachments', 'pack']);
    const controller = new AbortController();
    const pending = run(fake, { signal: controller.signal, onProgress: (p) => p.stage === 'pages' && controller.abort() });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resolves 1 000 pages in a deep tree without duplicate paths', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 1), title: i % 7 === 0 ? 'Notes' : `Page ${i}`, parentId: i === 0 ? null : String(Math.floor(i / 4) + 1), position: i, version: 1, authorId: 'u1', labels: [], body: '<p>x</p>', attachments: [] }));
    const fake = createFakeConfluence({ space: { id: '5', key: 'ENG', name: 'Eng' }, pages: many, users: {} });
    const out = await files(await run(fake));
    const mdFiles = Object.keys(out).filter((k) => k.endsWith('.md'));
    expect(mdFiles).toHaveLength(1000);
    expect(new Set(mdFiles.map((f) => f.toLowerCase())).size).toBe(1000);
  });
});
```

- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement `tree.js`** (BFS, level by level, `Promise.all` over the level through the client's pool; `nodes` Map in BFS discovery order; `childIds` in position order; progress after each level).
- [ ] **Step 5: Implement `pipeline.js`** following Behaviour 1–14. Structure it as small named functions in the same file — `decideMode`, `collectAttachments`, `fetchContent`, `makeConvertContext`, `writePages`, `writeAttachments`, `finalManifestPages` — each ≤ 40 lines, `runExport` only sequences them and emits progress. Page meta for front-matter: `{ id, title, spaceKey, parentId, version: version.number, author: users.get(authorId) ?? null, updated: version.createdAt, labels, url: `${siteUrl}/wiki/spaces/${spaceKey}/pages/${id}`, weight }`.
- [ ] **Step 6: Run** → PASS (all pipeline tests, then the full suite).
- [ ] **Step 7: Commit** `EXPORT-10: Orchestrate full and update exports with progress and cancel`.

### Task 11: Visual foundation — icon, illustrations, shared components, preview harness

**Files:**
- Create: `resources/icon.svg`, `static/app/src/illustrations/{ExportIllustration,EmptyIllustration,LockIllustration,SuccessIllustration}.jsx`, `static/app/src/components/{AppHeader,StepSection,ChoiceCard,StatTile,FileTree,PageLayout}.jsx`, `static/app/preview/index.html`, `static/app/preview/main.jsx`, `static/app/preview/bridgeMock.js`, `static/app/preview/fixtures.js`
- Modify: `static/app/vite.config.js` (preview mode aliases `@forge/bridge` → `preview/bridgeMock.js`)
- Test: `static/app/test/components.test.jsx`

**Interfaces:**
- Produces (props are the contract):
  - `AppHeader({ subtitle, actions })` — icon + `app.name` + subtitle + right-aligned actions.
  - `StepSection({ number, title, description, children })` — numbered section with a circular badge.
  - `ChoiceCard({ selected, onSelect, icon, title, description, badge, disabled, testId })` — radio-like card, keyboard focusable (`role="radio"`, `aria-checked`, Space/Enter select), used for scope and preset choices.
  - `StatTile({ label, value, tone: 'neutral'|'success'|'warning'|'danger', icon })`.
  - `FileTree({ paths: string[], limit = 14, moreLabel })` — monospace tree with folder/file glyphs, indentation guides, `+N more` row.
  - `PageLayout({ main, aside })` — `Grid` 7/5 above 900px (`media.above.md`), stacked below; aside is sticky.
  - Illustrations: `({ size = 120 })`, pure SVG with `fill={token('color.background.accent.blue.subtle')}` etc.; no text inside the SVG.

Visual design (binding for Tasks 12–14):
- **Icon** (`resources/icon.svg`, 24×24 viewBox, also rendered at 144×144 for the listing): a rounded document (radius 3) with a folded corner, a Markdown-style "M↓" mark in the body, and a small branch glyph (two dots joined by a curve) at the bottom-right — reads as "document → git". Two brand colours only (blue `#1868DB` body, white mark) — the SVG file under `resources/` is the one place hex colours are allowed (the guard test scans only `static/app/src`).
- **Header**: 32px icon, `Heading size="large"` app name, subtitle in `color.text.subtle`, space name as a `Lozenge`.
- **Step sections**: number badge 24px circle `color.background.brand.bold` with `color.text.inverse` digit; title `Heading size="small"`; description `color.text.subtle`; 16px gap to content.
- **Choice cards**: `Box` with `border.width` + `color.border`, radius `border.radius.200`, padding `space.200`; hover `elevation.surface.hovered`; selected → `color.border.selected` 2px + `color.background.selected`; icon 24px in a 40px rounded square tinted per card (`color.background.accent.{blue,purple,teal,orange}.subtler`); title semibold; description subtle, 2 lines max with wrap.
- **File tree**: surface `elevation.surface.sunken`, radius 8, padding `space.200`, `font.family.code` 12px, indentation guides `color.border` 1px, folder names `color.text`, files `color.text.subtle`, `.md` icon vs attachment icon differ.
- **Stat tiles**: `elevation.surface.raised` + shadow `elevation.shadow.raised`, value `font.heading.large`, label `color.text.subtle`, tone colours from `color.icon.{success,warning,danger}`.
- Motion: none beyond Atlaskit defaults (no custom animation).

- [ ] **Step 1: Failing component tests**: `ChoiceCard` toggles via click and keyboard (`Space`), exposes `aria-checked`; `FileTree` renders nested folders from `['a/index.md','a/b.md','c.md']` as three rows plus folder `a`, and `+2 more` when limit is exceeded (text comes from `moreLabel`); `StatTile` renders label and value; `PageLayout` renders both slots; illustrations render an `svg` with no `<text>`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the components with `@atlaskit/primitives` + `xcss` + tokens only. **Step 4: Run** → PASS.
- [ ] **Step 5: Preview harness.** `preview/bridgeMock.js` exports `view.getContext()` (reads `?locale=&theme=&state=&target=` from `location.search`), `view.theme.enable()` → `setGlobalTheme({ colorMode: theme })` from `@atlaskit/tokens`, `invoke('getAccess')` → `{ licensed: state !== 'unlicensed' }`, `requestConfluence` served from `preview/fixtures.js` (a 60-page space with Cyrillic/CJK/long titles, 5 attachments, warnings-producing macros; the fake adds 30–80 ms latency so progress is visible). `preview/main.jsx` renders `StudioApp` or `ActionApp` (by `?entry=`) exactly like the real entries. Run `npx vite --mode preview` and open `http://localhost:5173/?locale=ru-RU&theme=dark` — the page renders (content fills in later tasks).
- [ ] **Step 6: Commit** `EXPORT-11: Add the icon, illustrations, shared visual components and preview harness`.

### Task 12: Export studio (space page) — choose scope, format, mode

**Files:**
- Create: `static/app/src/studio/StudioApp.jsx` (replace placeholder), `static/app/src/studio/ScopeStep.jsx`, `static/app/src/studio/FormatStep.jsx`, `static/app/src/studio/ModeStep.jsx`, `static/app/src/studio/OutputPreview.jsx`, `static/app/src/studio/PagePicker.jsx`, `static/app/src/studio/useAccess.js`, `static/app/src/studio/useExportForm.js`
- Modify: all 26 `static/app/src/i18n/locales/*.json`
- Test: `static/app/test/studio.test.jsx`

**Interfaces:**
- Consumes: `call('getAccess')`, `createConfluenceClient` (for the page picker and the preview), `planPaths`, `presetFiles`, `DEFAULT_OPTIONS`, `readManifestFromFile`, `parseManifest`, `sameSource`, `sameOptions`, `ChoiceCard`, `StepSection`, `FileTree`, `PageLayout`, `AppHeader`.
- Produces: `useExportForm()` → `{ target, setTarget, options, setOption(key, value), previous: { fileName, manifest, error } | null, setPreviousFile(file), mode: 'full'|'update', fullReason }`; `StudioApp({ context })` switches between `form | running | result | error` views (running/result come in Task 13 — here the Export button calls `onStart(form)` which Task 13 wires).

Layout (wireframe, left = main 7/12, right = aside 5/12, sticky):

```
[icon] ArtUp Export  [ENG · Engineering]                         (?) Help
Git-ready Markdown from Confluence

① What to export                                ┌ Output preview ─────────────┐
  [◉ Whole space  ][○ Page and children][○ One page]  │ engineering/                  │
  (Page picker: async search, shows breadcrumbs)       │ ├─ index.md                   │
                                                       │ ├─ getting-started.md         │
② Format                                               │ └─ api/                       │
  [Generic][Hugo][Docusaurus][MkDocs]  (cards)         │    ├─ _index.md               │
  Order: (•) front-matter  ( ) numeric prefixes        │    └─ auth.md                 │
  File names: (•) ASCII  ( ) Unicode                   │ … +37 more                    │
  Attachments: [All ▾]  Max size [50] MB               ├───────────────────────────────┤
                                                       │ Front-matter sample (code)    │
③ Mode                                                 └───────────────────────────────┘
  [◉ Full export] [○ Update previous export]
  (drop zone: "Drop the previous zip or export-manifest.json")
  ✓ Previous export: 342 pages · same space · same options

                                         [ Export 1 024 pages ▶ ] (primary, large)
```

Behaviour:
- On mount: `getAccess`; unlicensed → full-page empty state (`LockIllustration`, `unlicensed.title/body`), nothing else rendered.
- Target default: whole space of `context.extension.space.key`.
- Preview: after target changes, scan titles lazily (space: roots + first two levels only; branch: the page + first two levels) through the client with a 300 ms debounce, show `Skeleton` rows while loading, then `FileTree` of `planPaths` + `presetFiles` paths; the count shown on the Export button comes from a cheap total (CQL `type=page AND space="KEY"` `totalSize`, or `ancestor=<id>` for a branch + 1) — add `countPages(spaceKey, ancestorId?)` to the client in this task with a test.
- Front-matter sample under the tree: `renderFrontMatter` of the first page with the current preset (monospace, sunken surface).
- Drop zone: native `<input type="file" accept=".zip,.json">` visually hidden inside a dashed-border `Box` (`color.border` dashed, `border.radius.200`, hover `color.background.neutral.subtle.hovered`); drag-over state highlights with `color.border.selected`. After reading: `SectionMessage` success ("Previous export: {count} pages") or warning for `other-source` / `options-changed` ("A full export will be made because …") or error (`not-json`, `not-manifest`, `newer-version`, `no-manifest-in-zip`).
- Export button disabled while no target page is chosen for branch/page modes; label `studio.exportButton` plural by page count.
- Keyboard: all cards reachable by Tab; visible focus ring (`color.border.focused`).

Strings (keys in `en-US.json`, all 26 locales in the same commit): `studio.subtitle`, `studio.help`, `step.scope.title`, `step.scope.description`, `scope.space.title`, `scope.space.description`, `scope.branch.title`, `scope.branch.description`, `scope.page.title`, `scope.page.description`, `picker.placeholder`, `picker.noResults`, `step.format.title`, `step.format.description`, `preset.generic.title`, `preset.generic.description`, `preset.hugo.description`, `preset.docusaurus.description`, `preset.mkdocs.description`, `order.label`, `order.weight`, `order.prefix`, `fileNames.label`, `fileNames.ascii`, `fileNames.unicode`, `fileNames.help`, `attachments.label`, `attachments.all`, `attachments.referenced`, `attachments.none`, `attachments.maxSize`, `step.mode.title`, `step.mode.description`, `mode.full.title`, `mode.full.description`, `mode.update.title`, `mode.update.description`, `drop.title`, `drop.hint`, `drop.loaded` (plural `{count}`), `drop.error.not-json`, `drop.error.not-manifest`, `drop.error.newer-version`, `drop.error.no-manifest-in-zip`, `drop.full.other-source`, `drop.full.options-changed`, `preview.title`, `preview.more` (plural), `preview.frontMatter`, `preview.loading`, `studio.exportButton` (plural `{count}`), `studio.exportButtonUnknown`.

- [ ] **Step 1: Failing tests** `studio.test.jsx` (mock `@forge/bridge`: `invoke`, `view`, `requestConfluence` backed by `fakeConfluence`):
  1. Unlicensed → shows `unlicensed.title` text and no Export button.
  2. Default: "Whole space" card `aria-checked=true`, preview lists `engineering/index.md`… after loading, Export button text `Export 3 pages`.
  3. Choosing Hugo changes a preview row to `_index.md` and the front-matter sample contains `weight:`; Docusaurus → `sidebar_position:` and `_category_.json` row.
  4. Choosing "Page and children" disables Export until a page is picked in the picker (type "Caf", option `Café` appears, select it).
  5. Dropping a manifest JSON of the same source/options shows `Previous export: 3 pages` and selects Update mode; a manifest with another preset shows the `options-changed` warning.
  6. Rendering with `ru-RU` shows Russian labels (e.g. `step.scope.title` Russian value) and the plural button text for 3 pages.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm --prefix static/app test` all green (guards: no literal JSX text, no colours).
- [ ] **Step 5: Look at it.** `npx vite --mode preview`, open light/dark × en-US/ru-RU/ja-JP/de-DE at 1280 and 800 px; fix spacing/overflow before committing. (Automated screenshots come in Task 15; this step is the author's own check.)
- [ ] **Step 6: Commit** `EXPORT-12: Build the export studio form with live output preview`.

### Task 13: Progress, result and warnings views; download

**Files:**
- Create: `static/app/src/studio/RunningView.jsx`, `static/app/src/studio/ResultView.jsx`, `static/app/src/studio/WarningsTable.jsx`, `static/app/src/studio/useExportRun.js`
- Modify: `static/app/src/studio/StudioApp.jsx`, 26 locale files
- Test: `static/app/test/run.test.jsx`

**Interfaces:**
- Consumes: `runExport`, `createConfluenceClient`, `saveBlob`, `requestConfluence`, `StatTile`, illustrations.
- Produces: `useExportRun({ context })` → `{ state: 'idle'|'running'|'done'|'failed'|'cancelled', progress, result, error, start(form), cancel(), reset(), downloadAgain() }`.

Running view:
- `ProgressTracker` with four stages (Scan, Pages, Attachments, Pack) — current stage `current`, finished `visited`.
- Big percentage (`font.heading.xlarge`) + `ProgressBar` (indeterminate during scan) + counter line "342 of 1 024 pages" (plural) + elapsed time and ETA once ≥ 5% done (`formatDuration`).
- `SectionMessage appearance="information"`: "Keep this tab open until the download starts."
- Subtle "Cancel" button → confirmation not needed; cancel returns to the form with the choices kept and a flag "Export cancelled".
- `beforeunload` listener while running (browser-native prompt).

Result view:
- `SuccessIllustration` + heading "Export ready" + file name in monospace + "The download has started." + primary "Download again" + secondary "New export".
- Stat tiles row (wraps): full → Pages, Attachments, Size, Time; update → Changed (added + changed + moved), Unchanged, Deleted (`deletePaths.length`, tone warning when > 0), Size.
- When `fullReason` is set: `SectionMessage appearance="warning"` explaining why a full export was made.
- When `missing > 0`: `SectionMessage appearance="warning"`: "{count} pages from the previous export were not found — they were deleted or you can't see them. Their files are listed in export-deleted.txt." (no titles shown).
- "Apply this update" collapsible help (update mode): 3 steps with a copyable command block `unzip -o <file> -d docs && (cd docs && [ -f export-deleted.txt ] && xargs -d '\n' rm -f < export-deleted.txt; rm -f export-deleted.txt)` (command text is not translated; the surrounding sentences are).
- Warnings: `DynamicTable` (page title as link to the Confluence page via `router.open`, kind as `Lozenge` with translated label, detail monospace), filter `Select` by kind, sorted by page title; empty → small "No warnings" line with a check icon.

Failure view: `EmptyIllustration`, translated error (`ConfluenceError` 403 → `errors.forbidden`, network → `errors.network`, else `errors.generic`), "Try again" primary, "Back" secondary.

Strings: `run.stage.scan`, `run.stage.pages`, `run.stage.attachments`, `run.stage.pack`, `run.counter` (plural), `run.elapsed`, `run.eta`, `run.keepOpen`, `run.cancel`, `run.cancelled`, `result.title`, `result.started`, `result.downloadAgain`, `result.newExport`, `result.pages`, `result.attachments`, `result.size`, `result.time`, `result.changed`, `result.unchanged`, `result.deleted`, `result.full.options-changed`, `result.full.other-source`, `result.missing` (plural), `result.apply.title`, `result.apply.step1`, `result.apply.step2`, `result.apply.step3`, `warnings.title` (plural), `warnings.none`, `warnings.filter.all`, `warnings.kind.unknown-macro`, `warnings.kind.dynamic-macro`, `warnings.kind.complex-table`, `warnings.kind.missing-attachment`, `warnings.kind.adf-extension`, `warnings.kind.unresolved-user`, `warnings.kind.attachment-too-large`, `warnings.column.page`, `warnings.column.kind`, `warnings.column.detail`, `errors.forbidden`, `errors.network`, `errors.tryAgain`, `errors.back`.

Add to `test/i18n.test.js`: every warning kind emitted by the converter/pipeline (import the list exported from `core/convert/index.js` as `WARNING_KINDS` plus `'attachment-too-large'`) has a `warnings.kind.<kind>` key.

- [ ] **Step 1: Failing tests** `run.test.jsx`: start with the fake → running view shows stage labels and a counter; on completion → result view with tiles and `saveBlob` called once with `artup-export-ENG-2026-…zip`; "Download again" calls `saveBlob` again with the same blob; cancel mid-run → back to form with `run.cancelled`; 403 from the fake → failure view with `errors.forbidden`; update result with deletions shows the warning tile tone and the apply help; warnings table filters by kind.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Look at it** in the preview harness (states `?state=running|done|done-update|failed`), light/dark, ru-RU/de-DE/ja-JP.
- [ ] **Step 6: Commit** `EXPORT-13: Show export progress, results, warnings and download`.

### Task 14: Content action modal (export this page / branch)

**Files:**
- Create: `static/app/src/action/ActionApp.jsx` (replace placeholder), `static/app/src/action/ActionForm.jsx`
- Modify: 26 locale files
- Test: `static/app/test/action.test.jsx`

**Interfaces:**
- Consumes: `useExportForm`, `useExportRun`, `RunningView`, `ResultView`, `ChoiceCard`, `FileTree`, `view.close()` from `@forge/bridge`.

Design: modal content (Forge provides the frame, `viewportSize: large`): header "Export «{title}»" (title truncated with tooltip at 60 chars), two `ChoiceCard`s side by side — "This page" / "This page and {count} subpages" (count via `countPages`, skeleton while loading); preset as a compact segmented row of 4 small cards; "More options" collapsible with ordering, file names, attachments; mini file tree (limit 8); footer: secondary "Cancel" (`view.close()`), primary "Export". Running/result reuse Task 13 views in compact density (tiles 2×2). Target is `{ kind: 'page'|'branch', spaceKey, pageId: context.extension.content.id }`; update mode is available under "More options" (same drop zone).

Strings: `action.title`, `action.thisPage`, `action.withChildren` (plural `{count}`), `action.moreOptions`, `action.close`.

- [ ] **Step 1: Failing tests**: renders the page title from context; "This page and 2 subpages" after count loads; Export runs a branch export (fake) and shows the result; Cancel calls `view.close`.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `EXPORT-14: Add the page action modal for page and branch exports`.

### Task 15: Screenshot matrix, overflow probe, translation quality pass

**Files:**
- Create: `static/app/scripts/screenshots.mjs`, `static/app/scripts/contact-sheet.mjs`
- Modify: locale files where the probe or review finds problems
- Test: the probe itself fails the run on overflow

**Interfaces:**
- Consumes: preview harness (Task 11) with `?entry=&state=&locale=&theme=&width=`.

- [ ] **Step 1: Script.** `screenshots.mjs` starts `vite --mode preview` on a free port, launches Playwright Chromium and:
  1. Matrix A (visual review): entries × states `studio:form, studio:form-update, studio:running, studio:done, studio:done-update, studio:failed, studio:unlicensed, action:form, action:done` × themes `light, dark` × locales `en-US, de-DE, ru-RU, ja-JP, fi-FI, zh-CN` × widths `1280, 800` → `static/app/screenshots/<entry>-<state>-<theme>-<locale>-<width>.png`.
  2. Probe B (all 26 locales, both themes, widths 1280 and 800, states form/running/done): in the page evaluate every `button, [role=tab], [role=radio], label, h1, h2, h3, [data-testid]` — collect elements with `scrollWidth > clientWidth + 1` whose computed `text-overflow` is not `ellipsis`, plus any horizontal scroll on `document.documentElement`. Any hit → print `locale state width selector text` and exit 1.
  3. Probe C: any visible text equal to a translation key pattern (`/^[a-z]+(\.[a-z-]+)+$/`) → exit 1 (raw key leaked).
  4. `contact-sheet.mjs` writes `static/app/screenshots/index.html` — a grid of Matrix A thumbnails grouped by state, for the owner.
- [ ] **Step 2: Run** `npm run screenshots`. Fix every overflow (shorter translation or layout wrap — prefer wrap) and rerun until exit 0.
- [ ] **Step 3: Review the images** yourself (Read the PNGs): alignment, spacing rhythm, dark-theme contrast, truncation, empty-state balance, focus ring visibility. Fix and rerun. Record remaining conscious compromises as Rulings.
- [ ] **Step 4: Translation pass.** For each locale file: terminology consistency (the same word for "export", "page", "attachment", "space" everywhere, matching Confluence's own UI term in that language), formality consistent with Confluence (e.g. de-DE "Sie", fr-FR "vous", ru-RU without "вы"-forms in buttons), plural forms read naturally. List the locales needing a native check: ja-JP, ko-KR, zh-CN, zh-TW, is-IS, et-EE, fi-FI, cs-CZ, sk-SK, hu-HU, ro-RO, tr-TR, pt-PT (same list as Trace).
- [ ] **Step 5: Commit** `EXPORT-15: Add the screenshot matrix and fix layout and translation issues`.

### Task 16: Deploy to development, acceptance on 1 000 pages, zero-diff check

**Files:**
- Create: `scripts/verify-zero-diff.mjs`, `README.md` (usage, data handling, "Load check" section with measured numbers)
- Modify: `atlassian/20_app2_markdown_export.md` (acceptance numbers), rulings file

- [ ] **Step 1: `verify-zero-diff.mjs`** — `node scripts/verify-zero-diff.mjs first.zip second.zip [update.zip]`: unzips (fflate from `static/app/node_modules`) into temp dirs, compares file sets and bytes; prints `IDENTICAL` or the list of differing paths and exits 1; with a third argument applies the update (write files, delete paths from `export-deleted.txt`) over the first tree and compares to a fresh full export given as fourth argument.
- [ ] **Step 2: Deploy**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
npm test && npm run test:ui && npm run lint && npm run build:ui
forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install --upgrade --site artuplabs-dev.atlassian.net --product confluence -e development --non-interactive
forge eligibility -e development --non-interactive
```

- [ ] **Step 3: Measured acceptance** (brief §10) on EXPT (1 000 pages, 200 attachments), done by the owner in the browser with the agent reading `forge logs` and the zips (downloaded to `~/Downloads`):
  1. Full export → time, zip size, number of `.md` files = pages, attachments count, warnings count by kind.
  2. Immediately repeat → `verify-zero-diff.mjs` → `IDENTICAL`.
  3. Edit 3 pages, rename 1, move 1, delete 1 on dev; update export with the first zip dropped in → zip contains only the expected pages; apply + compare with a fresh full export → `IDENTICAL`.
  4. Open 20 random `.md` files in a Markdown viewer (VS Code preview) — tables, panels, code, images render.
  5. Import the full zip into a throwaway Docusaurus/MkDocs/Hugo project per preset (`npx create-docusaurus`, `pip install mkdocs mkdocs-awesome-pages-plugin`, `hugo new site`) — sidebar order equals the Confluence tree for the top two levels. Record results.
  6. The page action on a branch of 50 pages, in Russian UI, dark theme.
- [ ] **Step 4: Owner manual list** — generate `atlassian/plans/2026-09-28-artup-export-acceptance.md`: 15 checks (each with where to click and what to expect), including language switch (profile → Language), theme switch, unlicensed state can't be tested before listing (note it).
- [ ] **Step 5: Record** numbers in README "Load check" and brief §11/§10; commit `EXPORT-16: Record the 1 000-page acceptance and zero-diff check`.
- [ ] **Step 6: Stop.** Final whole-branch review (strongest model) → fixes → owner acceptance → only then `forge deploy -e production` (owner's word).

### Task 17: Listing drafts and product page on artuplabs.com

**Files:**
- Create: `atlassian/listing-export/{README.md,description.md,highlights.md,pricing.md,privacy-security.md}`, `atlassian/listing-export/screenshots/draft/*.png` (from Task 15, 1840×900 frames at en-US light + one dark), `site/export/index.html`, `site/docs/export/index.html`
- Modify: `site/index.html` (second product card), `STATE.md` (section «ArtUp Export»), `/Users/artyomkarpets/IncomeApps/PROJECTS.md` (project row)

- [ ] **Step 1: Listing texts** following `atlassian/listing/` structure: name candidates (e.g. "ArtUp Export – Markdown for Git & Docs Sites") with the rule "Git only descriptive"; tagline; 3 highlights (full-depth tree in Confluence order; stable paths + front-matter for Hugo/Docusaurus/MkDocs; incremental updates with a manifest); description; pricing per brief §2 ($150–175 at 200 users, free ≤10, tiered like Trace's `pricing.md`); Privacy & Security answers: no data stored by the app, no egress, content processed in the user's browser, Runs on Atlassian.
- [ ] **Step 2: Site pages** in the style of the existing `site/` (same CSS, light/dark): product page with hero screenshot, 3 feature blocks, preset logos as text badges, pricing link to the listing; docs page: install, export a space, update an existing repo (the apply command), front-matter reference, presets, limits, warnings reference, data handling. Deploy only after the owner approves (`npx wrangler pages deploy … --project-name artuplabs --branch main`).
- [ ] **Step 3: Update** `STATE.md` and `PROJECTS.md`; commit in DistributB2B: `Add ArtUp Export listing drafts and site pages`. Submission is **owner only**.

---

## Execution order and checkpoints

| Checkpoint | After | Owner action |
|---|---|---|
| C0 | Task 0.2 | read gate report; any "close" → stop |
| C1 | Task 12 | look at studio screenshots (contact sheet) — early visual feedback before the rest is built |
| C2 | Task 16 | manual acceptance list; approve production deploy |
| C3 | Task 17 | approve site deploy; submit listing |

Tasks 3, 4, 5, 7, 8 are independent pure modules with full code above → may be dispatched as one batch (one implementer, one commit per task, one review). Task 6 (converter) is the largest and most error-prone → its own implementer and reviewer. Tasks 11–14 are visual → each ends with the author looking at the preview harness, Task 15 makes it systematic.
