# ArtUp Reports v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Forge app for Jira Cloud that exports issues — from search, a board, the backlog, a sprint, one issue or its own page — to a formatted .xlsx, a .docx (built-in layouts or the customer's own Word template with `{{placeholders}}`) and a PDF, assembled in the user's browser, in all 26 Jira languages, light and dark.

**Architecture:** Browser assembly, as in ArtUp Export. The Custom UI reads Jira through `requestJira` (`@forge/bridge`) as the user: ids in pages of 5 000 → `POST /rest/api/3/issue/bulkfetch` in batches of 100, 6 in parallel → images 12 in parallel. Pure core functions turn issues into a neutral document model; renderers turn the model into files with exceljs, docx, pdfmake and docxtemplater, each loaded on demand. The only backend is a resolver for the licence and for template storage (Forge KVS, permissions checked with `asUser()`); issue content is never stored.

**Tech Stack:** Forge (Custom UI; `jira:issueNavigatorAction`, `jira:boardAction`, `jira:backlogAction`, `jira:sprintAction`, `jira:issueAction`, `jira:globalPage`; resolver on nodejs24.x; `@forge/kvs`), React 18, Vite, Atlaskit + `@atlaskit/tokens`, `@atlaskit/pragmatic-drag-and-drop`, exceljs 4.4.0, docx 9.8.1, pdfmake 0.3.11, docxtemplater 3.71.0 + pizzip 3.3.0, Noto Sans / Noto Sans SC / Noto Sans KR (static, OFL), Vitest + @testing-library/react + jsdom, Playwright (dev-only).

**Spec:** [2026-09-29-artup-reports-design.md](2026-09-29-artup-reports-design.md) (binding) + brief [../22_app3_jira_reports.md](../22_app3_jira_reports.md) §4 (acceptance bar) and §11 (phase-0 measurements) + rulings [2026-09-29-artup-reports-v1-rulings.md](2026-09-29-artup-reports-v1-rulings.md). Reference implementation of every pattern: `apps/export` (same repository).

---

## Для владельца: что решено в плане без вас

Все решения — в журнале rulings (R1–R14, R-X5). Три, которые меняют спецификацию:

| # | Решение | Почему |
|---|---|---|
| R9 | условие в своём .docx — `{{#assignee}}…{{/assignee}}`, не `{{#if}}` | docxtemplater требует совпадения закрывающего тега |
| R10 | `{{@body}}` в цикле комментариев; списки в своём шаблоне — абзацы с маркером | нумерация Word = правка частей чужого шаблона |
| R11 | части шаблона 150 КБ (≈ 200 КБ base64), до 14 | значение KVS ≤ 240 КБ |

Модели исполнителей (R14): у каждой задачи строка **Model**.

---

## Global Constraints

- Only Forge; zero Connect modules; **zero egress** — no `permissions.external`, no remote fonts/CDN/images; `forge eligibility -e development --non-interactive` must print eligible for Runs on Atlassian after every deploy.
- Read-only product access. Scopes are declared in full in v1; the list is fixed by Task 3 and expected to be `read:jira-work`, `read:jira-user`, `read:board-scope:jira-software`, `read:sprint:jira-software`, `storage:app` (plus whatever Task 3 proves the board-configuration call needs). Never add `write:*`.
- `permissions.content.styles: ['unsafe-inline']` (Atlaskit), as in Export.
- **No issue content persisted anywhere.** Forge KVS holds template metadata and template .docx files only (`tpl:{scope}:{scopeId}:{id}`, `tplid:{id}`, `tplbin:{id}:{n}`).
- Custom UI: React 18 + Atlaskit components + `@atlaskit/primitives` (`Box`, `Stack`, `Inline`, `Grid`, `xcss`) + design tokens only. **No hex/rgb/hsl/named colours** in `static/app/src`, except `static/app/src/render/palette.js` (document colours inside generated files; the guard test exempts exactly that file).
- Every user-visible string goes through `t('key')`; `static/app/src/i18n/locales/en-US.json` is the key source; **all 26 locale files are complete and in sync in the same commit that introduces a key** (tests enforce key parity, placeholder parity and plural categories). Locales: zh-CN, zh-TW, cs-CZ, da-DK, nl-NL, en-US, en-GB, et-EE, fi-FI, fr-FR, de-DE, hu-HU, is-IS, it-IT, ja-JP, ko-KR, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, tr-TR, es-ES, sv-SE.
- Numbers, dates and durations in the UI via `Intl` with the resolved locale; plurals via `Intl.PluralRules`.
- Issue content in files (summaries, descriptions, field values, Jira field names) is **not** translated. Headings that ArtUp Reports itself writes into a file (built-in layouts, the summary sheet, column headers of pseudo-columns) follow the user's UI locale.
- Visual standard (every UI task; checked by screenshots in Task 21): full width with `space.300` side padding; sections separated by `space.400`; cards `elevation.surface.raised` + `radius.large`; one primary button per view; headings via `@atlaskit/heading`; body 14px; long strings wrap, never overflow; below 900px two columns become one; loading states are skeletons or spinners in place, never blank; every empty/error state has an illustration + one sentence + one action.
- Layering: `static/app/src/core/**` is pure — no I/O, no `Date.now()`/argument-less `new Date()`, no randomness. `static/app/src/render/**` turns models into bytes with the injected library and does no network. I/O lives in `static/app/src/infra/**`; orchestration in `static/app/src/export/**`; components stay thin.
- Libraries, exact versions: exceljs 4.4.0 (with `overrides` closing the `uuid` advisory), docx 9.8.1, pdfmake 0.3.11, docxtemplater 3.71.0, pizzip 3.3.0. Each renderer library is loaded with a dynamic `import()` only when its format is chosen.
- Limits live in `static/app/src/core/limits.js` and nowhere else: id page 5 000, bulk batch 100, issue concurrency 6, media concurrency 12, Word/PDF maximum 2 000 issues, Excel cell 32 767 characters, template 2 MB, template part 150 KB, preview 5 issues, 6 attempts per request.
- Code style as in Export: vanilla JS/JSX, ES modules, **no `//` comments inside function bodies** (a guard test enforces it), JSDoc 1–2 lines on exported functions/components, never mention a task, plan, spec or ruling in code or comments.
- Tests: Vitest; one behaviour per `it`, the name states the behaviour; compare whole values with `toEqual`, not field by field.
- Commits: `REPORTS-<n>: <Description>` + blank line + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Work on the local branch `reports-v1`; never push, never open a PR, never merge to main.
- Secrets: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a` before forge or REST commands; never print tokens.
- `forge install --upgrade` may hang after success: run it as `perl -e 'alarm 300; exec @ARGV' forge install ...`.
- Decisions taken without the owner go to `atlassian/plans/2026-09-29-artup-reports-v1-rulings.md` as `Ruling Rn: <decision> — <why> — cost if wrong: <…>` (continue from R15) and are listed at the end of the session.

## Review Focus

1. **Two Jira fields with the same name, or a saved Excel template whose field was deleted from the site** ("Story Points" twice; `customfield_10099` gone) → the lower-id field wins deterministically; a missing column is dropped with a warning row in the result, never a crash or an empty file. Tests: Task 5 `resolveField` duplicate case; Task 8 missing-column case.
2. **A Word template where Word split a placeholder across runs, placeholders in headers, footers and table cells, and a rich tag `{{@description}}` sharing its paragraph with other text** → rendered correctly, or rejected at upload with a named error; never a corrupt .docx. Tests: Task 14.
3. **Issues that disappear or become invisible between the id search and bulkfetch** (`issueErrors`), plus batches that fail after all retries → counted separately: skipped issues are reported as "N of M", failed batches make the run incomplete and never produce a file silently. Tests: Task 15.
4. **Group names and file names with characters Excel or filesystems forbid, longer than 31 characters, or colliding after cleaning** ("A/B" and "A-B", "History") → unique valid sheet names and a valid file name. Tests: Task 4, Task 8.
5. **One line mixing Latin, Cyrillic, CJK, Hangul and emoji in a PDF** → each supported script in its own font, no tofu; emoji dropped and counted, not rendered as boxes. Tests: Task 4 `splitRuns`, Task 13 definition case.

---

## File Structure (`apps/reports`)

```
apps/reports/
  manifest.yml                     six modules, resolver, 26 translated module titles
  package.json, .eslintrc, .gitignore, AGENTS.md, README.md
  locales/<26>.json                module titles only
  src/index.js                     resolver entry
  src/access.js                    licence decision (copy of Export)
  src/resolvers.js                 getAccess + template resolvers
  src/templates/validate.js        template metadata validation
  src/templates/permissions.js     view/manage decisions from mypermissions
  src/templates/store.js           KVS layout: meta, id index, file parts
  test/*.test.js                   resolver, access, store, permissions, manifest locales
  scripts/live-checks.mjs          Task 3: scopes/contexts/limits notes, media fixtures from RPT
  scripts/acceptance.mjs           Task 22: real pipeline in Node against artuplabs-dev
  scripts/synthetic.mjs            Task 22: 50 000-issue workbook without network
  scripts/template-matrix.mjs      Task 22: 8 built-ins × A4/Letter × 3 scripts
  docs/live-checks.md              Task 3 findings
  static/app/
    package.json, vite.config.js
    global-page/index.html, action/index.html, preview/…
    fonts/NotoSans-{Regular,Bold}.ttf, NotoSansSC-{Regular,Bold}.otf, NotoSansKR-{Regular,Bold}.otf, OFL.txt
    src/core/limits.js             all numeric limits
    src/core/textRuns.js           script runs for PDF fonts
    src/core/filename.js           file-name pattern
    src/core/imageSize.js          PNG/JPEG/GIF size, fit to width
    src/core/fields.js             field catalog, typed cell values
    src/core/adf.js                ADF → document model, model → text, truncation
    src/core/tableGrid.js          merged cells → rectangular grid
    src/core/media.js              ADF media → attachment id
    src/core/entry.js              module context → entry → JQL
    src/core/placeholders.js       tag vocabulary, template tag validation, suggestions
    src/core/columns.js            column references → fields / pseudo-columns
    src/core/builtins.js           8 built-in templates
    src/core/fetchPlan.js          template → fields/expand/extra reads
    src/core/rows.js               Excel rows, groups, sheet names, summary
    src/core/prepare.js            issue JSON → prepared issue (texts + blocks)
    src/core/layouts.js            4 Word/PDF layouts → document spec
    src/core/templateData.js       prepared issues → docxtemplater data
    src/render/palette.js          document colours (hex allowed here only)
    src/render/xlsx.js             sheets → .xlsx bytes
    src/render/docx.js             document spec → .docx bytes
    src/render/pdf.js              document spec → pdfmake definition; bytes via engine
    src/render/ooxml.js            model → raw OOXML for rich tags
    src/render/docxTemplate.js     customer .docx + data → .docx bytes
    src/infra/pool.js, bridge.js, download.js (copies/adaptations of Export)
    src/infra/jira.js              Jira REST client: search, bulkfetch, comments, worklogs, attachments
    src/infra/fonts.js             lazy font loading
    src/infra/pdfEngine.js         pdfmake browser engine
    src/infra/templateInspect.js   docxtemplater inspection of an uploaded .docx
    src/export/errors.js           ReportError codes
    src/export/renderers.js        dynamic imports per format
    src/export/pipeline.js         createExportRun: read → images → build, retry, partial
    src/api.js, theme.js, i18n/…   copies of Export
    src/components/…               shared visual components (from Export) + new ones
    src/wizard/…                   export wizard
    src/templates/…                templates tab
    src/app/GlobalApp.jsx, src/app/ActionApp.jsx, main files
    test/…                         mirrors src/
```

---

### Task 1: Forge app, manifest with six modules, licence resolver, CI

**Model:** sonnet

**Files:**
- Create: `apps/reports/{manifest.yml,package.json,.eslintrc,.gitignore,AGENTS.md,README.md}`, `apps/reports/locales/*.json` (26), `apps/reports/src/{index.js,access.js,resolvers.js}`, `apps/reports/vitest.config.mjs`
- Modify: `.github/workflows/ci.yml` (add a "Reports" block identical to the "Export" block with `apps/reports` paths, and both lock files to `cache-dependency-path`)
- Test: `apps/reports/test/{access.test.js,resolvers.test.js,manifestLocales.test.js}`

**Interfaces:**
- Produces: resolver key `getAccess` → `{ licensed: boolean, environmentType: string }`; `decideLicence({ environmentType, license })` in `src/access.js`.

- [ ] **Step 1: Create and register the app.** From the repo root:

```bash
test ! -e apps/reports && mkdir -p apps/reports && cd apps/reports
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cp ../export/{.eslintrc,vitest.config.mjs,AGENTS.md} .
forge register --accept-terms "ArtUp Reports"
```

If `forge register` needs an existing `manifest.yml`, write the manifest of Step 5 first with `id: placeholder` and rerun; it rewrites `app.id`. Choose Developer Space "ArtUp Labs" if asked. In `AGENTS.md` replace "Confluence" with "Jira" and `confluence-global-page-ui-kit` advice with `jira-global-page-ui-kit`.

- [ ] **Step 2: Write the failing tests.** `test/access.test.js` — copy `apps/export/test/access.test.js` unchanged (same `decideLicence` contract). `test/resolvers.test.js` — copy `apps/export/test/resolvers.test.js` (it mocks `@forge/resolver` and asserts `getAccess` returns `{ licensed: false, environmentType: 'PRODUCTION' }` for production without a licence and `{ licensed: true, environmentType: 'DEVELOPMENT' }` otherwise). `test/manifestLocales.test.js` — copy from Export and change the expected key set to:

```js
const KEYS = [
  'module.globalPage.title',
  'module.issueNavigatorAction.title',
  'module.boardAction.title',
  'module.backlogAction.title',
  'module.sprintAction.title',
  'module.issueAction.title',
];
```

asserting every `locales/*.json` has exactly these keys with non-empty strings and `manifest.yml` lists all 26 locales under `translations`.

- [ ] **Step 3: Run** `npx vitest run` → FAIL (modules not found).

- [ ] **Step 4: Implement** `src/access.js`, `src/resolvers.js`, `src/index.js` as exact copies of `apps/export/src/{access.js,resolvers.js,index.js}`.

- [ ] **Step 5: Manifest** `manifest.yml`:

```yaml
modules:
  jira:globalPage:
    - key: reports-global-page
      resource: global-page
      resolver:
        function: resolver
      title:
        i18n: module.globalPage.title
      icon: resource:icons;icon.svg
      layout: basic
  jira:issueNavigatorAction:
    - key: reports-navigator-action
      resource: action
      resolver:
        function: resolver
      title:
        i18n: module.issueNavigatorAction.title
  jira:boardAction:
    - key: reports-board-action
      resource: action
      resolver:
        function: resolver
      title:
        i18n: module.boardAction.title
  jira:backlogAction:
    - key: reports-backlog-action
      resource: action
      resolver:
        function: resolver
      title:
        i18n: module.backlogAction.title
  jira:sprintAction:
    - key: reports-sprint-action
      resource: action
      resolver:
        function: resolver
      title:
        i18n: module.sprintAction.title
  jira:issueAction:
    - key: reports-issue-action
      resource: action
      resolver:
        function: resolver
      title:
        i18n: module.issueAction.title
  function:
    - key: resolver
      handler: index.resolverHandler
resources:
  - key: global-page
    path: static/app/dist/global-page
  - key: action
    path: static/app/dist/action
  - key: icons
    path: resources
translations:
  resources:
    - key: zh-CN
      path: locales/zh-CN.json
```

List all 26 locales explicitly in the order of Global Constraints (no comments in the committed file), then:

```yaml
  fallback:
    default: en-US
permissions:
  scopes:
    - read:jira-work
    - read:jira-user
    - read:board-scope:jira-software
    - read:sprint:jira-software
    - storage:app
  content:
    styles:
      - 'unsafe-inline'
app:
  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64
  id: <written by forge register>
  licensing:
    enabled: true
```

Copy `apps/export/resources/icon.svg` to `resources/icon.svg` (it is recoloured in Task 17). `locales/en-US.json`:

```json
{
  "module.globalPage.title": "ArtUp Reports",
  "module.issueNavigatorAction.title": "Export to Excel, Word or PDF",
  "module.boardAction.title": "Export board issues",
  "module.backlogAction.title": "Export backlog issues",
  "module.sprintAction.title": "Export sprint issues",
  "module.issueAction.title": "Export to Word or PDF"
}
```

The other 25 files carry real translations of the same six keys ("ArtUp Reports" stays untranslated); e.g. ru-RU: «Экспорт в Excel, Word или PDF», «Экспорт задач доски», «Экспорт задач бэклога», «Экспорт задач спринта», «Экспорт в Word или PDF».

- [ ] **Step 6: `package.json`** — copy `apps/export/package.json`, set `"name": "artuplabs-reports"`, add `"@forge/api"` and `"@forge/kvs"` at the current versions (`npm view @forge/api version`, `npm view @forge/kvs version`, pinned exactly) to `dependencies`, keep `@forge/resolver` 2.0.0. `.gitignore`: `node_modules/`, `static/app/dist/`, `static/app/screenshots/`, `data/`, `.env`. Run `npm install`.

- [ ] **Step 7: Run** `npx vitest run` → PASS; `forge lint` → no errors (if a scope name is rejected, fix it here and record a Ruling).

- [ ] **Step 8: CI.** Append to `.github/workflows/ci.yml` the steps "Reports: install / lint / test / UI test / UI build / audit" copied from the Export block with `working-directory: apps/reports`; add `apps/reports/package-lock.json` and `apps/reports/static/app/package-lock.json` to `cache-dependency-path`. The UI steps start passing after Task 2; commit them now anyway only if Task 2 lands in the same session before any push (pushing is the owner's) — otherwise add them in Task 2.

- [ ] **Step 9: Commit**

```bash
git add apps/reports .github/workflows/ci.yml
git commit -m "REPORTS-2: Scaffold the Forge app with six entry modules and the licence resolver

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Custom UI shell, theme, i18n, guard tests, first deploy

**Model:** sonnet

**Files:**
- Create: `apps/reports/static/app/{package.json,vite.config.js}`, `static/app/global-page/index.html`, `static/app/action/index.html`, `static/app/src/{theme.js,api.js}`, `static/app/src/i18n/index.js`, `static/app/src/i18n/locales/*.json` (26), `static/app/src/app/{GlobalApp.jsx,ActionApp.jsx,globalMain.jsx,actionMain.jsx}`, `static/app/test/setup.js`
- Test: `static/app/test/{i18n.test.js,guards.test.js,smoke.test.jsx}`

**Interfaces:**
- Consumes: resolver `getAccess` (Task 1).
- Produces: `I18nProvider`, `useI18n()` → `{ t, locale, formatNumber, formatDate, formatDuration }`, `resolveLocale(raw)` (copies of Export's i18n); `call(key, payload)`, `AppError`, `errorMessage(t, error)` in `src/api.js`; `bootstrap()` in `src/theme.js`.

- [ ] **Step 1: Copy the shell from Export.** Copy verbatim, then adapt names:
  - `apps/export/static/app/package.json` → set `"name": "artuplabs-reports-ui"`, build script `vite build --mode global-page && vite build --mode action`, drop `fflate` and `htmlparser2`, add exact versions `exceljs@4.4.0`, `docx@9.8.1`, `pdfmake@0.3.11`, `docxtemplater@3.71.0`, `pizzip@3.3.0`, `@atlaskit/pragmatic-drag-and-drop` (current, pinned), and `"overrides": { "uuid": "^11.0.0" }` (run `npm audit --omit=dev` after install; the override must leave 0 high/critical and must not break `exceljs` — Task 11's read-back test proves it).
  - `vite.config.js` → `pageDirs = { 'global-page': 'global-page', action: 'action', preview: 'preview' }`; keep `legacy.inconsistentCjsInterop` and its JSDoc; add `assetsInclude: ['**/*.ttf', '**/*.otf']`.
  - `src/theme.js`, `src/api.js` (add `'forbidden'`, `'not-found'`, `'too-large'` to `KNOWN_CODES`), `src/i18n/index.js` — verbatim.
  - `test/setup.js`, `test/i18n.test.js` — verbatim.
  - `test/guards.test.js` — verbatim, plus the palette exemption in the colour test:

```js
  it('uses no hard-coded colours outside the document palette', () => {
    const offenders = code
      .filter((f) => !f.endsWith('/render/palette.js'))
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Shells.** `global-page/index.html` and `action/index.html` as in Export (`<div id="root">`, module script `../src/app/globalMain.jsx` / `../src/app/actionMain.jsx`). `globalMain.jsx`:

```jsx
import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { GlobalApp } from './GlobalApp.jsx';

/** Boots the global page: theme, locale, then the app. */
async function main() {
  const { context } = await bootstrap();
  createRoot(document.getElementById('root')).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <GlobalApp context={context} />
    </I18nProvider>,
  );
}

main();
```

`actionMain.jsx` is the same with `ActionApp`. `GlobalApp` and `ActionApp` for now render `@atlaskit/heading` with `t('app.title')` and, only when `context.environmentType !== 'PRODUCTION'`, a `<pre>` with `JSON.stringify(context.extension, null, 2)` inside a `SectionMessage` titled `t('dev.context')`. This development probe shows the real extension shapes of all six modules; Task 20 removes it.

- [ ] **Step 3: Locales.** `src/i18n/locales/en-US.json` starts with:

```json
{
  "app.title": "ArtUp Reports",
  "dev.context": "Module context (development only)",
  "errors.generic": "Something went wrong: {message}",
  "errors.unlicensed": "ArtUp Reports needs an active licence on this site.",
  "errors.forbidden": "You don't have permission to do that.",
  "errors.not-found": "This template no longer exists.",
  "errors.too-large": "The file is larger than 2 MB.",
  "errors.bad-request": "The request was not valid."
}
```

with full translations in the other 25 files.

- [ ] **Step 4: Smoke test** `test/smoke.test.jsx`: mock `@forge/bridge` (`view.getContext` resolves `{ locale: 'ru_RU', environmentType: 'DEVELOPMENT', extension: { type: 'jira:globalPage' } }`, `view.theme.enable` resolves), render `GlobalApp` inside `I18nProvider locale="ru-RU"` and expect the Russian title "ArtUp Reports" and the probe `<pre>` containing `jira:globalPage`; render again with `environmentType: 'PRODUCTION'` and expect no `<pre>`.

- [ ] **Step 5: Run** `npm --prefix static/app install && npm --prefix static/app test` → PASS; `npm run build:ui` → `static/app/dist/global-page/index.html` and `static/app/dist/action/index.html` exist.

- [ ] **Step 6: Deploy to development and install on the dev site.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cd apps/reports && npm run build:ui && forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
forge eligibility -e development --non-interactive
```

Expected: deploy succeeds, install succeeds (or "already installed" → `--upgrade`), eligibility says the app is eligible for Runs on Atlassian. Record the output lines (no tokens) in the commit body.

- [ ] **Step 7: Commit** (with the CI UI steps from Task 1 Step 8 if they were deferred)

```bash
git add apps/reports .github/workflows/ci.yml
git commit -m "REPORTS-3: Add the Custom UI shell with theme, 26 locales and guard tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Live checks — module contexts, scopes, storage limits, ADF media on RPT

**Model:** sonnet

This task measures and writes down; its code is a throwaway-grade script kept for reruns.

**Files:**
- Create: `apps/reports/scripts/live-checks.mjs`, `apps/reports/docs/live-checks.md`, `apps/reports/static/app/test/fixtures/adf/media-rpt.json`
- Modify: `apps/reports/manifest.yml` (scopes, only if a finding requires it), rulings file

**Interfaces:**
- Produces: `docs/live-checks.md` with four sections (Contexts, Scopes, Storage limits, Media mapping); fixture `media-rpt.json` = `{ "cases": [ { "adf": <description ADF>, "attachments": [{ "id": "…", "filename": "…", "mimeType": "…" }], "renderedHtml": "<renderedFields.description>", "expected": ["<attachment id per media node, in document order>"] } ] }` consumed by Task 6.

- [ ] **Step 1: Contexts and scopes from the documentation.** Read (WebFetch) the Forge reference pages for `jira:issueNavigatorAction`, `jira:boardAction`, `jira:backlogAction`, `jira:sprintAction`, `jira:issueAction`, `jira:globalPage` on developer.atlassian.com and the REST reference for `GET /rest/agile/1.0/board/{boardId}/configuration`, `GET /rest/agile/1.0/sprint/{sprintId}`, `POST /rest/api/3/issue/bulkfetch`, `POST /rest/api/3/search/jql`, `GET /rest/api/3/filter/search`, `GET /rest/api/3/mypermissions`. Write into `docs/live-checks.md`: for each module, the `context.extension` fields that carry the JQL / board id / sprint id / issue key (quote the doc); for each endpoint, the OAuth scopes listed. If the manifest scopes of Task 1 are not sufficient for these calls, add the missing read scopes to `manifest.yml` and record `Ruling R15`.

- [ ] **Step 2: Storage and invoke limits from the documentation.** Record the documented maximum KVS key length, value size, and the maximum `invoke` payload size of Custom UI → resolver. If the value limit is below 210 000 bytes or the payload limit below 210 000 bytes, record a Ruling lowering `TEMPLATE_PART_BYTES` so that `ceil(part * 4 / 3)` stays under both limits with 10% headroom, and note it for Task 4.

- [ ] **Step 3: Media mapping on RPT.** `scripts/live-checks.mjs media` (basic auth from `.env`, site `https://artuplabs-dev.atlassian.net`, refuses any project other than `RPT`):
  1. creates 3 issues in RPT via `POST /rest/api/3/issue` (summary `live-check media N`);
  2. uploads to each one PNG attachment (generate with the `png()` helper copied from `atlassian/tools/seed-jira-rpt.mjs`), issue 3 gets two attachments with the **same file name** `same.png`;
  3. sets the description through the v2 API with wiki markup so Jira stores real media nodes: `PUT /rest/api/2/issue/{key}` with `{"fields":{"description":"Before !diagram-N.png|thumbnail! after"}}` (issue 3: `!same.png! and !same.png!`);
  4. reads each issue back with `POST /rest/api/3/issue/bulkfetch` (`fields: ['description','attachment']`, `expand: ['renderedFields']`);
  5. writes the fixture cases; `expected` lists, per media node in document order, the attachment id that the rendered HTML (`/rest/api/3/attachment/content/<id>` or `/secure/attachment/<id>/`) shows at that position;
  6. prints, per media node, `attrs` (`id`, `alt`, `type`, `collection`, `width`, `height`) and whether `alt === filename` of the expected attachment.

Run it; write the printed table and the conclusion ("alt equals the file name: yes/no; rendered HTML order matches: yes/no") into `docs/live-checks.md`. If `alt` never equals the file name, record a Ruling: rendered-HTML order becomes the primary strategy (Task 6 swaps the order inside `createMediaResolver`).

- [ ] **Step 4: Commit**

```bash
git add apps/reports/scripts/live-checks.mjs apps/reports/docs/live-checks.md apps/reports/static/app/test/fixtures/adf/media-rpt.json apps/reports/manifest.yml atlassian/plans/2026-09-29-artup-reports-v1-rulings.md
git commit -m "REPORTS-4: Record module contexts, scopes, storage limits and ADF media mapping from the dev site

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Limits, script runs, file names, image sizes

**Model:** sonnet

**Files:**
- Create: `static/app/src/core/{limits.js,textRuns.js,filename.js,imageSize.js}` (all paths below are under `apps/reports/` unless absolute)
- Test: `static/app/test/core/{textRuns.test.js,filename.test.js,imageSize.test.js}`

**Interfaces:**
- Produces:
  - `limits.js`: `ID_PAGE`, `BULK_BATCH`, `ISSUE_CONCURRENCY`, `MEDIA_CONCURRENCY`, `MAX_ATTEMPTS`, `MAX_DOC_ISSUES`, `EXCEL_CELL_LIMIT`, `TEMPLATE_MAX_BYTES`, `TEMPLATE_PART_BYTES`, `TEMPLATE_MAX_PARTS`, `PREVIEW_ISSUES` (numbers).
  - `splitRuns(text) → Array<{ text: string, script: 'latin'|'cjk'|'korean'|'emoji' }>`, `scriptOf(char) → script`, `scriptsIn(texts: Iterable<string>) → Set<script>`.
  - `DEFAULT_FILE_PATTERN`, `localDate(now: Date) → 'YYYY-MM-DD'`, `renderFileName({ pattern?, values: { project?, filter?, format?, count? }, now: Date, extension: string, partial?: boolean }) → string`.
  - `readImageInfo(bytes: Uint8Array|ArrayBuffer) → { type: 'png'|'jpg'|'gif', width, height } | null`, `fitImage({ width, height }, maxWidth) → { width, height }`.

- [ ] **Step 1: Write the failing tests.**

`test/core/textRuns.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { scriptsIn, splitRuns } from '../../src/core/textRuns.js';

describe('splitRuns', () => {
  it('splits Latin, CJK and Cyrillic and keeps a trailing space with the run before it', () => {
    expect(splitRuns('Report 報告 отчёт')).toEqual([
      { text: 'Report ', script: 'latin' },
      { text: '報告 ', script: 'cjk' },
      { text: 'отчёт', script: 'latin' },
    ]);
  });
  it('gives Hangul its own script', () => {
    expect(splitRuns('한국어 text')).toEqual([
      { text: '한국어 ', script: 'korean' },
      { text: 'text', script: 'latin' },
    ]);
  });
  it('keeps skin-tone modifiers inside the emoji run', () => {
    expect(splitRuns('ok 👍🏽 done')).toEqual([
      { text: 'ok ', script: 'latin' },
      { text: '👍🏽', script: 'emoji' },
      { text: ' done', script: 'latin' },
    ]);
  });
  it('treats kana and CJK extension B as cjk', () => {
    expect(splitRuns('リリース𠀀')).toEqual([{ text: 'リリース𠀀', script: 'cjk' }]);
  });
  it('keeps ©, ® and ™ in the latin run', () => {
    expect(splitRuns('©2026 ™')).toEqual([{ text: '©2026 ™', script: 'latin' }]);
  });
  it('returns no runs for empty or missing text', () => {
    expect(splitRuns('')).toEqual([]);
    expect(splitRuns(null)).toEqual([]);
  });
});

describe('scriptsIn', () => {
  it('collects every script present in the texts', () => {
    expect(scriptsIn(['a', '報', '한'])).toEqual(new Set(['latin', 'cjk', 'korean']));
  });
});
```

`test/core/filename.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { renderFileName } from '../../src/core/filename.js';

const now = new Date(2026, 8, 29, 10, 0, 0);

describe('renderFileName', () => {
  it('fills the default pattern with project, local date and filter', () => {
    expect(renderFileName({ values: { project: 'RPT', filter: 'Open bugs' }, now, extension: 'xlsx' })).toBe('RPT-2026-09-29-Open-bugs.xlsx');
  });
  it('drops an empty token together with its separator', () => {
    expect(renderFileName({ values: { project: 'RPT' }, now, extension: 'xlsx' })).toBe('RPT-2026-09-29.xlsx');
  });
  it('replaces characters that filesystems forbid', () => {
    expect(renderFileName({ values: { project: 'RPT', filter: 'a/b:c*?' }, now, extension: 'xlsx' })).toBe('RPT-2026-09-29-a-b-c.xlsx');
  });
  it('keeps Cyrillic and CJK letters', () => {
    expect(renderFileName({ values: { project: 'RPT', filter: 'Отчёт 報告' }, now, extension: 'docx' })).toBe('RPT-2026-09-29-Отчёт-報告.docx');
  });
  it('marks a partial file', () => {
    expect(renderFileName({ values: { project: 'RPT' }, now, extension: 'pdf', partial: true })).toBe('RPT-2026-09-29-PARTIAL.pdf');
  });
  it('falls back to artup-report when the pattern renders empty', () => {
    expect(renderFileName({ pattern: '{filter}', values: {}, now, extension: 'xlsx' })).toBe('artup-report.xlsx');
  });
  it('ignores unknown tokens', () => {
    expect(renderFileName({ pattern: '{nope}-{project}', values: { project: 'RPT' }, now, extension: 'xlsx' })).toBe('RPT.xlsx');
  });
  it('limits the base name to 120 characters', () => {
    const name = renderFileName({ pattern: '{filter}', values: { filter: 'x'.repeat(300) }, now, extension: 'xlsx' });
    expect(name).toBe(`${'x'.repeat(120)}.xlsx`);
  });
});
```

`test/core/imageSize.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { fitImage, readImageInfo } from '../../src/core/imageSize.js';

function png(width, height) {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpeg(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

describe('readImageInfo', () => {
  it('reads PNG size', () => {
    expect(readImageInfo(png(320, 200))).toEqual({ type: 'png', width: 320, height: 200 });
  });
  it('reads JPEG size from the SOF segment after APP0', () => {
    expect(readImageInfo(jpeg(640, 480))).toEqual({ type: 'jpg', width: 640, height: 480 });
  });
  it('reads GIF size', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00]);
    expect(readImageInfo(gif)).toEqual({ type: 'gif', width: 320, height: 200 });
  });
  it('accepts an ArrayBuffer', () => {
    expect(readImageInfo(png(10, 20).buffer)).toEqual({ type: 'png', width: 10, height: 20 });
  });
  it('returns null for other formats', () => {
    expect(readImageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('fitImage', () => {
  it('keeps an image that already fits', () => {
    expect(fitImage({ width: 300, height: 200 }, 600)).toEqual({ width: 300, height: 200 });
  });
  it('scales a wide image down keeping its ratio', () => {
    expect(fitImage({ width: 1200, height: 600 }, 600)).toEqual({ width: 600, height: 300 });
  });
  it('uses a 16:10 box when the size is unknown', () => {
    expect(fitImage({ width: 0, height: 0 }, 640)).toEqual({ width: 640, height: 400 });
  });
});
```

- [ ] **Step 2: Run** `npm --prefix static/app test -- core/textRuns core/filename core/imageSize` → FAIL (modules not found).

- [ ] **Step 3: Implement.**

`src/core/limits.js`:

```js
/** Issue ids per search page. */
export const ID_PAGE = 5000;
/** Issues per bulkfetch call. */
export const BULK_BATCH = 100;
/** Parallel issue requests. */
export const ISSUE_CONCURRENCY = 6;
/** Parallel attachment downloads. */
export const MEDIA_CONCURRENCY = 12;
/** Attempts per request, first try included. */
export const MAX_ATTEMPTS = 6;
/** Largest Word or PDF export. */
export const MAX_DOC_ISSUES = 2000;
/** Characters Excel accepts in one cell. */
export const EXCEL_CELL_LIMIT = 32767;
/** Largest customer .docx template. */
export const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024;
/** Raw bytes per stored template part. */
export const TEMPLATE_PART_BYTES = 150 * 1024;
/** Parts needed for the largest template. */
export const TEMPLATE_MAX_PARTS = Math.ceil(TEMPLATE_MAX_BYTES / TEMPLATE_PART_BYTES);
/** Issues shown in the Excel preview. */
export const PREVIEW_ISSUES = 5;
```

`src/core/textRuns.js`:

```js
const KOREAN = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/u;
const CJK = /[⺀-⿿　-ㄯ㆐-鿿豈-﫿︰-﹏＀-￯\u{20000}-\u{3134F}]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const JOINER = /[‍︎️\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;
const SPACE = /\s/u;

/** Script of one character: korean, cjk, emoji or latin (Latin, Cyrillic, Greek and the rest). */
export function scriptOf(char) {
  if (KOREAN.test(char)) return 'korean';
  if (CJK.test(char)) return 'cjk';
  if (EMOJI.test(char) && char.codePointAt(0) >= 0x2190) return 'emoji';
  return 'latin';
}

/** Splits text into consecutive runs of one script; spaces stay with the run before them. */
export function splitRuns(text) {
  const runs = [];
  for (const char of String(text ?? '')) {
    const last = runs[runs.length - 1];
    const joins = Boolean(last) && ((SPACE.test(char) && last.script !== 'emoji') || (JOINER.test(char) && last.script === 'emoji'));
    const script = joins ? last.script : scriptOf(char);
    if (last && last.script === script) {
      last.text += char;
    } else {
      runs.push({ text: char, script });
    }
  }
  return runs;
}

/** Every script that occurs in the given texts. */
export function scriptsIn(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const run of splitRuns(text)) found.add(run.script);
  }
  return found;
}
```

`src/core/filename.js`:

```js
/** File-name pattern used when a template has none. */
export const DEFAULT_FILE_PATTERN = '{project}-{date}-{filter}';

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F\u007F]/gu;
const MAX_BASE = 120;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function localDate(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function clean(value) {
  return String(value ?? '').normalize('NFC').replace(FORBIDDEN, '-').replace(/\s+/gu, '-');
}

function sliceUnits(text, max) {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Renders a file-name pattern with {project} {date} {filter} {format} {count}; forbidden characters become '-'. */
export function renderFileName({ pattern = DEFAULT_FILE_PATTERN, values = {}, now, extension, partial = false }) {
  const data = { ...values, date: localDate(now) };
  const filled = pattern.replace(/\{(\w+)\}/g, (_, name) => clean(data[name]));
  const collapsed = clean(filled).replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  const base = sliceUnits(collapsed, MAX_BASE).replace(/[-.]+$/, '') || 'artup-report';
  return `${base}${partial ? '-PARTIAL' : ''}.${extension}`;
}
```

`src/core/imageSize.js`:

```js
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readJpeg(b) {
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (SOF.has(marker)) {
      return { type: 'jpg', width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

/** Type and pixel size of a PNG, JPEG or GIF; null for anything else. */
export function readImageInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { type: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    return readJpeg(b);
  }
  return null;
}

/** Scales a size down to maxWidth keeping the ratio; unknown sizes get a 16:10 box. */
export function fitImage({ width, height }, maxWidth) {
  if (!(width > 0 && height > 0)) {
    return { width: maxWidth, height: Math.round(maxWidth * 0.625) };
  }
  if (width <= maxWidth) {
    return { width, height };
  }
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}
```

If Task 3 recorded a lower `TEMPLATE_PART_BYTES`, use that value.

- [ ] **Step 4: Run** the three test files → PASS; `npm --prefix static/app test` → all PASS (guards included).

- [ ] **Step 5: Commit**

```bash
git add apps/reports/static/app/src/core apps/reports/static/app/test/core
git commit -m "REPORTS-5: Add limits, script runs, file names and image sizes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Field catalog and typed cell values

**Model:** sonnet

**Files:**
- Create: `static/app/src/core/fields.js`
- Test: `static/app/test/core/fields.test.js`

**Interfaces:**
- Consumes: raw `GET /rest/api/3/field` rows `{ id, name, custom, schema?: { type, items, system, custom } }`.
- Produces:
  - `buildFieldCatalog(rawFields) → { list: Field[], byId: Map<string, Field>, byName: Map<lowercase name, Field> }` where `Field = { id, name, custom, type, items, system, customType }`.
  - `resolveField(catalog, ref) → Field | null` (id first, then case-insensitive name; on a name clash the system field, then the lowest custom id wins).
  - `findByNames(catalog, names[]) → Field | null`, `findByCustomType(catalog, customType) → Field | null`.
  - `cellValue(field: Field|null, raw) → Cell`, `Cell = { kind: 'empty'|'text'|'number'|'date'|'datetime'|'duration'|'adf'|'link', value, text, percent? }`. `date` value is a UTC-midnight `Date`; `datetime` value is a `Date`; `duration` value is seconds; `adf` value is the ADF doc and `text` is `''` (callers convert).
  - `linkCell(text, url) → Cell` (`kind: 'link'`, `value: url`).

- [ ] **Step 1: Write the failing test** `test/core/fields.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildFieldCatalog, cellValue, findByCustomType, findByNames, linkCell, resolveField } from '../../src/core/fields.js';

const RAW = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
  { id: 'duedate', name: 'Due date', custom: false, schema: { type: 'date', system: 'duedate' } },
  { id: 'created', name: 'Created', custom: false, schema: { type: 'datetime', system: 'created' } },
  { id: 'timespent', name: 'Time Spent', custom: false, schema: { type: 'number', system: 'timespent' } },
  { id: 'labels', name: 'Labels', custom: false, schema: { type: 'array', items: 'string', system: 'labels' } },
  { id: 'fixVersions', name: 'Fix versions', custom: false, schema: { type: 'array', items: 'version', system: 'fixVersions' } },
  { id: 'issuelinks', name: 'Linked Issues', custom: false, schema: { type: 'array', items: 'issuelinks', system: 'issuelinks' } },
  { id: 'subtasks', name: 'Sub-tasks', custom: false, schema: { type: 'array', items: 'issuelinks', system: 'subtasks' } },
  { id: 'comment', name: 'Comment', custom: false, schema: { type: 'comments-page', system: 'comment' } },
  { id: 'status', name: 'Status', custom: false, schema: { type: 'status', system: 'status' } },
  { id: 'assignee', name: 'Assignee', custom: false, schema: { type: 'user', system: 'assignee' } },
  { id: 'description', name: 'Description', custom: false, schema: { type: 'string', system: 'description' } },
  { id: 'customfield_10200', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  { id: 'customfield_10016', name: 'story points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10300', name: 'Region', custom: true, schema: { type: 'option-with-child', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect' } },
  { id: 'customfield_10400', name: 'Done %', custom: true, schema: { type: 'progress' } },
];
const catalog = buildFieldCatalog(RAW);
const f = (id) => catalog.byId.get(id);

describe('resolveField', () => {
  it('finds a field by id', () => {
    expect(resolveField(catalog, 'duedate')?.name).toBe('Due date');
  });
  it('finds a field by name ignoring case', () => {
    expect(resolveField(catalog, 'DUE DATE')?.id).toBe('duedate');
  });
  it('prefers the lowest custom id when two fields share a name', () => {
    expect(resolveField(catalog, 'Story Points')?.id).toBe('customfield_10016');
  });
  it('returns null for an unknown reference', () => {
    expect(resolveField(catalog, 'customfield_99999')).toBeNull();
  });
  it('finds by a list of names and by custom type', () => {
    expect(findByNames(catalog, ['Story point estimate', 'Story Points'])?.id).toBe('customfield_10016');
    expect(findByCustomType(catalog, 'com.pyxis.greenhopper.jira:gh-sprint')?.id).toBe('customfield_10020');
  });
});

describe('cellValue', () => {
  it('returns empty for null, empty string and empty arrays', () => {
    expect(cellValue(f('summary'), null)).toEqual({ kind: 'empty', value: null, text: '' });
    expect(cellValue(f('labels'), [])).toEqual({ kind: 'empty', value: null, text: '' });
  });
  it('turns a date into a UTC-midnight Date', () => {
    expect(cellValue(f('duedate'), '2026-09-29')).toEqual({ kind: 'date', value: new Date(Date.UTC(2026, 8, 29)), text: '2026-09-29' });
  });
  it('parses Jira datetimes with a +hhmm offset', () => {
    expect(cellValue(f('created'), '2026-09-29T10:15:30.000+0300')).toEqual({
      kind: 'datetime', value: new Date('2026-09-29T07:15:30.000Z'), text: '2026-09-29T10:15:30.000+0300',
    });
  });
  it('keeps durations in seconds', () => {
    expect(cellValue(f('timespent'), 5400)).toEqual({ kind: 'duration', value: 5400, text: '1.5 h' });
  });
  it('joins arrays of strings and named objects', () => {
    expect(cellValue(f('labels'), ['a', 'b'])).toEqual({ kind: 'text', value: 'a, b', text: 'a, b' });
    expect(cellValue(f('fixVersions'), [{ name: '1.0' }, { name: '1.1' }])).toEqual({ kind: 'text', value: '1.0, 1.1', text: '1.0, 1.1' });
  });
  it('writes issue links with their direction', () => {
    const raw = [
      { type: { outward: 'blocks', inward: 'is blocked by' }, outwardIssue: { key: 'RPT-2' } },
      { type: { outward: 'blocks', inward: 'is blocked by' }, inwardIssue: { key: 'RPT-3' } },
    ];
    expect(cellValue(f('issuelinks'), raw).text).toBe('blocks RPT-2, is blocked by RPT-3');
  });
  it('lists sub-task keys', () => {
    expect(cellValue(f('subtasks'), [{ key: 'RPT-5', fields: {} }]).text).toBe('RPT-5');
  });
  it('counts comments', () => {
    expect(cellValue(f('comment'), { total: 3, comments: [] })).toEqual({ kind: 'number', value: 3, text: '3' });
  });
  it('names users, statuses and cascading options', () => {
    expect(cellValue(f('assignee'), { displayName: 'Ann' }).text).toBe('Ann');
    expect(cellValue(f('status'), { name: 'Done' }).text).toBe('Done');
    expect(cellValue(f('customfield_10300'), { value: 'EU', child: { value: 'DE' } }).text).toBe('EU / DE');
  });
  it('names sprints', () => {
    expect(cellValue(f('customfield_10020'), [{ id: 1, name: 'Sprint 1' }]).text).toBe('Sprint 1');
  });
  it('passes ADF through for the caller to convert', () => {
    const doc = { type: 'doc', version: 1, content: [] };
    expect(cellValue(f('description'), doc)).toEqual({ kind: 'adf', value: doc, text: '' });
  });
  it('turns progress into a fraction', () => {
    expect(cellValue(f('customfield_10400'), { percent: 40 })).toEqual({ kind: 'number', value: 0.4, text: '40%', percent: true });
  });
  it('keeps numbers of an unknown field as numbers', () => {
    expect(cellValue(null, 7)).toEqual({ kind: 'number', value: 7, text: '7' });
  });
  it('falls back to a short JSON text for an unknown object', () => {
    expect(cellValue(null, { a: 1 }).text).toBe('{"a":1}');
  });
});

describe('linkCell', () => {
  it('builds a link cell', () => {
    expect(linkCell('RPT-1', 'https://x/browse/RPT-1')).toEqual({ kind: 'link', value: 'https://x/browse/RPT-1', text: 'RPT-1' });
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/core/fields.js`:

```js
const DURATION = new Set([
  'timespent', 'timeoriginalestimate', 'timeestimate',
  'aggregatetimespent', 'aggregatetimeoriginalestimate', 'aggregatetimeestimate',
]);

const EMPTY = Object.freeze({ kind: 'empty', value: null, text: '' });

function customNumber(id) {
  const match = /^customfield_(\d+)$/.exec(id);
  return match ? Number(match[1]) : -1;
}

function compareFields(a, b) {
  return customNumber(a.id) - customNumber(b.id) || a.id.localeCompare(b.id);
}

/** Indexes GET /rest/api/3/field by id and by lower-case name; on a name clash system fields, then lower ids win. */
export function buildFieldCatalog(rawFields) {
  const list = rawFields.map((f) => ({
    id: f.id,
    name: f.name,
    custom: Boolean(f.custom),
    type: f.schema?.type ?? 'any',
    items: f.schema?.items ?? null,
    system: f.schema?.system ?? null,
    customType: f.schema?.custom ?? null,
  }));
  const byId = new Map(list.map((f) => [f.id, f]));
  const byName = new Map();
  for (const field of [...list].sort(compareFields)) {
    const key = field.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, field);
  }
  return { list, byId, byName };
}

/** Field by id, else by case-insensitive name; null when unknown. */
export function resolveField(catalog, ref) {
  if (!ref) return null;
  return catalog.byId.get(ref) ?? catalog.byName.get(String(ref).toLowerCase()) ?? null;
}

/** First field matching one of the names, in the order given. */
export function findByNames(catalog, names) {
  for (const name of names) {
    const field = catalog.byName.get(name.toLowerCase());
    if (field) return field;
  }
  return null;
}

/** Lowest-id field of a custom field type. */
export function findByCustomType(catalog, customType) {
  return [...catalog.list].sort(compareFields).find((f) => f.customType === customType) ?? null;
}

const textCell = (text) => (text === '' ? EMPTY : { kind: 'text', value: text, text });
const countCell = (n) => (n == null ? EMPTY : { kind: 'number', value: n, text: String(n) });

/** Link cell: shows text, points to url. */
export function linkCell(text, url) {
  return { kind: 'link', value: url, text };
}

function nameOf(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const own = String(value.displayName ?? value.name ?? value.value ?? value.key ?? '');
  return value.child ? `${own} / ${nameOf(value.child)}` : own;
}

function linkText(link) {
  if (link.outwardIssue) return `${link.type?.outward ?? ''} ${link.outwardIssue.key}`.trim();
  if (link.inwardIssue) return `${link.type?.inward ?? ''} ${link.inwardIssue.key}`.trim();
  return '';
}

function itemText(field, item) {
  if (field?.system === 'issuelinks') return linkText(item);
  if (item && typeof item === 'object' && item.key && item.fields) return item.key;
  if (item && typeof item === 'object' && item.filename) return item.filename;
  return nameOf(item);
}

function isAdf(value) {
  return Boolean(value) && typeof value === 'object' && value.type === 'doc' && Array.isArray(value.content);
}

function dateCell(raw) {
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return textCell(raw);
  return { kind: 'date', value: new Date(Date.UTC(y, m - 1, d)), text: raw };
}

function datetimeCell(raw) {
  const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(ms) ? textCell(raw) : { kind: 'datetime', value: new Date(ms), text: raw };
}

const hours = (seconds) => `${Number((seconds / 3600).toFixed(2))} h`;

/** Typed cell for a raw Jira field value; ADF comes back as kind 'adf' for the caller to convert. */
export function cellValue(field, raw) {
  if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return EMPTY;
  const type = field?.type ?? 'any';
  if (field && DURATION.has(field.system ?? field.id) && typeof raw === 'number') {
    return { kind: 'duration', value: raw, text: hours(raw) };
  }
  if (type === 'date' && typeof raw === 'string') return dateCell(raw);
  if (type === 'datetime' && typeof raw === 'string') return datetimeCell(raw);
  if (isAdf(raw)) return { kind: 'adf', value: raw, text: '' };
  if (Array.isArray(raw)) return textCell(raw.map((item) => itemText(field, item)).filter(Boolean).join(', '));
  if (field?.system === 'comment' || type === 'comments-page') return countCell(raw.total ?? raw.comments?.length);
  if (field?.system === 'worklog') return countCell(raw.total ?? raw.worklogs?.length);
  if (type === 'progress') {
    const percent = raw.percent ?? 0;
    return { kind: 'number', value: percent / 100, text: `${percent}%`, percent: true };
  }
  if (type === 'timetracking') return textCell(String(raw.originalEstimate ?? ''));
  if (type === 'watches') return countCell(raw.watchCount);
  if (type === 'votes') return countCell(raw.votes);
  if (typeof raw === 'number') return { kind: 'number', value: raw, text: String(raw) };
  if (typeof raw === 'boolean' || typeof raw === 'string') return textCell(String(raw));
  if (raw.key && raw.fields) return textCell(raw.key);
  return textCell(nameOf(raw) || JSON.stringify(raw).slice(0, 200));
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `REPORTS-6: Add the field catalog and typed cell values` (same trailer).

### Task 6: ADF → document model, merged-cell grid, media → attachments

**Model:** opus

**Files:**
- Create: `static/app/src/core/{adf.js,tableGrid.js,media.js}`
- Test: `static/app/test/core/{adf.test.js,tableGrid.test.js,media.test.js}`; fixtures `static/app/test/fixtures/adf/*.json` (copy three real descriptions from RPT via the Task 3 script: `RPT-1` (merged cells), `RPT-3` (CJK), one with nested lists — add a `live-checks.mjs adf <KEY>` subcommand that prints a description ADF)

**Interfaces:**
- Consumes: `EXCEL_CELL_LIMIT` (Task 4); fixture `media-rpt.json` (Task 3).
- Produces:
  - Model (`Block`): `{ type: 'para', runs }`, `{ type: 'heading', level: 1..6, runs }`, `{ type: 'list', ordered: boolean, start: number, items: Array<{ blocks: Block[] }> }`, `{ type: 'table', header: boolean, rows: Array<{ cells: Array<{ header, colspan, rowspan, blocks }> }> }`, `{ type: 'code', language, text }`, `{ type: 'quote', blocks }`, `{ type: 'panel', kind: 'info'|'note'|'warning'|'error'|'success'|string, blocks }`, `{ type: 'rule' }`, `{ type: 'image', attachmentId: string|null, alt, width: number|null, height: number|null }`, `{ type: 'pageBreak' }` (layouts only).
  - `Run = { text, bold?, italic?, code?, strike?, underline?, link?, color?, sub?, sup? }`; `'\n'` inside `text` is a line break.
  - `adfToModel(doc, { resolveMedia?(attrs, index) → attachmentId|null, formatDate?(ms) → string }) → { blocks: Block[], warnings: Array<{ kind: 'adf-fallback'|'image-unresolved'|'image-external', detail }> }`.
  - `blocksToText(blocks) → string`; `truncateCell(text, limit = EXCEL_CELL_LIMIT) → string`.
  - `tableGrid(table) → Slot[][]`, `Slot = { origin: true, cell, colspan, rowspan, filler? } | { origin: false, fromAbove: boolean, leading: boolean, colspan: number }`.
  - `createMediaResolver(attachments: Array<{ id, filename }>, renderedHtml?: string) → (attrs, index) => attachmentId|null`.

- [ ] **Step 1: Write the failing tests.**

`test/core/adf.test.js` (helpers `doc(...content)`, `p(...inline)`, `t(text, marks)`):

```js
import { describe, expect, it } from 'vitest';
import { adfToModel, blocksToText, truncateCell } from '../../src/core/adf.js';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content });
const cell = (text, attrs, type = 'tableCell') => ({ type, ...(attrs ? { attrs } : {}), content: [p(t(text))] });

describe('adfToModel', () => {
  it('keeps text marks as run flags', () => {
    const { blocks } = adfToModel(doc(p(t('a', [{ type: 'strong' }, { type: 'em' }]), t('b', [{ type: 'link', attrs: { href: 'https://e.x' } }]), t('c', [{ type: 'code' }, { type: 'strike' }, { type: 'underline' }, { type: 'textColor', attrs: { color: '#ff0000' } }, { type: 'subsup', attrs: { type: 'sup' } }]))));
    expect(blocks).toEqual([{ type: 'para', runs: [
      { text: 'a', bold: true, italic: true },
      { text: 'b', link: 'https://e.x' },
      { text: 'c', code: true, strike: true, underline: true, color: '#ff0000', sup: true },
    ] }]);
  });
  it('turns a hard break into a newline run', () => {
    expect(adfToModel(doc(p(t('a'), { type: 'hardBreak' }, t('b')))).blocks[0].runs).toEqual([{ text: 'a' }, { text: '\n' }, { text: 'b' }]);
  });
  it('writes mention, emoji, date, status and inline card as text', () => {
    const { blocks } = adfToModel(doc(p(
      { type: 'mention', attrs: { id: 'x', text: '@Ann' } },
      { type: 'emoji', attrs: { shortName: ':smile:', text: '😄' } },
      { type: 'date', attrs: { timestamp: '1790640000000' } },
      { type: 'status', attrs: { text: 'In progress', color: 'blue' } },
      { type: 'inlineCard', attrs: { url: 'https://e.x/a' } },
    )), { formatDate: () => '29.09.2026' });
    expect(blocks[0].runs).toEqual([
      { text: '@Ann' }, { text: '😄' }, { text: '29.09.2026' },
      { text: '[IN PROGRESS]', bold: true }, { text: 'https://e.x/a', link: 'https://e.x/a' },
    ]);
  });
  it('keeps heading levels and clamps them to 1..6', () => {
    const { blocks } = adfToModel(doc({ type: 'heading', attrs: { level: 2 }, content: [t('H')] }, { type: 'heading', attrs: { level: 9 }, content: [t('X')] }));
    expect(blocks).toEqual([{ type: 'heading', level: 2, runs: [{ text: 'H' }] }, { type: 'heading', level: 6, runs: [{ text: 'X' }] }]);
  });
  it('nests lists and keeps the ordered start', () => {
    const { blocks } = adfToModel(doc({ type: 'orderedList', attrs: { order: 3 }, content: [
      { type: 'listItem', content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('inner'))] }] }] },
    ] }));
    expect(blocks).toEqual([{ type: 'list', ordered: true, start: 3, items: [{ blocks: [
      { type: 'para', runs: [{ text: 'one' }] },
      { type: 'list', ordered: false, start: 1, items: [{ blocks: [{ type: 'para', runs: [{ text: 'inner' }] }] }] },
    ] }] }]);
  });
  it('renders task items with a checkbox prefix', () => {
    const { blocks } = adfToModel(doc({ type: 'taskList', attrs: { localId: 'l' }, content: [
      { type: 'taskItem', attrs: { localId: 'a', state: 'DONE' }, content: [t('done')] },
      { type: 'taskItem', attrs: { localId: 'b', state: 'TODO' }, content: [t('todo')] },
    ] }));
    expect(blocks[0].items.map((i) => i.blocks[0].runs)).toEqual([[{ text: '[x] ' }, { text: 'done' }], [{ text: '[ ] ' }, { text: 'todo' }]]);
  });
  it('keeps table spans and marks a header row', () => {
    const { blocks } = adfToModel(doc({ type: 'table', content: [
      { type: 'tableRow', content: [cell('A', null, 'tableHeader'), cell('B', null, 'tableHeader')] },
      { type: 'tableRow', content: [cell('wide', { colspan: 2 })] },
    ] }));
    expect(blocks[0]).toEqual({ type: 'table', header: true, rows: [
      { cells: [
        { header: true, colspan: 1, rowspan: 1, blocks: [{ type: 'para', runs: [{ text: 'A' }] }] },
        { header: true, colspan: 1, rowspan: 1, blocks: [{ type: 'para', runs: [{ text: 'B' }] }] },
      ] },
      { cells: [{ header: false, colspan: 2, rowspan: 1, blocks: [{ type: 'para', runs: [{ text: 'wide' }] }] }] },
    ] });
  });
  it('maps code, quote, panel, rule and expand', () => {
    const { blocks } = adfToModel(doc(
      { type: 'codeBlock', attrs: { language: 'json' }, content: [t('{"a":1}')] },
      { type: 'blockquote', content: [p(t('q'))] },
      { type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('w'))] },
      { type: 'rule' },
      { type: 'expand', attrs: { title: 'More' }, content: [p(t('m'))] },
    ));
    expect(blocks).toEqual([
      { type: 'code', language: 'json', text: '{"a":1}' },
      { type: 'quote', blocks: [{ type: 'para', runs: [{ text: 'q' }] }] },
      { type: 'panel', kind: 'warning', blocks: [{ type: 'para', runs: [{ text: 'w' }] }] },
      { type: 'rule' },
      { type: 'para', runs: [{ text: 'More', bold: true }] },
      { type: 'para', runs: [{ text: 'm' }] },
    ]);
  });
  it('resolves media through the resolver and warns when it cannot', () => {
    const media = (alt) => ({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'uuid', type: 'file', collection: 'c', alt, width: 320, height: 200 } }] });
    const { blocks, warnings } = adfToModel(doc(media('a.png'), media('b.png')), { resolveMedia: (attrs) => (attrs.alt === 'a.png' ? '10001' : null) });
    expect(blocks).toEqual([
      { type: 'image', attachmentId: '10001', alt: 'a.png', width: 320, height: 200 },
      { type: 'image', attachmentId: null, alt: 'b.png', width: 320, height: 200 },
    ]);
    expect(warnings).toEqual([{ kind: 'image-unresolved', detail: 'b.png' }]);
  });
  it('does not download external images', () => {
    const { blocks, warnings } = adfToModel(doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { type: 'external', url: 'https://e.x/i.png' } }] }));
    expect(blocks).toEqual([{ type: 'image', attachmentId: null, alt: 'https://e.x/i.png', width: null, height: null }]);
    expect(warnings).toEqual([{ kind: 'image-external', detail: 'https://e.x/i.png' }]);
  });
  it('flattens layouts and falls back to text for unknown nodes with a warning', () => {
    const { blocks, warnings } = adfToModel(doc(
      { type: 'layoutSection', content: [{ type: 'layoutColumn', content: [p(t('left'))] }, { type: 'layoutColumn', content: [p(t('right'))] }] },
      { type: 'futureNode', content: [t('kept')] },
    ));
    expect(blocks).toEqual([
      { type: 'para', runs: [{ text: 'left' }] },
      { type: 'para', runs: [{ text: 'right' }] },
      { type: 'para', runs: [{ text: 'kept' }] },
    ]);
    expect(warnings).toEqual([{ kind: 'adf-fallback', detail: 'futureNode' }]);
  });
  it('returns no blocks for a missing document', () => {
    expect(adfToModel(null)).toEqual({ blocks: [], warnings: [] });
  });
});

describe('blocksToText', () => {
  it('writes lists with markers and indentation, tables with bars', () => {
    const { blocks } = adfToModel(doc(
      p(t('Intro')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('b'))] }] }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [cell('x'), cell('y')] }] },
    ));
    expect(blocksToText(blocks)).toBe('Intro\n• a\n  1. b\nx | y');
  });
});

describe('truncateCell', () => {
  it('keeps short text', () => {
    expect(truncateCell('abc', 10)).toBe('abc');
  });
  it('cuts long text and states how much was cut, within the limit', () => {
    const out = truncateCell('x'.repeat(100), 40);
    expect(out).toBe(`${'x'.repeat(24)} …[+76]`);
    expect(out.length).toBeLessThanOrEqual(40);
  });
  it('never splits a surrogate pair', () => {
    const out = truncateCell('😀'.repeat(50), 40);
    expect(/[\uD800-\uDBFF] …/.test(out)).toBe(false);
  });
});

describe('real RPT descriptions', () => {
  it.each(['rpt-merged.json', 'rpt-cjk.json', 'rpt-lists.json'])('%s converts without fallback warnings', async (name) => {
    const { default: adf } = await import(`../fixtures/adf/${name}`);
    const { blocks, warnings } = adfToModel(adf);
    expect(blocks.length).toBeGreaterThan(0);
    expect(warnings).toEqual([]);
  });
});
```

`test/core/tableGrid.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { tableGrid } from '../../src/core/tableGrid.js';

const c = (name, colspan = 1, rowspan = 1) => ({ header: false, colspan, rowspan, blocks: [{ type: 'para', runs: [{ text: name }] }] });

describe('tableGrid', () => {
  it('places colspan and rowspan cells and marks covered slots', () => {
    const grid = tableGrid({ rows: [
      { cells: [c('A', 2), c('B', 1, 2)] },
      { cells: [c('C'), c('D')] },
    ] });
    expect(grid.map((row) => row.map((s) => (s.origin ? s.cell.blocks[0].runs[0].text : `${s.fromAbove ? '^' : '<'}${s.leading ? '!' : ''}`)))).toEqual([
      ['A', '<', 'B'],
      ['C', 'D', '^!'],
    ]);
  });
  it('fills short rows with empty filler cells', () => {
    const grid = tableGrid({ rows: [{ cells: [c('A'), c('B')] }, { cells: [c('C')] }] });
    expect(grid[1][1]).toEqual({ origin: true, filler: true, colspan: 1, rowspan: 1, cell: { header: false, colspan: 1, rowspan: 1, blocks: [] } });
  });
  it('clips a rowspan that runs past the last row', () => {
    const grid = tableGrid({ rows: [{ cells: [c('A', 1, 5)] }] });
    expect(grid).toHaveLength(1);
    expect(grid[0][0].rowspan).toBe(1);
  });
});
```

`test/core/media.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { adfToModel } from '../../src/core/adf.js';
import { createMediaResolver } from '../../src/core/media.js';
import fixture from '../fixtures/adf/media-rpt.json';

describe('createMediaResolver', () => {
  const attachments = [{ id: '1', filename: 'a.png' }, { id: '2', filename: 'same.png' }, { id: '3', filename: 'same.png' }];
  it('matches by file name first', () => {
    expect(createMediaResolver(attachments)({ alt: 'a.png' }, 0)).toBe('1');
  });
  it('hands out same-named attachments in order, then reuses the first', () => {
    const resolve = createMediaResolver(attachments);
    expect([resolve({ alt: 'same.png' }, 0), resolve({ alt: 'same.png' }, 1), resolve({ alt: 'same.png' }, 2)]).toEqual(['2', '3', '2']);
  });
  it('falls back to the rendered HTML order', () => {
    const resolve = createMediaResolver(attachments, '<img src="/rest/api/3/attachment/content/3"><img src="/secure/attachment/1/a.png">');
    expect([resolve({ alt: '' }, 0), resolve({ alt: 'unknown' }, 1)]).toEqual(['3', '1']);
  });
  it('never returns an id that is not an attachment of the issue', () => {
    expect(createMediaResolver(attachments, '<img src="/rest/api/3/attachment/content/999">')({ alt: '' }, 0)).toBeNull();
  });
  it.each(fixture.cases.map((c, i) => [i, c]))('maps every media node of live case %i', (_, c) => {
    const resolveMedia = createMediaResolver(c.attachments, c.renderedHtml);
    const ids = adfToModel(c.adf, { resolveMedia }).blocks.flatMap(function collect(b) {
      if (b.type === 'image') return [b.attachmentId];
      return [...(b.blocks ?? []), ...(b.items ?? []).flatMap((i) => i.blocks)].flatMap(collect);
    });
    expect(ids).toEqual(c.expected);
  });
});
```

(`media.test.js` imports JSON; Vite handles it. The inline `collect` flattens images at any depth.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`src/core/adf.js`:

```js
import { EXCEL_CELL_LIMIT } from './limits.js';

const FLAG = { strong: 'bold', em: 'italic', code: 'code', strike: 'strike', underline: 'underline' };

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

function markedRun(node) {
  const run = { text: node.text ?? '' };
  for (const mark of node.marks ?? []) {
    if (FLAG[mark.type]) run[FLAG[mark.type]] = true;
    if (mark.type === 'link' && mark.attrs?.href) run.link = mark.attrs.href;
    if (mark.type === 'textColor' && mark.attrs?.color) run.color = mark.attrs.color;
    if (mark.type === 'subsup' && (mark.attrs?.type === 'sub' || mark.attrs?.type === 'sup')) run[mark.attrs.type] = true;
  }
  return run;
}

const linkRun = (url) => ({ text: url, link: url });

function inlineRun(node, ctx) {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'text': return markedRun(node);
    case 'hardBreak': return { text: '\n' };
    case 'mention': {
      const text = String(attrs.text ?? '');
      return { text: text.startsWith('@') ? text : `@${text || 'user'}` };
    }
    case 'emoji': return { text: attrs.text ?? attrs.shortName ?? '' };
    case 'date': return { text: ctx.formatDate(Number(attrs.timestamp)) };
    case 'status': return { text: `[${String(attrs.text ?? '').toUpperCase()}]`, bold: true };
    case 'inlineCard': return linkRun(attrs.url ?? attrs.data?.url ?? '');
    case 'mediaInline': return { text: attrs.alt ?? '' };
    case 'placeholder': return null;
    default:
      ctx.warnings.push({ kind: 'adf-fallback', detail: node.type });
      return { text: textOf(node) };
  }
}

function inlineRuns(nodes, ctx) {
  return (nodes ?? []).map((n) => inlineRun(n, ctx)).filter((r) => r && r.text !== '');
}

function listItems(nodes, ctx) {
  return (nodes ?? []).map((item) => ({ blocks: blocksOf(item.content ?? [], ctx) }));
}

function checkItems(nodes, ctx, prefix) {
  return (nodes ?? []).map((item) => {
    const inline = (item.content ?? []).filter((n) => !['taskList', 'decisionList'].includes(n.type));
    const nested = (item.content ?? []).filter((n) => ['taskList', 'decisionList'].includes(n.type));
    return { blocks: [{ type: 'para', runs: [{ text: prefix(item) }, ...inlineRuns(inline, ctx)] }, ...blocksOf(nested, ctx)] };
  });
}

function mediaBlock(node, ctx) {
  const attrs = node.attrs ?? {};
  if (attrs.type === 'external') {
    ctx.warnings.push({ kind: 'image-external', detail: attrs.url ?? '' });
    return { type: 'image', attachmentId: null, alt: attrs.url ?? '', width: attrs.width ?? null, height: attrs.height ?? null };
  }
  const index = ctx.mediaIndex;
  ctx.mediaIndex += 1;
  const attachmentId = ctx.resolveMedia(attrs, index);
  if (!attachmentId) ctx.warnings.push({ kind: 'image-unresolved', detail: attrs.alt ?? '' });
  return { type: 'image', attachmentId: attachmentId ?? null, alt: attrs.alt ?? '', width: attrs.width ?? null, height: attrs.height ?? null };
}

function tableBlock(node, ctx) {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow').map((row) => ({
    cells: (row.content ?? []).map((c) => ({
      header: c.type === 'tableHeader',
      colspan: c.attrs?.colspan ?? 1,
      rowspan: c.attrs?.rowspan ?? 1,
      blocks: blocksOf(c.content ?? [], ctx),
    })),
  }));
  const header = rows.length > 1 && rows[0].cells.length > 0 && rows[0].cells.every((c) => c.header);
  return { type: 'table', header, rows };
}

function block(node, ctx) {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph': return [{ type: 'para', runs: inlineRuns(node.content, ctx) }];
    case 'heading': return [{ type: 'heading', level: Math.min(6, Math.max(1, attrs.level ?? 1)), runs: inlineRuns(node.content, ctx) }];
    case 'bulletList': return [{ type: 'list', ordered: false, start: 1, items: listItems(node.content, ctx) }];
    case 'orderedList': return [{ type: 'list', ordered: true, start: attrs.order ?? 1, items: listItems(node.content, ctx) }];
    case 'taskList': return [{ type: 'list', ordered: false, start: 1, items: checkItems(node.content, ctx, (i) => (i.attrs?.state === 'DONE' ? '[x] ' : '[ ] ')) }];
    case 'decisionList': return [{ type: 'list', ordered: false, start: 1, items: checkItems(node.content, ctx, () => '» ') }];
    case 'listItem': case 'layoutColumn': return blocksOf(node.content ?? [], ctx);
    case 'layoutSection': return (node.content ?? []).flatMap((col) => blocksOf(col.content ?? [], ctx));
    case 'codeBlock': return [{ type: 'code', language: attrs.language ?? '', text: textOf(node) }];
    case 'blockquote': return [{ type: 'quote', blocks: blocksOf(node.content ?? [], ctx) }];
    case 'panel': return [{ type: 'panel', kind: attrs.panelType ?? 'info', blocks: blocksOf(node.content ?? [], ctx) }];
    case 'rule': return [{ type: 'rule' }];
    case 'table': return [tableBlock(node, ctx)];
    case 'mediaSingle': case 'mediaGroup': return (node.content ?? []).filter((n) => n.type === 'media').map((n) => mediaBlock(n, ctx));
    case 'media': return [mediaBlock(node, ctx)];
    case 'expand': case 'nestedExpand': {
      const title = attrs.title ? [{ type: 'para', runs: [{ text: attrs.title, bold: true }] }] : [];
      return [...title, ...blocksOf(node.content ?? [], ctx)];
    }
    case 'blockCard': case 'embedCard': return [{ type: 'para', runs: [linkRun(attrs.url ?? attrs.data?.url ?? '')] }];
    default: {
      ctx.warnings.push({ kind: 'adf-fallback', detail: node.type });
      const text = textOf(node);
      return text ? [{ type: 'para', runs: [{ text }] }] : [];
    }
  }
}

function blocksOf(nodes, ctx) {
  return nodes.flatMap((n) => block(n, ctx));
}

/** Converts an ADF document to the neutral document model; unknown nodes become text with a warning. */
export function adfToModel(doc, options = {}) {
  const ctx = {
    warnings: [],
    mediaIndex: 0,
    resolveMedia: options.resolveMedia ?? (() => null),
    formatDate: options.formatDate ?? isoDate,
  };
  const blocks = blocksOf(doc?.content ?? [], ctx);
  return { blocks, warnings: ctx.warnings };
}

const runsText = (runs) => runs.map((r) => r.text).join('');

function blockText(b, depth) {
  switch (b.type) {
    case 'para': case 'heading': return runsText(b.runs);
    case 'code': return b.text;
    case 'rule': return '---';
    case 'image': return `[${b.alt || 'image'}]`;
    case 'quote': case 'panel': return blocksToText(b.blocks, depth);
    case 'list': return b.items.map((item, i) => {
      const marker = b.ordered ? `${(b.start ?? 1) + i}. ` : '• ';
      const [first = '', ...rest] = blocksToText(item.blocks, depth + 1).split('\n');
      return [`${'  '.repeat(depth)}${marker}${first}`, ...rest].join('\n');
    }).join('\n');
    case 'table': return b.rows.map((r) => r.cells.map((c) => blocksToText(c.blocks).replace(/\n/g, ' ')).join(' | ')).join('\n');
    default: return '';
  }
}

/** Plain text of a model: lists with markers and two-space indentation, table cells joined by ' | '. */
export function blocksToText(blocks, depth = 0) {
  return blocks.map((b) => blockText(b, depth)).filter((text) => text !== '').join('\n');
}

/** Cuts text to the Excel cell limit and appends how many characters were cut. */
export function truncateCell(text, limit = EXCEL_CELL_LIMIT) {
  if (text.length <= limit) return text;
  let cut = limit - 16;
  if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut -= 1;
  return `${text.slice(0, cut)} …[+${text.length - cut}]`;
}
```

(The nested-list case in `blocksToText`: the inner list is rendered at `depth + 1`, so its own lines carry the extra indentation; the expected string in the test is `'Intro\n• a\n  1. b\nx | y'`.)

`src/core/tableGrid.js`:

```js
const filler = () => ({ origin: true, filler: true, colspan: 1, rowspan: 1, cell: { header: false, colspan: 1, rowspan: 1, blocks: [] } });

/** Places a model table on a rectangular grid: origin slots hold cells, covered slots say where the span came from. */
export function tableGrid(table) {
  const grid = table.rows.map(() => []);
  table.rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c]) c += 1;
      const colspan = Math.max(1, cell.colspan ?? 1);
      const rowspan = Math.max(1, Math.min(cell.rowspan ?? 1, table.rows.length - r));
      for (let dr = 0; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) {
          grid[r + dr][c + dc] = dr === 0 && dc === 0
            ? { origin: true, cell, colspan, rowspan }
            : { origin: false, fromAbove: dr > 0, leading: dc === 0, colspan };
        }
      }
      c += colspan;
    }
  });
  const width = Math.max(1, ...grid.map((row) => row.length));
  return grid.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? filler()));
}
```

`src/core/media.js`:

```js
const RENDERED_ID = /\/(?:rest\/api\/[23]\/attachment\/(?:content|thumbnail)|secure\/attachment)\/(\d+)/g;

/** Maps ADF media nodes to the issue's attachment ids: by file name, then by position in the rendered HTML. */
export function createMediaResolver(attachments = [], renderedHtml = '') {
  const known = new Set(attachments.map((a) => String(a.id)));
  const byName = new Map();
  for (const a of attachments) {
    byName.set(a.filename, [...(byName.get(a.filename) ?? []), String(a.id)]);
  }
  const rendered = [...String(renderedHtml ?? '').matchAll(RENDERED_ID)].map((m) => m[1]);
  const used = new Set();
  return (attrs, index) => {
    const named = byName.get(attrs?.alt ?? '') ?? [];
    const candidate = named.find((id) => !used.has(id)) ?? rendered[index] ?? named[0];
    if (!candidate || !known.has(candidate)) return null;
    used.add(candidate);
    return candidate;
  };
}
```

If Task 3 found that `alt` is not the file name, swap the two strategies (`rendered[index] ?? named…`) and adjust the first two resolver tests accordingly, keeping the live-case test unchanged.

- [ ] **Step 4: Run** → PASS (including the live fixture cases).

- [ ] **Step 5: Commit** `REPORTS-7: Convert ADF to the document model with merged cells and attachment images` (same trailer).

### Task 7: Entry points, tag vocabulary, columns, built-in templates, fetch plan

**Model:** sonnet

**Files:**
- Create: `static/app/src/core/{entry.js,placeholders.js,columns.js,builtins.js,fetchPlan.js}`
- Test: `static/app/test/core/{entry.test.js,placeholders.test.js,columns.test.js,fetchPlan.test.js}`

**Interfaces:**
- Consumes: `resolveField`, `findByNames`, `findByCustomType` (Task 5); `docs/live-checks.md` §Contexts (Task 3) — if it names other extension fields than the ones below, add them as alternatives in `entryFromContext` and a test per alternative.
- Produces:
  - `entryFromContext(extension) → Entry`, `Entry = { kind: 'jql', jql, label? } | { kind: 'board', boardId } | { kind: 'sprint', sprintId, boardId? } | { kind: 'issue', key } | { kind: 'none' }`.
  - `jqlForEntry(entry) → string|null` (null for `board` and `none`), `withOrder(jql, order = 'ORDER BY key ASC') → string`, `entryLabel(entry) → string`.
  - `ISSUE_TAGS` (tag → field id), `ITEM_TAGS` (loop → tags), `RICH_TAGS` (scope → rich tag names), `DOC_TAGS`, `LOOPS` (scope → loop names), `FIELD_TAG` (regex), `checkTemplateTags(tags, { fieldNames }) → TagError[]`, `suggest(name, candidates) → string|null`, `flattenTags(tags) → string[]`. `Tag = { name, kind: 'value'|'loop'|'raw', children: Tag[] }`. `TagError = { kind: 'unknown-tag'|'unknown-field'|'not-rich', tag, suggestion? }`.
  - `PSEUDO_COLUMNS` (set of ids), `ROW_MODES = ['issue','worklog','comment']`, `resolveColumn(catalog, ref) → { ref, id, field: Field|null, pseudo: boolean, missing: boolean }`.
  - `BUILTINS: Template[]`, `builtinById(id)`; `Template = { id, builtin: true, format: 'xlsx', kind: 'columns', columns, rowMode, groupBy, summary } | { id, builtin: true, format: 'docx'|'pdf', kind: 'layout', layout: 'single'|'list'|'sprint'|'release' }`; saved templates add `{ scope, scopeId, name, … }`, custom Word templates are `{ format: 'docx', kind: 'docx', placeholders: Tag[] }`.
  - `planFetch(template, catalog) → { fields: string[], comments: boolean, worklogs: boolean, images: boolean, rendered: boolean, missing: string[] }`.

- [ ] **Step 1: Write the failing tests.**

`test/core/entry.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { entryFromContext, entryLabel, jqlForEntry, withOrder } from '../../src/core/entry.js';

describe('entryFromContext', () => {
  it('takes the JQL of the issue navigator', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', jql: 'project = RPT' })).toEqual({ kind: 'jql', jql: 'project = RPT' });
  });
  it('builds a key list when the navigator only passes issue keys', () => {
    expect(entryFromContext({ type: 'jira:issueNavigatorAction', issueKeys: ['RPT-1', 'bad key', 'rpt-2'] })).toEqual({ kind: 'jql', jql: 'key in (RPT-1, RPT-2)' });
  });
  it('reads board and backlog ids', () => {
    expect(entryFromContext({ type: 'jira:boardAction', board: { id: '7' } })).toEqual({ kind: 'board', boardId: 7 });
    expect(entryFromContext({ type: 'jira:backlogAction', board: { id: 7 } })).toEqual({ kind: 'board', boardId: 7 });
  });
  it('reads the sprint id', () => {
    expect(entryFromContext({ type: 'jira:sprintAction', sprint: { id: 12 }, board: { id: 7 } })).toEqual({ kind: 'sprint', sprintId: 12, boardId: 7 });
  });
  it('reads the issue key', () => {
    expect(entryFromContext({ type: 'jira:issueAction', issue: { key: 'RPT-9', id: '10009' } })).toEqual({ kind: 'issue', key: 'RPT-9' });
  });
  it('returns none for the global page and for malformed input', () => {
    expect(entryFromContext({ type: 'jira:globalPage' })).toEqual({ kind: 'none' });
    expect(entryFromContext({ type: 'jira:issueAction', issue: { key: 'x" OR 1=1' } })).toEqual({ kind: 'none' });
    expect(entryFromContext(undefined)).toEqual({ kind: 'none' });
  });
});

describe('jqlForEntry', () => {
  it('quotes issue keys and orders sprints by rank', () => {
    expect(jqlForEntry({ kind: 'issue', key: 'RPT-9' })).toBe('key = "RPT-9"');
    expect(jqlForEntry({ kind: 'sprint', sprintId: 12 })).toBe('sprint = 12 ORDER BY Rank ASC');
    expect(jqlForEntry({ kind: 'board', boardId: 7 })).toBeNull();
  });
});

describe('withOrder', () => {
  it('appends an order only when the JQL has none', () => {
    expect(withOrder('project = RPT')).toBe('project = RPT ORDER BY key ASC');
    expect(withOrder('project = RPT order by created DESC')).toBe('project = RPT order by created DESC');
  });
});

describe('entryLabel', () => {
  it('names entries for file names', () => {
    expect([entryLabel({ kind: 'issue', key: 'RPT-9' }), entryLabel({ kind: 'sprint', sprintId: 12 }), entryLabel({ kind: 'board', boardId: 7 }), entryLabel({ kind: 'jql', jql: 'x', label: 'My filter' }), entryLabel({ kind: 'jql', jql: 'x' })]).toEqual(['RPT-9', 'sprint-12', 'board-7', 'My filter', '']);
  });
});
```

`test/core/placeholders.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { checkTemplateTags, flattenTags, suggest } from '../../src/core/placeholders.js';

const v = (name) => ({ name, kind: 'value', children: [] });
const raw = (name) => ({ name, kind: 'raw', children: [] });
const loop = (name, ...children) => ({ name, kind: 'loop', children });

describe('checkTemplateTags', () => {
  it('accepts document tags, issue tags and loops in their scopes', () => {
    const tags = [v('jql'), v('summary'), loop('issues', v('key'), raw('description'), loop('comments', v('author'), raw('body'), v('key')), loop('assignee', v('assignee')))];
    expect(checkTemplateTags(tags)).toEqual([]);
  });
  it('suggests the closest tag for a typo', () => {
    expect(checkTemplateTags([loop('issues', v('summry'))])).toEqual([{ kind: 'unknown-tag', tag: 'summry', suggestion: 'summary' }]);
  });
  it('rejects a comment tag outside the comments loop', () => {
    expect(checkTemplateTags([v('body')])).toEqual([{ kind: 'unknown-tag', tag: 'body', suggestion: null }]);
  });
  it('rejects a rich tag on a plain field', () => {
    expect(checkTemplateTags([raw('summary')])).toEqual([{ kind: 'not-rich', tag: 'summary' }]);
  });
  it('checks custom field names against the site fields', () => {
    expect(checkTemplateTags([v('field "Story Points"'), v('field "Storypoints"')], { fieldNames: ['Story Points'] })).toEqual([
      { kind: 'unknown-field', tag: 'field "Storypoints"', suggestion: 'Story Points' },
    ]);
  });
});

describe('suggest', () => {
  it('returns the nearest name within two edits, else null', () => {
    expect(suggest('asignee', ['assignee', 'status'])).toBe('assignee');
    expect(suggest('xyz', ['assignee', 'status'])).toBeNull();
  });
});

describe('flattenTags', () => {
  it('lists every tag name at any depth', () => {
    expect(flattenTags([v('jql'), loop('issues', v('key'), loop('comments', raw('body')))])).toEqual(['jql', 'issues', 'key', 'comments', 'body']);
  });
});
```

`test/core/columns.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { resolveColumn } from '../../src/core/columns.js';

const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string', system: 'summary' } },
  { id: 'customfield_10016', name: 'Story point estimate', custom: true, schema: { type: 'number' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
]);

describe('resolveColumn', () => {
  it('keeps pseudo-columns as they are', () => {
    expect(resolveColumn(catalog, 'worklog.hours')).toEqual({ ref: 'worklog.hours', id: 'worklog.hours', field: null, pseudo: true, missing: false });
  });
  it('resolves a field by name', () => {
    expect(resolveColumn(catalog, 'summary').id).toBe('summary');
  });
  it('resolves story points and sprint by their well-known names and types', () => {
    expect(resolveColumn(catalog, '@storyPoints').id).toBe('customfield_10016');
    expect(resolveColumn(catalog, '@sprint').id).toBe('customfield_10020');
  });
  it('marks a field that is not on the site as missing', () => {
    expect(resolveColumn(catalog, 'customfield_99999')).toEqual({ ref: 'customfield_99999', id: 'customfield_99999', field: null, pseudo: false, missing: true });
  });
});
```

`test/core/fetchPlan.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { BUILTINS, builtinById } from '../../src/core/builtins.js';
import { planFetch } from '../../src/core/fetchPlan.js';

const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string' } },
  { id: 'labels', name: 'Labels', schema: { type: 'array' } },
  { id: 'customfield_10016', name: 'Story Points', custom: true, schema: { type: 'number' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
]);
const BASE = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'project'];

describe('BUILTINS', () => {
  it('has four Excel column sets and four layouts for each of Word and PDF', () => {
    expect(BUILTINS.map((b) => b.id)).toEqual([
      'xlsx-issues', 'xlsx-worklogs', 'xlsx-comments', 'xlsx-sprint',
      'docx-single', 'docx-list', 'docx-sprint', 'docx-release',
      'pdf-single', 'pdf-list', 'pdf-sprint', 'pdf-release',
    ]);
  });
});

describe('planFetch', () => {
  it('reads only the columns of an Excel template plus the base fields', () => {
    const plan = planFetch({ format: 'xlsx', kind: 'columns', columns: ['key', 'labels', 'customfield_99999'], rowMode: 'issue', groupBy: null, summary: false }, catalog);
    expect(plan).toEqual({ fields: [...BASE, 'labels'], comments: false, worklogs: false, images: false, rendered: false, missing: ['customfield_99999'] });
  });
  it('reads worklogs for the worklog row mode', () => {
    const plan = planFetch(builtinById('xlsx-worklogs'), catalog);
    expect(plan.worklogs).toBe(true);
    expect(plan.fields).toContain('worklog');
  });
  it('reads the group-by field', () => {
    expect(planFetch({ format: 'xlsx', kind: 'columns', columns: ['key'], rowMode: 'issue', groupBy: 'labels', summary: true }, catalog).fields).toContain('labels');
  });
  it('reads everything a built-in layout shows, with images and rendered fields', () => {
    const plan = planFetch(builtinById('docx-sprint'), catalog);
    expect(plan).toMatchObject({ comments: true, images: true, rendered: true, worklogs: false });
    expect(plan.fields).toEqual(expect.arrayContaining(['description', 'attachment', 'comment', 'subtasks', 'issuelinks', 'customfield_10016', 'customfield_10020']));
  });
  it('derives fields and reads from the tags of a custom Word template', () => {
    const tags = [{ name: 'issues', kind: 'loop', children: [
      { name: 'summary', kind: 'value', children: [] },
      { name: 'field "Story Points"', kind: 'value', children: [] },
      { name: 'description', kind: 'raw', children: [] },
      { name: 'worklogs', kind: 'loop', children: [{ name: 'hours', kind: 'value', children: [] }] },
    ] }];
    const plan = planFetch({ format: 'docx', kind: 'docx', placeholders: tags }, catalog);
    expect(plan).toEqual({
      fields: [...BASE, 'customfield_10016', 'description', 'attachment', 'worklog'],
      comments: false, worklogs: true, images: true, rendered: true, missing: [],
    });
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`src/core/entry.js`:

```js
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function navigatorEntry(extension) {
  if (typeof extension.jql === 'string' && extension.jql.trim()) {
    return { kind: 'jql', jql: extension.jql.trim() };
  }
  const keys = (extension.issueKeys ?? extension.issues?.map((i) => i?.key) ?? [])
    .filter((k) => typeof k === 'string' && KEY.test(k))
    .map((k) => k.toUpperCase());
  return keys.length ? { kind: 'jql', jql: `key in (${keys.join(', ')})` } : { kind: 'none' };
}

/** Starting point of an export from the module's context.extension. */
export function entryFromContext(extension) {
  const ext = extension ?? {};
  switch (ext.type) {
    case 'jira:issueNavigatorAction': return navigatorEntry(ext);
    case 'jira:boardAction': case 'jira:backlogAction': {
      const boardId = idOf(ext.board?.id ?? ext.boardId);
      return boardId ? { kind: 'board', boardId } : { kind: 'none' };
    }
    case 'jira:sprintAction': {
      const sprintId = idOf(ext.sprint?.id ?? ext.sprintId);
      const boardId = idOf(ext.board?.id ?? ext.boardId);
      if (!sprintId) return { kind: 'none' };
      return boardId ? { kind: 'sprint', sprintId, boardId } : { kind: 'sprint', sprintId };
    }
    case 'jira:issueAction': {
      const key = ext.issue?.key;
      return typeof key === 'string' && KEY.test(key) ? { kind: 'issue', key: key.toUpperCase() } : { kind: 'none' };
    }
    default: return { kind: 'none' };
  }
}

/** Appends an ORDER BY clause when the JQL has none. */
export function withOrder(jql, order = 'ORDER BY key ASC') {
  return /\border\s+by\b/i.test(jql) ? jql : `${jql} ${order}`;
}

/** JQL of an entry; null when it must be looked up (board) or typed by the user (none). */
export function jqlForEntry(entry) {
  if (entry.kind === 'jql') return entry.jql;
  if (entry.kind === 'issue') return `key = "${entry.key}"`;
  if (entry.kind === 'sprint') return `sprint = ${entry.sprintId} ORDER BY Rank ASC`;
  return null;
}

/** Short name of an entry for the {filter} token of file names. */
export function entryLabel(entry) {
  if (entry.kind === 'issue') return entry.key;
  if (entry.kind === 'sprint') return `sprint-${entry.sprintId}`;
  if (entry.kind === 'board') return `board-${entry.boardId}`;
  return entry.label ?? '';
}
```

`src/core/placeholders.js`:

```js
/** Issue tags and the Jira field each one reads; null means computed. */
export const ISSUE_TAGS = {
  key: null, url: null, summary: 'summary', status: 'status', assignee: 'assignee', reporter: 'reporter',
  priority: 'priority', type: 'issuetype', due: 'duedate', created: 'created', updated: 'updated',
  resolved: 'resolutiondate', resolution: 'resolution', labels: 'labels', components: 'components',
  fixVersions: 'fixVersions', project: 'project', parent: 'parent', description: 'description',
  environment: 'environment', timeSpent: 'timespent', estimate: 'timeoriginalestimate',
};

/** Tags available inside each loop, besides the issue and document tags of outer scopes. */
export const ITEM_TAGS = {
  comments: ['author', 'created', 'body'],
  worklogs: ['author', 'started', 'timeSpent', 'hours', 'comment'],
  subtasks: ['key', 'summary', 'status', 'type', 'url'],
  links: ['type', 'direction', 'key', 'summary', 'status', 'url'],
};

/** Tags that may be used rich ({{@tag}}) per scope. */
export const RICH_TAGS = {
  root: ['description', 'environment'],
  issues: ['description', 'environment'],
  comments: ['body', 'description', 'environment'],
  worklogs: ['comment', 'description', 'environment'],
  subtasks: ['description', 'environment'],
  links: ['description', 'environment'],
};

/** Tags describing the export itself. */
export const DOC_TAGS = ['jql', 'exportedBy', 'exportedAt', 'count', 'title', 'siteUrl'];

/** Loops allowed in each scope. */
export const LOOPS = {
  root: ['issues', 'comments', 'worklogs', 'subtasks', 'links'],
  issues: ['comments', 'worklogs', 'subtasks', 'links'],
};

/** A custom-field tag: field "Name". */
export const FIELD_TAG = /^field\s+"([^"]+)"$/;

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** Nearest candidate within two edits, ignoring case; null when none is close. */
export function suggest(name, candidates) {
  let best = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = distance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

const allowedIn = (scope) => [...(ITEM_TAGS[scope] ?? []), ...Object.keys(ISSUE_TAGS), ...DOC_TAGS];

/** Checks template tags against the vocabulary of their scope; returns the errors found. */
export function checkTemplateTags(tags, { fieldNames = [] } = {}) {
  const errors = [];
  const known = new Set(fieldNames.map((n) => n.toLowerCase()));
  const walk = (list, scope) => list.forEach((tag) => visit(tag, scope));
  const visit = (tag, scope) => {
    const field = FIELD_TAG.exec(tag.name);
    if (field) {
      if (!known.has(field[1].toLowerCase())) {
        errors.push({ kind: 'unknown-field', tag: tag.name, suggestion: suggest(field[1], fieldNames) });
      }
      if (tag.kind === 'loop') walk(tag.children, scope);
      return;
    }
    if (tag.kind === 'loop' && (LOOPS[scope] ?? []).includes(tag.name)) {
      walk(tag.children, tag.name);
      return;
    }
    const allowed = allowedIn(scope);
    if (!allowed.includes(tag.name)) {
      errors.push({ kind: 'unknown-tag', tag: tag.name, suggestion: suggest(tag.name, allowed) });
      return;
    }
    if (tag.kind === 'raw' && !(RICH_TAGS[scope] ?? []).includes(tag.name)) {
      errors.push({ kind: 'not-rich', tag: tag.name });
      return;
    }
    if (tag.kind === 'loop') walk(tag.children, scope);
  };
  walk(tags, 'root');
  return errors;
}

/** Every tag name at any depth, in document order. */
export function flattenTags(tags) {
  return tags.flatMap((tag) => [tag.name, ...flattenTags(tag.children ?? [])]);
}
```

`src/core/columns.js`:

```js
import { findByCustomType, findByNames, resolveField } from './fields.js';

/** Columns that are not Jira fields. */
export const PSEUDO_COLUMNS = new Set([
  'key',
  'worklog.author', 'worklog.started', 'worklog.hours', 'worklog.comment',
  'comment.author', 'comment.created', 'comment.body',
]);

/** One row per issue, per worklog or per comment. */
export const ROW_MODES = ['issue', 'worklog', 'comment'];

const SPECIAL = {
  '@storyPoints': (catalog) => findByNames(catalog, ['Story Points', 'Story point estimate']),
  '@sprint': (catalog) => findByCustomType(catalog, 'com.pyxis.greenhopper.jira:gh-sprint'),
};

/** Resolves a template column reference to a Jira field or a pseudo-column; unknown fields are marked missing. */
export function resolveColumn(catalog, ref) {
  if (PSEUDO_COLUMNS.has(ref)) return { ref, id: ref, field: null, pseudo: true, missing: false };
  const field = SPECIAL[ref] ? SPECIAL[ref](catalog) : resolveField(catalog, ref);
  if (!field) return { ref, id: ref, field: null, pseudo: false, missing: true };
  return { ref, id: field.id, field, pseudo: false, missing: false };
}
```

`src/core/builtins.js`:

```js
const LAYOUTS = ['single', 'list', 'sprint', 'release'];

/** Built-in templates: four Excel column sets, four layouts for Word and the same four for PDF. */
export const BUILTINS = [
  { id: 'xlsx-issues', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'issue', groupBy: null, summary: true,
    columns: ['key', 'summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'duedate', 'labels', 'fixVersions', 'components', 'timeoriginalestimate', 'timespent'] },
  { id: 'xlsx-worklogs', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'worklog', groupBy: null, summary: false,
    columns: ['key', 'summary', 'worklog.author', 'worklog.started', 'worklog.hours', 'worklog.comment'] },
  { id: 'xlsx-comments', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'comment', groupBy: null, summary: false,
    columns: ['key', 'summary', 'comment.author', 'comment.created', 'comment.body'] },
  { id: 'xlsx-sprint', builtin: true, format: 'xlsx', kind: 'columns', rowMode: 'issue', groupBy: 'status', summary: true,
    columns: ['key', 'summary', 'issuetype', 'status', 'assignee', '@storyPoints', 'timeoriginalestimate', 'timespent', '@sprint'] },
  ...['docx', 'pdf'].flatMap((format) => LAYOUTS.map((layout) => ({ id: `${format}-${layout}`, builtin: true, format, kind: 'layout', layout }))),
];

/** Built-in template by id, or undefined. */
export function builtinById(id) {
  return BUILTINS.find((b) => b.id === id);
}
```

`src/core/fetchPlan.js`:

```js
import { resolveColumn } from './columns.js';
import { FIELD_TAG, ISSUE_TAGS } from './placeholders.js';
import { resolveField } from './fields.js';

const BASE = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'project'];
const LAYOUT_FIELDS = [
  'description', 'reporter', 'created', 'updated', 'duedate', 'labels', 'components', 'fixVersions',
  'resolution', 'attachment', 'subtasks', 'issuelinks', 'comment', 'parent', 'timeoriginalestimate', 'timespent',
];
const LOOP_FIELD = { comments: 'comment', worklogs: 'worklog', subtasks: 'subtasks', links: 'issuelinks' };
const RICH_FIELDS = new Set(['description', 'environment']);

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function planColumns(template, catalog) {
  const refs = [...template.columns, ...(template.groupBy ? [template.groupBy] : [])];
  const resolved = refs.map((ref) => resolveColumn(catalog, ref));
  const extra = template.rowMode === 'worklog' ? ['worklog'] : template.rowMode === 'comment' ? ['comment'] : [];
  return {
    fields: unique([...BASE, ...resolved.filter((c) => !c.pseudo && !c.missing).map((c) => c.id), ...extra]),
    comments: template.rowMode === 'comment',
    worklogs: template.rowMode === 'worklog',
    images: false,
    rendered: false,
    missing: resolved.filter((c) => c.missing).map((c) => c.ref),
  };
}

function planLayout(catalog) {
  const special = ['@storyPoints', '@sprint'].map((ref) => resolveColumn(catalog, ref)).filter((c) => !c.missing).map((c) => c.id);
  return { fields: unique([...BASE, ...LAYOUT_FIELDS, ...special]), comments: true, worklogs: false, images: true, rendered: true, missing: [] };
}

function planTags(tags, catalog) {
  const fields = [...BASE];
  const missing = [];
  const flags = { comments: false, worklogs: false, images: false };
  const walk = (list) => list.forEach((tag) => {
    const custom = FIELD_TAG.exec(tag.name);
    if (custom) {
      const field = resolveField(catalog, custom[1]);
      if (field) fields.push(field.id);
      else missing.push(custom[1]);
    } else if (LOOP_FIELD[tag.name]) {
      fields.push(LOOP_FIELD[tag.name]);
      if (tag.name === 'comments') flags.comments = true;
      if (tag.name === 'worklogs') flags.worklogs = true;
    } else if (ISSUE_TAGS[tag.name]) {
      fields.push(ISSUE_TAGS[tag.name]);
    }
    if (tag.kind === 'raw') {
      flags.images = true;
      fields.push('attachment');
      if (RICH_FIELDS.has(tag.name)) fields.push(tag.name);
    }
    walk(tag.children ?? []);
  });
  walk(tags);
  return { fields: unique(fields), ...flags, rendered: flags.images, missing };
}

/** What to read from Jira for a template: fields, extra comment/worklog reads, images, rendered HTML. */
export function planFetch(template, catalog) {
  if (template.kind === 'columns') return planColumns(template, catalog);
  if (template.kind === 'layout') return planLayout(catalog);
  return planTags(template.placeholders ?? [], catalog);
}
```

(`planTags` pushes `ISSUE_TAGS[tag.name]` before the `raw` branch, so `description` is added once by `unique`; the expected field order in the test is `[...BASE, 'customfield_10016', 'description', 'attachment', 'worklog']` — `summary` is already in BASE.)

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `REPORTS-8: Add entry points, the template tag vocabulary, built-in templates and the fetch plan` (same trailer).

### Task 8: Excel rows, groups, sheet names and the summary

**Model:** sonnet

**Files:**
- Create: `static/app/src/core/rows.js`
- Test: `static/app/test/core/rows.test.js`

**Interfaces:**
- Consumes: `resolveColumn` (Task 7), `cellValue`, `linkCell` (Task 5), `adfToModel`, `blocksToText`, `truncateCell` (Task 6).
- Produces:
  - `createRowBuilder({ template, catalog, siteUrl, labels }) → { columns: Column[], missing: string[], rowsFor(issue) → Array<{ group: string, cells: Cell[] }> }`, `Column = { id, header }`.
  - `createSummary(labels) → { add(issue), result() → { total, byStatus: [name, count][], byAssignee, byPriority } }`.
  - `sheetName(raw, taken: Set<lowercase>) → string`.
  - `assembleSheets({ columns, rows: Array<{ group, cells }>, grouped: boolean, summary: boolean, labels }) → { summarySheet: string|null, sheets: Array<{ name, columns, rows: Cell[][] }> }` (rows keep their input order; groups in order of first appearance).
  - `labels` keys used here: `column.key`, `column.worklog.author`, `column.worklog.started`, `column.worklog.hours`, `column.worklog.comment`, `column.comment.author`, `column.comment.created`, `column.comment.body`, `none`, `unassigned`, `sheet.issues`, `sheet.summary`.

- [ ] **Step 1: Write the failing test** `test/core/rows.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { assembleSheets, createRowBuilder, createSummary, sheetName } from '../../src/core/rows.js';

const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string', system: 'summary' } },
  { id: 'status', name: 'Status', schema: { type: 'status', system: 'status' } },
  { id: 'description', name: 'Description', schema: { type: 'string', system: 'description' } },
  { id: 'worklog', name: 'Log Work', schema: { type: 'array', system: 'worklog' } },
]);
const labels = {
  'column.key': 'Key', 'column.worklog.author': 'Author', 'column.worklog.started': 'Started', 'column.worklog.hours': 'Hours', 'column.worklog.comment': 'Comment',
  'column.comment.author': 'Author', 'column.comment.created': 'Created', 'column.comment.body': 'Comment',
  none: '(none)', unassigned: 'Unassigned', 'sheet.issues': 'Issues', 'sheet.summary': 'Summary',
};
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const issue = (key, fields) => ({ id: key, key, fields });

describe('createRowBuilder', () => {
  const site = 'https://s.atlassian.net';
  it('builds one row per issue with a key link and typed cells, dropping missing columns', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'summary', 'description', 'customfield_99999'], rowMode: 'issue', groupBy: null }, catalog, siteUrl: site, labels });
    expect(b.columns).toEqual([{ id: 'key', header: 'Key' }, { id: 'summary', header: 'Summary' }, { id: 'description', header: 'Description' }]);
    expect(b.missing).toEqual(['customfield_99999']);
    expect(b.rowsFor(issue('RPT-1', { summary: 'S', description: adf('D') }))).toEqual([{ group: '', cells: [
      { kind: 'link', value: `${site}/browse/RPT-1`, text: 'RPT-1' },
      { kind: 'text', value: 'S', text: 'S' },
      { kind: 'text', value: 'D', text: 'D' },
    ] }]);
  });
  it('builds one row per worklog and none for an issue without worklogs', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'worklog.author', 'worklog.started', 'worklog.hours', 'worklog.comment'], rowMode: 'worklog', groupBy: null }, catalog, siteUrl: site, labels });
    const rows = b.rowsFor(issue('RPT-1', { worklog: { total: 1, worklogs: [{ author: { displayName: 'Ann' }, started: '2026-09-29T10:00:00.000+0000', timeSpentSeconds: 5400, comment: adf('fix') }] } }));
    expect(rows[0].cells.slice(1)).toEqual([
      { kind: 'text', value: 'Ann', text: 'Ann' },
      { kind: 'datetime', value: new Date('2026-09-29T10:00:00.000Z'), text: '2026-09-29T10:00:00.000+0000' },
      { kind: 'number', value: 1.5, text: '1.5' },
      { kind: 'text', value: 'fix', text: 'fix' },
    ]);
    expect(b.rowsFor(issue('RPT-2', { worklog: { total: 0, worklogs: [] } }))).toEqual([]);
  });
  it('builds one row per comment', () => {
    const b = createRowBuilder({ template: { columns: ['key', 'comment.author', 'comment.body'], rowMode: 'comment', groupBy: null }, catalog, siteUrl: site, labels });
    const rows = b.rowsFor(issue('RPT-1', { comment: { total: 2, comments: [{ author: { displayName: 'A' }, body: adf('x') }, { author: { displayName: 'B' }, body: adf('y') }] } }));
    expect(rows.map((r) => r.cells[2].text)).toEqual(['x', 'y']);
  });
  it('groups by the text of the group field, empty values under (none)', () => {
    const b = createRowBuilder({ template: { columns: ['key'], rowMode: 'issue', groupBy: 'status' }, catalog, siteUrl: site, labels });
    expect(b.rowsFor(issue('RPT-1', { status: { name: 'Done' } }))[0].group).toBe('Done');
    expect(b.rowsFor(issue('RPT-2', {}))[0].group).toBe('(none)');
  });
  it('truncates text longer than the Excel cell limit', () => {
    const b = createRowBuilder({ template: { columns: ['summary'], rowMode: 'issue', groupBy: null }, catalog, siteUrl: site, labels });
    expect(b.rowsFor(issue('RPT-1', { summary: 'x'.repeat(40000) }))[0].cells[0].text.length).toBeLessThanOrEqual(32767);
  });
});

describe('createSummary', () => {
  it('counts by status, assignee and priority, largest first', () => {
    const s = createSummary(labels);
    s.add(issue('1', { status: { name: 'Done' }, assignee: { displayName: 'Ann' }, priority: { name: 'High' } }));
    s.add(issue('2', { status: { name: 'Done' } }));
    s.add(issue('3', { status: { name: 'Open' }, assignee: { displayName: 'Ann' } }));
    expect(s.result()).toEqual({
      total: 3,
      byStatus: [['Done', 2], ['Open', 1]],
      byAssignee: [['Ann', 2], ['Unassigned', 1]],
      byPriority: [['(none)', 2], ['High', 1]],
    });
  });
});

describe('sheetName', () => {
  it('replaces forbidden characters and keeps names unique ignoring case', () => {
    const taken = new Set();
    expect([sheetName('A/B', taken), sheetName('A-B', taken), sheetName('a-b', taken)]).toEqual(['A-B', 'A-B (2)', 'a-b (3)']);
  });
  it('limits names to 31 characters including the suffix', () => {
    const taken = new Set();
    sheetName('x'.repeat(40), taken);
    expect(sheetName('x'.repeat(40), taken)).toBe(`${'x'.repeat(27)} (2)`);
  });
  it('avoids the reserved name History and empty names', () => {
    const taken = new Set();
    expect([sheetName('History', taken), sheetName("''", taken)]).toEqual(['History (2)', 'Sheet']);
  });
});

describe('assembleSheets', () => {
  const columns = [{ id: 'key', header: 'Key' }];
  const cell = (t) => ({ kind: 'text', value: t, text: t });
  it('puts everything on one sheet after the summary sheet', () => {
    const out = assembleSheets({ columns, rows: [{ group: '', cells: [cell('a')] }], grouped: false, summary: true, labels });
    expect(out).toEqual({ summarySheet: 'Summary', sheets: [{ name: 'Issues', columns, rows: [[cell('a')]] }] });
  });
  it('makes one sheet per group in order of first appearance', () => {
    const out = assembleSheets({ columns, rows: [{ group: 'Open', cells: [cell('a')] }, { group: 'Done', cells: [cell('b')] }, { group: 'Open', cells: [cell('c')] }], grouped: true, summary: false, labels });
    expect(out.sheets.map((s) => [s.name, s.rows.length])).toEqual([['Open', 2], ['Done', 1]]);
    expect(out.summarySheet).toBeNull();
  });
  it('never gives a group the summary sheet name', () => {
    const out = assembleSheets({ columns, rows: [{ group: 'Summary', cells: [cell('a')] }], grouped: true, summary: true, labels });
    expect(out.sheets[0].name).toBe('Summary (2)');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/core/rows.js`:

```js
import { adfToModel, blocksToText, truncateCell } from './adf.js';
import { resolveColumn } from './columns.js';
import { cellValue, linkCell } from './fields.js';

const EMPTY = { kind: 'empty', value: null, text: '' };

function finish(cell) {
  if (cell.kind === 'adf') {
    const text = truncateCell(blocksToText(adfToModel(cell.value).blocks));
    return text ? { kind: 'text', value: text, text } : EMPTY;
  }
  if (cell.kind === 'text' && cell.text.length > 32767) {
    const text = truncateCell(cell.text);
    return { kind: 'text', value: text, text };
  }
  return cell;
}

const textOf = (value) => (value ? { kind: 'text', value, text: value } : EMPTY);
const adfText = (doc) => finish(cellValue(null, doc));
const hoursCell = (seconds) => {
  const value = Number(((seconds ?? 0) / 3600).toFixed(2));
  return { kind: 'number', value, text: String(value) };
};
const DATETIME = { type: 'datetime' };

const ITEM_CELLS = {
  'worklog.author': (w) => textOf(w.author?.displayName ?? ''),
  'worklog.started': (w) => cellValue(DATETIME, w.started),
  'worklog.hours': (w) => hoursCell(w.timeSpentSeconds),
  'worklog.comment': (w) => adfText(w.comment),
  'comment.author': (c) => textOf(c.author?.displayName ?? ''),
  'comment.created': (c) => cellValue(DATETIME, c.created),
  'comment.body': (c) => adfText(c.body),
};

/** Turns issues into Excel rows for a column template; unknown columns are dropped and reported. */
export function createRowBuilder({ template, catalog, siteUrl, labels }) {
  const resolved = template.columns.map((ref) => resolveColumn(catalog, ref));
  const kept = resolved.filter((c) => !c.missing);
  const group = template.groupBy ? resolveColumn(catalog, template.groupBy) : null;
  const columns = kept.map((c) => ({ id: c.id, header: c.pseudo ? labels[`column.${c.id}`] ?? c.id : c.field.name }));
  const issueCell = (issue, column) => {
    if (column.id === 'key') return linkCell(issue.key, `${siteUrl}/browse/${issue.key}`);
    return finish(cellValue(column.field, issue.fields?.[column.id]));
  };
  const groupOf = (issue) => {
    if (!group || group.missing) return '';
    return issueCell(issue, group).text || labels.none;
  };
  const items = (issue) => {
    if (template.rowMode === 'worklog') return issue.fields?.worklog?.worklogs ?? [];
    if (template.rowMode === 'comment') return issue.fields?.comment?.comments ?? [];
    return [null];
  };
  return {
    columns,
    missing: resolved.filter((c) => c.missing).map((c) => c.ref),
    rowsFor(issue) {
      const groupName = groupOf(issue);
      return items(issue).map((item) => ({
        group: groupName,
        cells: kept.map((c) => (ITEM_CELLS[c.id] ? (item ? ITEM_CELLS[c.id](item) : EMPTY) : issueCell(issue, c))),
      }));
    },
  };
}

function sorted(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Counts issues by status, assignee and priority for the summary sheet. */
export function createSummary(labels) {
  const byStatus = new Map();
  const byAssignee = new Map();
  const byPriority = new Map();
  let total = 0;
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  return {
    add(issue) {
      total += 1;
      bump(byStatus, issue.fields?.status?.name ?? labels.none);
      bump(byAssignee, issue.fields?.assignee?.displayName ?? labels.unassigned);
      bump(byPriority, issue.fields?.priority?.name ?? labels.none);
    },
    result() {
      return { total, byStatus: sorted(byStatus), byAssignee: sorted(byAssignee), byPriority: sorted(byPriority) };
    },
  };
}

function sliceUnits(text, max) {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** A valid, unique Excel sheet name: no []:*?/\, no edge apostrophes, at most 31 characters, not History. */
export function sheetName(raw, taken) {
  const base = sliceUnits(String(raw ?? '').replace(/[[\]:*?/\\]/g, '-').replace(/^'+|'+$/g, '').trim(), 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
    const suffix = ` (${n})`;
    name = `${sliceUnits(base, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Splits rows into sheets (one, or one per group) after an optional summary sheet. */
export function assembleSheets({ columns, rows, grouped, summary, labels }) {
  const taken = new Set();
  const summarySheet = summary ? sheetName(labels['sheet.summary'], taken) : null;
  if (!grouped) {
    return { summarySheet, sheets: [{ name: sheetName(labels['sheet.issues'], taken), columns, rows: rows.map((r) => r.cells) }] };
  }
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row.cells);
  }
  return {
    summarySheet,
    sheets: [...groups.entries()].map(([group, groupRows]) => ({ name: sheetName(group, taken), columns, rows: groupRows })),
  };
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `REPORTS-9: Build Excel rows, groups, sheet names and the summary` (same trailer).

### Task 9: Prepared issues, built-in layouts, Word-template data

**Model:** opus

**Files:**
- Create: `static/app/src/core/{prepare.js,layouts.js,templateData.js}`
- Test: `static/app/test/core/{prepare.test.js,layouts.test.js,templateData.test.js}`; fixture builder `static/app/test/fixtures/issues.js` (`makeIssue(overrides)` returning a bulkfetch-shaped issue with every field the layouts read, including one description with a table, one image media node, two comments and one worklog)

**Interfaces:**
- Consumes: `adfToModel`, `blocksToText` (Task 6), `createMediaResolver` (Task 6), `cellValue` (Task 5), `resolveField`, `resolveColumn` (Tasks 5, 7).
- Produces:
  - `Formats = { date(d: Date) → string /* UTC calendar date */, dateTime(d: Date) → string /* local */ }` — built by the UI from `Intl`.
  - `prepareIssue(issue, { catalog, siteUrl, formats, fieldNames?: string[] }) → Prepared`:
    `Prepared = { id, key, url, summary, type, status, priority, assignee, reporter, created, updated, due, resolved, resolution, labels, components, fixVersions, project, parent, timeSpent, estimate, storyPoints, storyPointsValue: number|null, sprint, description: Block[], environment: Block[], comments: Array<{ author, created, blocks }>, worklogs: Array<{ author, started, seconds, hours, timeSpent, blocks }>, subtasks: Array<{ key, summary, status, type, url }>, links: Array<{ type, direction: 'outward'|'inward', key, summary, status, url }>, gallery: string[] /* image attachment ids not shown inline */, inlineImages: string[] /* attachment ids used by blocks */, fields: Record<fieldName, string>, warnings }` — every scalar is a display string (`''` when empty).
  - `imagesFor(template, prepared) → string[]` (single layout: inline + gallery; custom Word template: inline; other layouts: none).
  - `DocSpec = { paper: 'A4'|'LETTER', title, metaLines: string[], blocks: Block[] }`.
  - `buildLayout({ layout, issues: Prepared[], meta, labels, paper }) → DocSpec`; `meta = { jql, exportedBy, exportedAt /* display string */, count, title?, siteUrl, partial?: { done, total } }`.
  - `buildTemplateData({ issues: Prepared[], meta, toXml(blocks) → string }) → object` — root = document tags + the first issue's tags + `issues: [...]`; every rich tag X has a plain `X` and an `X__xml`.
  - Label keys (from the UI, already translated): `layout.type`, `layout.status`, `layout.priority`, `layout.assignee`, `layout.reporter`, `layout.created`, `layout.updated`, `layout.due`, `layout.labels`, `layout.components`, `layout.fixVersions`, `layout.description`, `layout.attachments`, `layout.subtasks`, `layout.links`, `layout.comments`, `layout.key`, `layout.summary`, `layout.count`, `layout.points`, `layout.total`, `layout.untitled`, `meta.jql`, `meta.exported`, `meta.count`, and the function `partialBanner(done, total) → string`.

- [ ] **Step 1: Also fix the fetch plan per layout.** In `src/core/fetchPlan.js` change `planLayout(catalog)` to `planLayout(template, catalog)` and set `comments`, `images` and `rendered` to `template.layout === 'single'`; in `planFetch` call `planLayout(template, catalog)`. In `test/core/fetchPlan.test.js` replace the layout test with two: `docx-single` → `{ comments: true, images: true, rendered: true }` and fields containing `description`, `attachment`, `comment`, `subtasks`, `issuelinks`, `customfield_10016`, `customfield_10020`; `pdf-sprint` → `{ comments: false, images: false, rendered: false }`.

- [ ] **Step 2: Write the failing tests.**

`test/core/prepare.test.js` must cover, each in its own `it`:
  - scalar fields become display strings through `formats` (`created` → `formats.dateTime`, `duedate` → `formats.date` with the UTC date, users/status/priority by name, `timespent` → `'1.5 h'`);
  - the description becomes blocks with the inline image resolved to the attachment id, and that id is in `inlineImages`, not in `gallery`;
  - a second PNG attachment not referenced inline is in `gallery`; a PDF attachment is in neither;
  - comments carry author, `formats.dateTime(created)` and blocks; the comment media resolver uses that comment's rendered body (`issue.renderedFields.comment.comments[i].body`);
  - worklogs carry `seconds`, `hours` (2 decimals) and `timeSpent` (Jira's text, e.g. `'1h 30m'`);
  - sub-tasks and both link directions (`outward` uses `type.outward`, `inward` uses `type.inward`);
  - story points and sprint come from `@storyPoints` / `@sprint` via `resolveColumn`, `storyPointsValue` is the number;
  - `fields` holds only the requested `fieldNames`, by name, `''` for an unknown name;
  - ADF warnings of all converted fields are collected in `warnings`;
  - `imagesFor` for `docx-single` = inline + gallery, for `pdf-list` = `[]`, for a custom Word template = inline only.

`test/core/layouts.test.js` (use two prepared issues built with `prepareIssue(makeIssue(...))` and identity-like labels such as `{ 'layout.description': 'Description', … }`):
  - `single`: first block is the heading `[{ text: 'RPT-1', link: '<site>/browse/RPT-1', bold: true }, { text: ' Summary one' }]`; the key/value table skips empty values; description section present; attachments section lists gallery images as image blocks; comments section has an author line `'Ann · <dateTime>'` in bold then the comment blocks; a `pageBreak` separates issue 1 and issue 2;
  - `list`: heading with `meta.title` (falls back to `layout.untitled`) and one table with header row `Key, Summary, Type, Status, Priority, Assignee, Due` plus one row per issue, key cells are links;
  - `sprint`: status table with one row per status in first-appearance order, counts and story-point sums, and a final total row; then one `heading` level 2 per status followed by its issue table;
  - `release`: one `heading` level 2 per issue type and a bullet list of `KEY summary` items;
  - `metaLines` equal `['JQL: project = RPT', 'Exported: <at> · Ann', 'Issues: 2']` for labels `meta.jql: 'JQL'`, `meta.exported: 'Exported'`, `meta.count: 'Issues'`;
  - with `meta.partial = { done: 1, total: 2 }` the first block is `{ type: 'panel', kind: 'warning', blocks: [{ type: 'para', runs: [{ text: partialBanner(1, 2) }] }] }`.

`test/core/templateData.test.js`:
  - root contains `jql`, `exportedBy`, `exportedAt`, `count`, `title`, `siteUrl`, the first issue's `key`/`summary`, and `issues` of length 2;
  - `description` is plain text and `description__xml` is `toXml(description blocks)` (use `toXml = (b) => \`<x n="${b.length}"/>\``);
  - comments have `author`, `created`, `body`, `body__xml`; worklogs have `author`, `started`, `timeSpent`, `hours`, `comment`, `comment__xml`;
  - `fields` is passed through;
  - with no issues the root has `issues: []` and no issue keys.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `src/core/prepare.js`:

```js
import { adfToModel, blocksToText } from './adf.js';
import { resolveColumn } from './columns.js';
import { cellValue, resolveField } from './fields.js';
import { createMediaResolver } from './media.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const DATETIME = { type: 'datetime' };

function display(cell, formats) {
  if (cell.kind === 'date') return formats.date(cell.value);
  if (cell.kind === 'datetime') return formats.dateTime(cell.value);
  if (cell.kind === 'adf') return blocksToText(adfToModel(cell.value).blocks);
  return cell.text;
}

function collectImages(blocks, into) {
  for (const b of blocks) {
    if (b.type === 'image' && b.attachmentId) into.add(b.attachmentId);
    collectImages(b.blocks ?? [], into);
    for (const item of b.items ?? []) collectImages(item.blocks, into);
    for (const row of b.rows ?? []) for (const cell of row.cells) collectImages(cell.blocks, into);
  }
}

function linkOf(link, siteUrl) {
  const outward = Boolean(link.outwardIssue);
  const other = link.outwardIssue ?? link.inwardIssue ?? {};
  return {
    type: (outward ? link.type?.outward : link.type?.inward) ?? '',
    direction: outward ? 'outward' : 'inward',
    key: other.key ?? '',
    summary: other.fields?.summary ?? '',
    status: other.fields?.status?.name ?? '',
    url: `${siteUrl}/browse/${other.key ?? ''}`,
  };
}

/** Turns a bulkfetch issue into display strings and document blocks for layouts and Word templates. */
export function prepareIssue(issue, { catalog, siteUrl, formats, fieldNames = [] }) {
  const f = issue.fields ?? {};
  const rendered = issue.renderedFields ?? {};
  const attachments = (f.attachment ?? []).map((a) => ({ id: String(a.id), filename: a.filename, mimeType: a.mimeType }));
  const warnings = [];
  const inline = new Set();
  const convert = (doc, html) => {
    if (!doc) return [];
    const result = adfToModel(doc, { resolveMedia: createMediaResolver(attachments, html), formatDate: (ms) => formats.date(new Date(ms)) });
    warnings.push(...result.warnings);
    collectImages(result.blocks, inline);
    return result.blocks;
  };
  const text = (id) => (id ? display(cellValue(catalog.byId.get(id) ?? null, f[id]), formats) : '');
  const when = (raw) => display(cellValue(DATETIME, raw), formats);
  const points = resolveColumn(catalog, '@storyPoints');
  const sprint = resolveColumn(catalog, '@sprint');
  const pointsRaw = points.missing ? null : f[points.id];
  const prepared = {
    id: String(issue.id),
    key: issue.key,
    url: `${siteUrl}/browse/${issue.key}`,
    summary: f.summary ?? '',
    type: text('issuetype'),
    status: text('status'),
    priority: text('priority'),
    assignee: text('assignee'),
    reporter: text('reporter'),
    created: text('created'),
    updated: text('updated'),
    due: text('duedate'),
    resolved: text('resolutiondate'),
    resolution: text('resolution'),
    labels: text('labels'),
    components: text('components'),
    fixVersions: text('fixVersions'),
    project: text('project'),
    parent: f.parent?.key ?? '',
    timeSpent: text('timespent'),
    estimate: text('timeoriginalestimate'),
    storyPoints: points.missing ? '' : text(points.id),
    storyPointsValue: typeof pointsRaw === 'number' ? pointsRaw : null,
    sprint: sprint.missing ? '' : text(sprint.id),
    description: convert(f.description, rendered.description),
    environment: convert(f.environment, rendered.environment),
    comments: (f.comment?.comments ?? []).map((c, i) => ({
      author: c.author?.displayName ?? '',
      created: when(c.created),
      blocks: convert(c.body, c.renderedBody ?? rendered.comment?.comments?.[i]?.body),
    })),
    worklogs: (f.worklog?.worklogs ?? []).map((w) => ({
      author: w.author?.displayName ?? '',
      started: when(w.started),
      seconds: w.timeSpentSeconds ?? 0,
      hours: Number(((w.timeSpentSeconds ?? 0) / 3600).toFixed(2)),
      timeSpent: w.timeSpent ?? '',
      blocks: convert(w.comment),
    })),
    subtasks: (f.subtasks ?? []).map((s) => ({
      key: s.key, summary: s.fields?.summary ?? '', status: s.fields?.status?.name ?? '', type: s.fields?.issuetype?.name ?? '', url: `${siteUrl}/browse/${s.key}`,
    })),
    links: (f.issuelinks ?? []).map((l) => linkOf(l, siteUrl)),
    fields: Object.fromEntries(fieldNames.map((name) => [name, text(resolveField(catalog, name)?.id)])),
    warnings,
  };
  prepared.inlineImages = [...inline];
  prepared.gallery = attachments.filter((a) => IMAGE_TYPES.has(a.mimeType) && !inline.has(a.id)).map((a) => a.id);
  return prepared;
}

/** Attachment ids a template will show for one prepared issue. */
export function imagesFor(template, prepared) {
  if (template.kind === 'layout') return template.layout === 'single' ? [...prepared.inlineImages, ...prepared.gallery] : [];
  if (template.kind === 'docx') return prepared.inlineImages;
  return [];
}
```

`src/core/layouts.js`:

```js
const para = (runs) => ({ type: 'para', runs: typeof runs === 'string' ? (runs ? [{ text: runs }] : []) : runs });
const heading = (level, runs) => ({ type: 'heading', level, runs: typeof runs === 'string' ? [{ text: runs }] : runs });
const keyRun = (issue) => [{ text: issue.key, link: issue.url, bold: true }];
const cellOf = (value, header) => ({
  header, colspan: 1, rowspan: 1,
  blocks: [para(typeof value === 'string' ? (value ? [{ text: value, ...(header ? { bold: true } : {}) }] : []) : value)],
});

function table(headers, rows) {
  return {
    type: 'table',
    header: true,
    rows: [{ cells: headers.map((h) => cellOf(h, true)) }, ...rows.map((r) => ({ cells: r.map((v) => cellOf(v, false)) }))],
  };
}

function keyValues(issue, labels) {
  const pairs = [
    ['layout.type', issue.type], ['layout.status', issue.status], ['layout.priority', issue.priority],
    ['layout.assignee', issue.assignee], ['layout.reporter', issue.reporter], ['layout.created', issue.created],
    ['layout.updated', issue.updated], ['layout.due', issue.due], ['layout.labels', issue.labels],
    ['layout.components', issue.components], ['layout.fixVersions', issue.fixVersions],
  ].filter(([, value]) => value);
  return {
    type: 'table',
    header: false,
    rows: pairs.map(([key, value]) => ({ cells: [cellOf([{ text: labels[key], bold: true }], false), cellOf(value, false)] })),
  };
}

function singleIssue(issue, labels) {
  const out = [heading(1, [...keyRun(issue), { text: ` ${issue.summary}` }]), keyValues(issue, labels)];
  if (issue.description.length) out.push(heading(2, labels['layout.description']), ...issue.description);
  if (issue.gallery.length) {
    out.push(heading(2, labels['layout.attachments']), ...issue.gallery.map((id) => ({ type: 'image', attachmentId: id, alt: '', width: null, height: null })));
  }
  if (issue.subtasks.length) {
    out.push(heading(2, labels['layout.subtasks']), table(
      [labels['layout.key'], labels['layout.summary'], labels['layout.status']],
      issue.subtasks.map((s) => [[{ text: s.key, link: s.url }], s.summary, s.status]),
    ));
  }
  if (issue.links.length) {
    out.push(heading(2, labels['layout.links']), table(
      [labels['layout.type'], labels['layout.key'], labels['layout.summary'], labels['layout.status']],
      issue.links.map((l) => [l.type, [{ text: l.key, link: l.url }], l.summary, l.status]),
    ));
  }
  if (issue.comments.length) {
    out.push(heading(2, labels['layout.comments']));
    for (const c of issue.comments) out.push(para([{ text: `${c.author} · ${c.created}`, bold: true }]), ...c.blocks);
  }
  return out;
}

function groupBy(issues, keyOf) {
  const groups = new Map();
  for (const issue of issues) {
    const key = keyOf(issue);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  return groups;
}

const sumPoints = (issues) => issues.reduce((sum, i) => sum + (i.storyPointsValue ?? 0), 0);
const fmt = (n) => String(Number(n.toFixed(2)));

function listLayout(issues, labels, title) {
  return [
    heading(1, title),
    table(
      ['layout.key', 'layout.summary', 'layout.type', 'layout.status', 'layout.priority', 'layout.assignee', 'layout.due'].map((k) => labels[k]),
      issues.map((i) => [keyRun(i), i.summary, i.type, i.status, i.priority, i.assignee, i.due]),
    ),
  ];
}

function sprintLayout(issues, labels, title) {
  const groups = groupBy(issues, (i) => i.status || labels['layout.untitled']);
  const statusRows = [...groups.entries()].map(([status, list]) => [status, String(list.length), fmt(sumPoints(list))]);
  const total = [[{ text: labels['layout.total'], bold: true }], String(issues.length), fmt(sumPoints(issues))];
  const out = [
    heading(1, title),
    para(`${labels['layout.count']}: ${issues.length}`),
    table([labels['layout.status'], labels['layout.count'], labels['layout.points']], [...statusRows, total]),
  ];
  for (const [status, list] of groups) {
    out.push(heading(2, status), table(
      [labels['layout.key'], labels['layout.summary'], labels['layout.assignee'], labels['layout.points']],
      list.map((i) => [keyRun(i), i.summary, i.assignee, i.storyPoints]),
    ));
  }
  return out;
}

function releaseLayout(issues, labels, title) {
  const out = [heading(1, title)];
  for (const [type, list] of groupBy(issues, (i) => i.type || labels['layout.untitled'])) {
    out.push(heading(2, type), {
      type: 'list', ordered: false, start: 1,
      items: list.map((i) => ({ blocks: [para([...keyRun(i), { text: ` ${i.summary}` }])] })),
    });
  }
  return out;
}

/** Document spec of a built-in Word/PDF layout: title, first-page meta lines and blocks. */
export function buildLayout({ layout, issues, meta, labels, paper }) {
  const fallback = labels['layout.untitled'];
  const titles = {
    single: meta.title || (issues.length === 1 ? `${issues[0].key} ${issues[0].summary}` : fallback),
    list: meta.title || fallback,
    sprint: meta.title || issues[0]?.sprint || fallback,
    release: meta.title || issues[0]?.fixVersions || fallback,
  };
  const title = titles[layout];
  const body = {
    single: () => issues.flatMap((issue, i) => [...(i > 0 ? [{ type: 'pageBreak' }] : []), ...singleIssue(issue, labels)]),
    list: () => listLayout(issues, labels, title),
    sprint: () => sprintLayout(issues, labels, title),
    release: () => releaseLayout(issues, labels, title),
  }[layout]();
  const banner = meta.partial
    ? [{ type: 'panel', kind: 'warning', blocks: [para(labels.partialBanner(meta.partial.done, meta.partial.total))] }]
    : [];
  return {
    paper,
    title,
    metaLines: [
      `${labels['meta.jql']}: ${meta.jql}`,
      `${labels['meta.exported']}: ${meta.exportedAt} · ${meta.exportedBy}`,
      `${labels['meta.count']}: ${meta.count}`,
    ],
    blocks: [...banner, ...body],
  };
}
```

`src/core/templateData.js`:

```js
import { blocksToText } from './adf.js';

function rich(name, blocks, toXml) {
  return { [name]: blocksToText(blocks), [`${name}__xml`]: toXml(blocks) };
}

function issueData(p, toXml) {
  return {
    key: p.key, url: p.url, summary: p.summary, status: p.status, assignee: p.assignee, reporter: p.reporter,
    priority: p.priority, type: p.type, due: p.due, created: p.created, updated: p.updated, resolved: p.resolved,
    resolution: p.resolution, labels: p.labels, components: p.components, fixVersions: p.fixVersions,
    project: p.project, parent: p.parent, timeSpent: p.timeSpent, estimate: p.estimate,
    ...rich('description', p.description, toXml),
    ...rich('environment', p.environment, toXml),
    fields: p.fields,
    comments: p.comments.map((c) => ({ author: c.author, created: c.created, ...rich('body', c.blocks, toXml) })),
    worklogs: p.worklogs.map((w) => ({ author: w.author, started: w.started, timeSpent: w.timeSpent, hours: w.hours, ...rich('comment', w.blocks, toXml) })),
    subtasks: p.subtasks,
    links: p.links,
  };
}

/** Data for a customer Word template: document tags, the first issue at the root, and all issues under `issues`. */
export function buildTemplateData({ issues, meta, toXml }) {
  const list = issues.map((p) => issueData(p, toXml));
  return {
    ...(list[0] ?? {}),
    jql: meta.jql, exportedBy: meta.exportedBy, exportedAt: meta.exportedAt, count: meta.count,
    title: meta.title ?? '', siteUrl: meta.siteUrl,
    issues: list,
  };
}
```

- [ ] **Step 5: Run** → PASS (fetchPlan, prepare, layouts, templateData).

- [ ] **Step 6: Commit** `REPORTS-10: Prepare issues for documents and build the four layouts and Word-template data` (same trailer).

### Task 10: Jira client, pool, bridge adapter, download

**Model:** opus

**Files:**
- Create: `static/app/src/infra/{pool.js,jira.js,bridge.js,download.js}`
- Test: `static/app/test/infra/{pool.test.js,jira.test.js,download.test.js}`; helper `static/app/test/fixtures/fakeJira.js`

**Interfaces:**
- Consumes: limits (Task 4).
- Produces:
  - `createPool(concurrency) → run(fn) → Promise` (copy of Export).
  - `JiraError(status, path, messages: string[])` with `.status`, `.messages`.
  - `createJiraClient({ request, sleep, signal?, onRetry?, concurrency?, mediaConcurrency? })` → `{ searchIds(jql, { limit? }) → string[], approximateCount(jql) → number, bulkFetch(ids, { fields, expand? }) → { issues, errors }, listComments(issueId) → comment[], listWorklogs(issueId) → worklog[], getFields() → raw fields, getMyself() → { accountId, displayName }, boardJql(boardId) → { jql, name }, sprintName(sprintId) → string, searchFilters(query) → Array<{ id, name, jql }>, attachmentBytes(id) → ArrayBuffer, attachmentThumbnail(id) → ArrayBuffer }`. `request(path, init)` has the `requestJira` contract and returns a fetch `Response`.
  - `createBridgeClient({ signal, onRetry }) → client` over `requestJira`.
  - `saveBlob(fileName, blob, doc = document)` (copy of Export).

- [ ] **Step 1: Copy** `apps/export/static/app/src/infra/pool.js`, `download.js` (drop `exportFileName`, it is replaced by `core/filename.js`) and their tests (`pool.test.js`, `download.test.js` without the `exportFileName` cases).

- [ ] **Step 2: Fake Jira** `test/fixtures/fakeJira.js`:

```js
/** Fake requestJira: routes map "METHOD path-prefix" to handlers returning { status, body, headers } or throwing. */
export function fakeJira(routes) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const request = async (path, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    if (!key) throw new Error(`no route for ${method} ${path}`);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      const out = await routes[key]({ path, body, attempt: calls.filter((c) => c.path === path).length });
      const headers = new Map(Object.entries(out.headers ?? {}));
      return {
        ok: out.status >= 200 && out.status < 300,
        status: out.status,
        headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
        json: async () => out.body,
        arrayBuffer: async () => out.bytes ?? new ArrayBuffer(0),
      };
    } finally {
      inFlight -= 1;
    }
  };
  return { request, calls, maxInFlight: () => maxInFlight };
}
```

- [ ] **Step 3: Write the failing test** `test/infra/jira.test.js`, one `it` per behaviour, with `sleep = vi.fn(async () => {})`:
  - `searchIds` sends `{ jql, fields: ['id'], maxResults: 5000 }`, follows `nextPageToken` over two pages and returns ids as strings in order;
  - `searchIds` with `limit: 3` asks for `maxResults: 3` and returns 3 ids;
  - `searchIds` throws `JiraError` with status 508 when a page repeats a token it has already seen;
  - a 400 response throws `JiraError` with `status: 400` and `messages` = `errorMessages` + `Object.values(errors)` of the body, and is not retried;
  - a 429 with `retry-after: 2` is retried after `sleep(2000)`, `onRetry` is called with `{ status: 429, path }`, and the second answer is returned;
  - a 503 is retried with backoff 1 s, 2 s, 4 s, 8 s, 16 s (`sleep` calls) and after the 6th attempt throws `JiraError(503)`;
  - a rejected `request` (network) is retried and after the 6th attempt throws `JiraError` with status 0;
  - an `AbortError` thrown by `request` is rethrown at once; an already aborted `signal` throws `AbortError` before any request;
  - `bulkFetch` posts `{ issueIdsOrKeys, fields, expand, fieldsByKeys: false }` to `/rest/api/3/issue/bulkfetch` and returns `{ issues, errors: issueErrors }`;
  - `listComments` pages `startAt=0,100,…` with `maxResults=100&expand=renderedBody` until `total`;
  - `listWorklogs` pages `startAt` with `maxResults=5000` until `total`;
  - `boardJql(7)` reads `/rest/agile/1.0/board/7/configuration`, then `/rest/api/3/filter/<filter.id>`, returns `{ jql, name }`;
  - `searchFilters('bugs')` calls `/rest/api/3/filter/search?filterName=bugs&expand=jql&maxResults=50` and maps `values`;
  - with 20 parallel `bulkFetch` calls at most 6 are in flight; with 30 parallel `attachmentBytes` calls at most 12 are in flight;
  - `attachmentBytes('10001')` GETs `/rest/api/3/attachment/content/10001` and returns the `ArrayBuffer`; `attachmentThumbnail('10001')` GETs `/rest/api/3/attachment/thumbnail/10001`.

- [ ] **Step 4: Run** → FAIL.

- [ ] **Step 5: Implement** `src/infra/jira.js`:

```js
import { ID_PAGE, ISSUE_CONCURRENCY, MAX_ATTEMPTS, MEDIA_CONCURRENCY } from '../core/limits.js';
import { createPool } from './pool.js';

const MAX_RETRY_AFTER_S = 120;
const MAX_BACKOFF_S = 30;
const MAX_PAGES = 1000;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/** Jira REST failure with its HTTP status (0 = network) and Jira's error messages. */
export class JiraError extends Error {
  constructor(status, path, messages = []) {
    super(`jira ${status} ${path}`);
    this.name = 'JiraError';
    this.status = status;
    this.messages = messages;
  }
}

async function messagesOf(response) {
  try {
    const body = await response.json();
    return [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].map(String);
  } catch {
    return [];
  }
}

const backoff = (attempt) => Math.min(MAX_BACKOFF_S, 2 ** attempt) * 1000;

/** Jira REST client over a requestJira-like function: two pools (issues, media), retries on 429/5xx/network, cancellation. */
export function createJiraClient({ request, sleep, signal, onRetry = () => {}, concurrency = ISSUE_CONCURRENCY, mediaConcurrency = MEDIA_CONCURRENCY }) {
  const runIssue = createPool(concurrency);
  const runMedia = createPool(mediaConcurrency);
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const send = (run, path, init, parse) => run(async () => {
    for (let attempt = 0; ; attempt += 1) {
      checkAbort();
      let response;
      try {
        response = await request(path, init);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (attempt >= MAX_ATTEMPTS - 1) throw new JiraError(0, path);
        onRetry({ status: 0, path });
        await sleep(backoff(attempt));
        continue;
      }
      if (response.ok) return parse(response);
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt >= MAX_ATTEMPTS - 1) throw new JiraError(response.status, path, await messagesOf(response));
      onRetry({ status: response.status, path });
      const header = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(header) && header > 0 ? Math.min(MAX_RETRY_AFTER_S, header) * 1000 : backoff(attempt));
    }
  });
  const getJson = (path) => send(runIssue, path, { headers: { Accept: 'application/json' } }, (r) => r.json());
  const postJson = (path, body) => send(runIssue, path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, (r) => r.json());
  const bytes = (path) => send(runMedia, path, { headers: {} }, (r) => r.arrayBuffer());
  const paged = async (base, key, size) => {
    const out = [];
    for (let startAt = 0, pages = 0; ; pages += 1) {
      if (pages >= MAX_PAGES) throw new JiraError(508, base);
      const sep = base.includes('?') ? '&' : '?';
      const page = await getJson(`${base}${sep}startAt=${startAt}&maxResults=${size}`);
      const items = page[key] ?? [];
      out.push(...items);
      startAt += items.length;
      if (items.length === 0 || startAt >= (page.total ?? 0)) return out;
    }
  };
  return {
    async searchIds(jql, { limit = Infinity } = {}) {
      const ids = [];
      const seen = new Set();
      let token;
      do {
        if (seen.size >= MAX_PAGES || (token && seen.has(token))) throw new JiraError(508, '/rest/api/3/search/jql');
        if (token) seen.add(token);
        const page = await postJson('/rest/api/3/search/jql', {
          jql, fields: ['id'], maxResults: Math.min(ID_PAGE, limit - ids.length), ...(token ? { nextPageToken: token } : {}),
        });
        ids.push(...(page.issues ?? []).map((x) => String(x.id)));
        token = page.nextPageToken;
      } while (token && ids.length < limit);
      return ids.slice(0, limit);
    },
    async approximateCount(jql) {
      return (await postJson('/rest/api/3/search/approximate-count', { jql })).count ?? 0;
    },
    async bulkFetch(ids, { fields, expand = [] }) {
      const page = await postJson('/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: ids, fields, expand, fieldsByKeys: false });
      return { issues: page.issues ?? [], errors: page.issueErrors ?? [] };
    },
    listComments: (issueId) => paged(`/rest/api/3/issue/${encodeURIComponent(issueId)}/comment?expand=renderedBody`, 'comments', 100),
    listWorklogs: (issueId) => paged(`/rest/api/3/issue/${encodeURIComponent(issueId)}/worklog`, 'worklogs', 5000),
    getFields: () => getJson('/rest/api/3/field'),
    async getMyself() {
      const me = await getJson('/rest/api/3/myself');
      return { accountId: me.accountId, displayName: me.displayName };
    },
    async boardJql(boardId) {
      const config = await getJson(`/rest/agile/1.0/board/${Number(boardId)}/configuration`);
      const filter = await getJson(`/rest/api/3/filter/${Number(config.filter?.id)}`);
      return { jql: filter.jql, name: config.name ?? '' };
    },
    async sprintName(sprintId) {
      return (await getJson(`/rest/agile/1.0/sprint/${Number(sprintId)}`)).name ?? '';
    },
    async searchFilters(query) {
      const page = await getJson(`/rest/api/3/filter/search?filterName=${encodeURIComponent(query)}&expand=jql&maxResults=50`);
      return (page.values ?? []).map((f) => ({ id: String(f.id), name: f.name, jql: f.jql ?? '' }));
    },
    attachmentBytes: (id) => bytes(`/rest/api/3/attachment/content/${encodeURIComponent(id)}`),
    attachmentThumbnail: (id) => bytes(`/rest/api/3/attachment/thumbnail/${encodeURIComponent(id)}`),
  };
}
```

`src/infra/bridge.js`:

```js
import { requestJira } from '@forge/bridge';
import { createJiraClient } from './jira.js';

/** Backoff wait that ends early when `signal` aborts, so a cancelled run leaves no timers behind. */
function abortableSleep(signal) {
  return (ms) => new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Jira client over the Forge bridge, acting as the current user. */
export function createBridgeClient({ signal, onRetry } = {}) {
  return createJiraClient({ request: requestJira, sleep: abortableSleep(signal), signal, onRetry });
}
```

- [ ] **Step 6: Run** → PASS.

- [ ] **Step 7: Commit** `REPORTS-11: Add the Jira client with issue and media pools, retries and cancellation` (same trailer).

### Task 11: Excel renderer

**Model:** sonnet

**Files:**
- Create: `static/app/src/render/{palette.js,xlsx.js}`
- Test: `static/app/test/render/xlsx.test.js`

**Interfaces:**
- Consumes: `assembleSheets` output and `createSummary().result()` (Task 8); `Cell` kinds (Task 5).
- Produces:
  - `palette.js`: `PALETTE = { headerFill: 'F4F5F7', link: '0C66E4', rule: 'DCDFE4', codeFill: 'F7F8F9', panel: { info: 'E9F2FF', note: 'F3F0FF', warning: 'FFF7D6', error: 'FFECEB', success: 'DCFFF1' }, text: '172B4D' }` (hex without `#`; PDF adds `#`).
  - `renderXlsx({ assembled, summary: SummaryResult|null, meta, labels, ExcelJS, tzOffset?: (d: Date) → minutes }) → Promise<Uint8Array>`; `meta = { jql, exportedBy, exportedAt, now: Date, count, title?, partial? }`. Labels used: `summary.jql`, `summary.exportedAt`, `summary.exportedBy`, `summary.count`, `summary.byStatus`, `summary.byAssignee`, `summary.byPriority`, `summary.name`, `summary.issues`, and `partialBanner(done, total)`.

- [ ] **Step 1: Write the failing test** `test/render/xlsx.test.js` (renders, then reads back with `new ExcelJS.Workbook().xlsx.load(bytes)`), one `it` each:
  - data sheet: header row values equal the column headers, header cells bold with fill `FFF4F5F7`; `views[0]` is `{ state: 'frozen', ySplit: 1, … }`; `autoFilter` covers row 1 from column 1 to the last column;
  - a link cell reads back as `{ text: 'RPT-1', hyperlink: '<site>/browse/RPT-1' }`;
  - a `date` cell reads back as a `Date` equal to the UTC midnight and has `numFmt` `yyyy-mm-dd`;
  - a `datetime` cell with `tzOffset: () => -180` (UTC+3) reads back as the wall-clock time (10:15 for 07:15Z) with `numFmt` `yyyy-mm-dd hh:mm`;
  - a `duration` of 5400 s reads back as number `1.5` with `numFmt` `0.00`; a `percent` number has `numFmt` `0%`; an `empty` cell is `null`;
  - column widths are between 8 and 60 and follow the longest text among header and first 200 rows;
  - the summary sheet exists first, holds JQL, exported-at, exported-by and count rows, then three count tables with bold headers; with `summary: null` there is no summary sheet;
  - workbook properties: `creator` = exportedBy, `title` = title, `description` contains the JQL;
  - with `meta.partial = { done: 1, total: 2 }` the first row of the first sheet is the banner text;
  - 10 000 rows × 15 columns render in under 5 s in the test (sanity guard; the real bar is measured in Task 22).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/render/palette.js` (the object above, one JSDoc line) and `src/render/xlsx.js`:

```js
import { PALETTE } from './palette.js';

const FORMATS = { date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm', duration: '0.00' };
const argb = (hex) => `FF${hex}`;

function toValue(cell, tzOffset) {
  switch (cell.kind) {
    case 'empty': return null;
    case 'link': return { text: cell.text, hyperlink: cell.value };
    case 'datetime': return new Date(cell.value.getTime() - tzOffset(cell.value) * 60000);
    case 'duration': return Number((cell.value / 3600).toFixed(2));
    case 'date': case 'number': return cell.value;
    default: return cell.text;
  }
}

function widthOf(header, rows, index) {
  const sample = rows.slice(0, 200).map((r) => (r[index]?.text ?? '').split('\n')[0].length);
  return Math.min(60, Math.max(8, header.length + 2, ...sample.map((n) => n + 2)));
}

function styleHeader(row) {
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(PALETTE.headerFill) } };
  });
}

function addDataSheet(wb, sheet, { banner, tzOffset }) {
  const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: banner ? 2 : 1 }] });
  if (banner) ws.addRow([banner]).font = { bold: true, color: { argb: argb(PALETTE.text) } };
  const header = ws.addRow(sheet.columns.map((c) => c.header));
  styleHeader(header);
  sheet.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = widthOf(c.header, sheet.rows, i);
  });
  for (const cells of sheet.rows) {
    const row = ws.addRow(cells.map((c) => toValue(c, tzOffset)));
    cells.forEach((c, i) => {
      const target = row.getCell(i + 1);
      if (FORMATS[c.kind]) target.numFmt = FORMATS[c.kind];
      if (c.percent) target.numFmt = '0%';
      if (c.kind === 'link') target.font = { underline: true, color: { argb: argb(PALETTE.link) } };
    });
  }
  ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: sheet.columns.length } };
}

function addSummarySheet(wb, name, { summary, meta, labels, banner }) {
  const ws = wb.addWorksheet(name);
  if (banner) ws.addRow([banner]).font = { bold: true };
  ws.addRow([labels['summary.jql'], meta.jql]);
  ws.addRow([labels['summary.exportedAt'], meta.exportedAt]);
  ws.addRow([labels['summary.exportedBy'], meta.exportedBy]);
  ws.addRow([labels['summary.count'], meta.count]);
  for (const [key, pairs] of [['summary.byStatus', summary.byStatus], ['summary.byAssignee', summary.byAssignee], ['summary.byPriority', summary.byPriority]]) {
    ws.addRow([]);
    styleHeader(ws.addRow([labels[key], labels['summary.issues']]));
    for (const [label, count] of pairs) ws.addRow([label, count]);
  }
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 60;
}

/** Writes sheets and the optional summary sheet to .xlsx bytes: typed cells, links, frozen header, filter. */
export async function renderXlsx({ assembled, summary, meta, labels, ExcelJS, tzOffset = (d) => d.getTimezoneOffset() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.exportedBy;
  wb.created = meta.now;
  wb.title = meta.title ?? '';
  wb.description = `JQL: ${meta.jql}`;
  const banner = meta.partial ? labels.partialBanner(meta.partial.done, meta.partial.total) : null;
  if (assembled.summarySheet && summary) {
    addSummarySheet(wb, assembled.summarySheet, { summary, meta, labels, banner });
  }
  assembled.sheets.forEach((sheet, i) => addDataSheet(wb, sheet, { banner: i === 0 && !assembled.summarySheet ? banner : null, tzOffset }));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
```

(The frozen-header test uses `ySplit: 1` for the banner-less case; add a banner case asserting `ySplit: 2`.)

- [ ] **Step 4: Run** → PASS. Run `npm --prefix static/app audit --omit=dev --audit-level=high` → no findings.

- [ ] **Step 5: Commit** `REPORTS-12: Render Excel workbooks with typed cells, links, frozen header, filter and summary` (same trailer).

### Task 12: Word renderer for built-in layouts

**Model:** opus

**Files:**
- Create: `static/app/src/render/docx.js`
- Test: `static/app/test/render/docx.test.js`; helper `static/app/test/fixtures/images.js` (`pngBytes(w, h)` — a real decodable PNG, copy `png()` from `atlassian/tools/seed-jira-rpt.mjs` and return a `Uint8Array`)

**Interfaces:**
- Consumes: `DocSpec` (Task 9), `tableGrid` (Task 6), `readImageInfo`, `fitImage` (Task 4), `PALETTE` (Task 11).
- Produces:
  - `Images = Map<attachmentId, { bytes: Uint8Array, type: 'png'|'jpg'|'gif', width, height }>`.
  - `PAPER = { A4: { width: 11906, height: 16838 }, LETTER: { width: 12240, height: 15840 } }` (twips), `MARGIN = 1134`.
  - `buildDocxDocument({ spec, images, labels, meta, docx }) → docx.Document` (labels used: `imageUnavailable`).
  - `packDocx(document, docx) → Promise<Uint8Array>`.
  - `renderDocx(args) → Promise<Uint8Array>` = pack(build(args)).

- [ ] **Step 1: Write the failing test** `test/render/docx.test.js` — render with the real `docx` package, unzip with PizZip, assert on `word/document.xml`, `word/header*.xml`, `word/footer*.xml`, `word/numbering.xml`, `word/_rels/document.xml.rels`; one `it` each:
  - page size `<w:pgSz w:w="11906" w:h="16838"/>` for A4 and `w:w="12240" w:h="15840"` for LETTER; `<w:titlePg/>` present;
  - the first-page header contains every `metaLines` entry; the default header contains the title; a footer contains `PAGE` and `NUMPAGES` fields;
  - headings use `Heading1`/`Heading2` styles; bold/italic/strike/underline/code runs produce `<w:b/>`, `<w:i/>`, `<w:strike/>`, `<w:u `, `Consolas`;
  - a link run is an external hyperlink whose relationship target is the URL;
  - a bullet list produces paragraphs with `<w:numPr>` referencing a bullet numbering and nesting uses `<w:ilvl w:val="1"/>`; two separate ordered lists restart numbering (distinct `w:numId`);
  - a table with a header row has `<w:tblHeader/>` on that row; a colspan-2 cell has `<w:gridSpan w:val="2"/>`; a rowspan-2 cell produces `<w:vMerge w:val="restart"/>` and a continuation `<w:vMerge/>` in the next row;
  - a panel is a one-cell table shaded with `PALETTE.panel.warning`; a code block is shaded with `PALETTE.codeFill` and uses Consolas; a rule is a paragraph bottom border;
  - an image block with bytes produces `word/media/*.png`, a `<a:blip r:embed=` and an extent no wider than the content width (`(11906 - 2 × 1134) / 15` px → EMU); an image without bytes produces the italic text `[<imageUnavailable>: alt]`;
  - a `pageBreak` produces `<w:br w:type="page"/>`;
  - document core properties carry creator = `meta.exportedBy` and description containing the JQL;
  - a 500-issue `single` layout with one 320×200 PNG per issue packs in under 10 s (sanity guard).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/render/docx.js`. Required mapping (use these `docx` 9.8.1 APIs):
  - runs → `new TextRun({ text, bold, italics, strike, underline: run.underline ? {} : undefined, font: run.code ? 'Consolas' : undefined, color: run.color?.replace('#', ''), subScript: run.sub, superScript: run.sup })`; a `'\n'` inside `text` splits into several `TextRun`s where every one after the first has `break: 1`; a run with `link` becomes `new ExternalHyperlink({ link: run.link, children: [new TextRun({ text, style: 'Hyperlink' })] })`;
  - `para` → `new Paragraph({ children })`; `heading` → `new Paragraph({ heading: HeadingLevel[\`HEADING_${level}\`], children })`;
  - lists → one `Paragraph` per item's first `para` with `bullet: { level }` for bullets, or `numbering: { reference: 'artup-ordered', level, instance }` for ordered lists (a counter increments `instance` per ordered list so each restarts); the item's other blocks follow at `level + 1`; nesting depth capped at 8;
  - `table` → `new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })` built from `tableGrid`: an origin slot → `new TableCell({ columnSpan, rowSpan, children, shading: header ? { type: ShadingType.CLEAR, fill: PALETTE.headerFill } : undefined })`; a covered slot with `fromAbove && leading` → `new TableCell({ columnSpan: slot.colspan, verticalMerge: VerticalMergeType.CONTINUE, children: [new Paragraph('')] })` **only if** the test shows `docx` does not insert continuation cells for `rowSpan` by itself (check the XML of the rowspan test first with origin cells only; keep whichever variant yields exactly one `restart` and one continuation); other covered slots are skipped; the first row gets `tableHeader: true` when `table.header`; every cell has at least one paragraph;
  - `code` → one shaded `Paragraph` per line, Consolas, size 18 (9 pt); `quote` → paragraphs with `indent: { left: 567 }` and a left border; `panel` → one-cell table with `PALETTE.panel[kind] ?? PALETTE.panel.info`; `rule` → `new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PALETTE.rule } } })`; `pageBreak` → `new Paragraph({ children: [new PageBreak()] })`;
  - `image` → look up `images.get(attachmentId)`; if present, `fitImage` to `contentWidthPx = (paper.width - 2 * MARGIN) / 15` and emit `new Paragraph({ children: [new ImageRun({ type, data: bytes, transformation: { width, height } })] })`; otherwise an italic `TextRun` with `[${labels.imageUnavailable}: ${alt}]`;
  - document → `new Document({ creator: meta.exportedBy, title: spec.title, description: \`JQL: ${meta.jql}\`, numbering: { config: [{ reference: 'artup-ordered', levels: 0..8 → { level, format: LevelFormat.DECIMAL, text: \`%${level + 1}.\`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } } }] }, sections: [{ properties: { titlePage: true, page: { size: PAPER[spec.paper], margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } }, headers: { first: new Header({ children: metaLines as small grey paragraphs }), default: new Header({ children: [title paragraph] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] })] })] }), first: same footer }, children }] })`;
  - `packDocx`: `docx.Packer.toArrayBuffer` when it exists, else `(await docx.Packer.toBlob(doc)).arrayBuffer()`; return `new Uint8Array(...)`. Confirm in the test that it works in Node 22 (jsdom environment off: put `// @vitest-environment node` at the top of the test file).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `REPORTS-13: Render built-in Word layouts with merged cells, repeated headers, images and page numbers` (same trailer).

### Task 13: PDF renderer, fonts, browser engine

**Model:** opus

**Files:**
- Create: `static/app/src/render/pdf.js`, `static/app/src/infra/{fonts.js,pdfEngine.js}`, `static/app/fonts/{NotoSans-Regular.ttf,NotoSans-Bold.ttf,NotoSansSC-Regular.otf,NotoSansSC-Bold.otf,NotoSansKR-Regular.otf,NotoSansKR-Bold.otf,OFL.txt}`
- Test: `static/app/test/render/pdf.test.js`; `static/app/test/fixtures/nodePdfEngine.js`; preview check in `static/app/preview/pdfProbe.html` + `static/app/scripts/pdf-probe.mjs`

**Interfaces:**
- Consumes: `DocSpec` (Task 9), `splitRuns` (Task 4), `tableGrid` (Task 6), `fitImage` (Task 4), `PALETTE` (Task 11), `Images` (Task 12).
- Produces:
  - `FAMILY = { latin: 'Sans', cjk: 'CJK', korean: 'KR' }`.
  - `buildPdfDefinition({ spec, images, labels, meta }) → { definition, scripts: Set<'latin'|'cjk'|'korean'>, emojiDropped: number }` — pure; images become `data:` URLs.
  - `FontFiles = { files: Record<fileName, Uint8Array>, families: Record<family, { normal: fileName, bold: fileName, italics: fileName, bolditalics: fileName }> }`.
  - `loadFonts(scripts) → Promise<FontFiles>` (browser, lazy per script; latin always).
  - `Engine = { render(definition, fonts: FontFiles) → Promise<Uint8Array> }`; `createBrowserPdfEngine() → Promise<Engine>`; test `createNodePdfEngine() → Engine`.
  - `renderPdf({ spec, images, labels, meta, engine, loadFonts }) → Promise<{ bytes, emojiDropped }>`.

- [ ] **Step 1: Fonts.** Download the static fonts (OFL) into `static/app/fonts/`:

```bash
cd apps/reports/static/app/fonts
curl -fsSLO https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf
curl -fsSLO https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf
curl -fsSLO https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
curl -fsSLO https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf
curl -fsSLO https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf
curl -fsSLO https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/KR/NotoSansKR-Bold.otf
curl -fsSL https://github.com/notofonts/noto-cjk/raw/main/Sans/LICENSE -o OFL.txt
ls -la
```

If a URL has moved, find the same static file in the same repository and record the URL used in the commit body. `atlassian/tools/g5/fonts/` holds the Latin and SC files the prototype used (proven with pdfmake 0.3.11). Note the total size in the commit body; the deploy in Task 22 proves Forge accepts it.

- [ ] **Step 2: Write the failing test** `test/render/pdf.test.js` (`// @vitest-environment node`):
  - definition: `pageSize` `'A4'` / `'LETTER'`, `pageMargins` `[57, 57, 57, 57]`, `defaultStyle.font` `'Sans'`;
  - a paragraph `'Report 報告 한국 👍'` becomes text runs with fonts `Sans`, `CJK`, `KR` and no emoji; `emojiDropped` = 1; `scripts` = `{latin, cjk, korean}`;
  - bold/italic/strike/underline/link runs map to `bold`, `italics`, `decoration: 'lineThrough' | 'underline'`, `link`;
  - headings map to styles `h1`…`h6` defined in `definition.styles`;
  - a table uses `tableGrid`: origin cells carry `colSpan`/`rowSpan`, covered slots are `{}`; `headerRows: 1` when `table.header`; body rows all have the same length;
  - bullet and ordered lists map to `ul` / `ol` with nested lists inside `stack`s; `start` is kept for `ol`;
  - an image with bytes → `{ image: 'data:image/png;base64,…', width }` with width ≤ content width `(595.28 − 114)`; without bytes → italic text `[<imageUnavailable>: alt]`;
  - `header(1)` returns the meta lines, `header(2)` the title; `footer(3, 7)` returns text `'3 / 7'`;
  - a `pageBreak` block yields `pageBreak: 'before'` on the next node;
  - rendering through `createNodePdfEngine()` with the real fonts returns bytes starting with `%PDF`; text extracted with `pdfjs-dist` (dev dependency, `pdfjs-dist/legacy/build/pdf.mjs`) contains `Report`, `報告`, `한국` and `отчёт`.

`test/fixtures/nodePdfEngine.js` uses the Node entry of pdfmake like the prototype (`atlassian/tools/measure-reports-xg5.mjs` `buildPdf`): write each `fonts.files` entry to a temp dir, `pdfmake.setFonts` with those paths, `setLocalAccessPolicy` limited to the temp dir, `setUrlAccessPolicy(() => false)`, `createPdf(definition).getBuffer()`.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `src/render/pdf.js` — the same block mapping as Task 12 expressed as pdfmake nodes: runs via `splitRuns` → `{ text, font: FAMILY[script], bold, italics, decoration, link, color }` (emoji runs dropped and counted, `'\n'` kept inside text), `para` → `{ text: runs, margin: [0, 2, 0, 2] }`, `heading` → `{ text: runs, style: 'h<level>' }`, `list` → `ul`/`ol` (`start`), `table` → `{ table: { headerRows, widths: Array(width).fill('*'), body }, margin: [0, 4, 0, 4] }` with header cells `fillColor: '#' + PALETTE.headerFill`, `code` → one-cell table `fillColor: '#' + PALETTE.codeFill`, `fontSize: 8`, `quote` → `{ stack, margin: [16, 2, 0, 2] }`, `panel` → one-cell table with `PALETTE.panel[kind]`, `rule` → `{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.5, lineColor: '#' + PALETTE.rule }] }`, `image` → base64 data URL (`btoa` over chunks of 32 KB of `String.fromCharCode`, so it runs in the browser and in Node) with `width` from `fitImage` in points (px × 0.75), `pageBreak` → sets `pageBreak: 'before'` on the next node. `header` / `footer` are functions as in the tests; styles `h1`…`h6` sizes 18, 15, 13, 12, 11, 10, bold. `renderPdf` = build → `loadFonts(scripts)` → `engine.render(definition, fonts)`.

`src/infra/fonts.js`:

```js
const SOURCES = {
  latin: { family: 'Sans', normal: ['NotoSans-Regular.ttf', () => import('../../fonts/NotoSans-Regular.ttf?inline')], bold: ['NotoSans-Bold.ttf', () => import('../../fonts/NotoSans-Bold.ttf?inline')] },
  cjk: { family: 'CJK', normal: ['NotoSansSC-Regular.otf', () => import('../../fonts/NotoSansSC-Regular.otf?inline')], bold: ['NotoSansSC-Bold.otf', () => import('../../fonts/NotoSansSC-Bold.otf?inline')] },
  korean: { family: 'KR', normal: ['NotoSansKR-Regular.otf', () => import('../../fonts/NotoSansKR-Regular.otf?inline')], bold: ['NotoSansKR-Bold.otf', () => import('../../fonts/NotoSansKR-Bold.otf?inline')] },
};

function bytesOfDataUrl(url) {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Loads the fonts for the scripts present (Latin always); CJK and Korean chunks are fetched only when needed. */
export async function loadFonts(scripts) {
  const wanted = ['latin', ...['cjk', 'korean'].filter((s) => scripts.has(s))];
  const files = {};
  const families = {};
  await Promise.all(wanted.map(async (script) => {
    const source = SOURCES[script];
    const [normal, bold] = await Promise.all([source.normal[1](), source.bold[1]()]);
    files[source.normal[0]] = bytesOfDataUrl(normal.default);
    files[source.bold[0]] = bytesOfDataUrl(bold.default);
    families[source.family] = { normal: source.normal[0], bold: source.bold[0], italics: source.normal[0], bolditalics: source.bold[0] };
  }));
  return { files, families };
}
```

`src/infra/pdfEngine.js`: `createBrowserPdfEngine()` dynamically imports `pdfmake/build/pdfmake.js` and returns `{ render(definition, fonts) }` that registers `fonts.files` into pdfmake's virtual file system and `fonts.families` as its fonts, then returns `new Uint8Array(await pdfMake.createPdf(definition).getBuffer())`. Read `node_modules/pdfmake/build/pdfmake.js` (search `addVirtualFileSystem`, `addFonts`, `virtualfs`) for the 0.3.11 method names before writing it; if the virtual file system wants base64 strings, convert the bytes.

- [ ] **Step 5: Browser proof.** `preview/pdfProbe.html` + a tiny module that builds a definition for `'Report 報告 한국 отчёт'`, calls `createBrowserPdfEngine()` and `loadFonts`, and writes `{ ok, size, head }` (first 4 bytes as text) to `document.title` as JSON. `scripts/pdf-probe.mjs` starts `vite --mode preview`, opens the page in Playwright Chromium, waits for the title and fails unless `ok && head === '%PDF'`. Add `"pdf-probe": "node scripts/pdf-probe.mjs"` to `static/app/package.json` and run it.

- [ ] **Step 6: Run** unit tests and `npm --prefix static/app run pdf-probe` → PASS.

- [ ] **Step 7: Commit** `REPORTS-14: Render PDF with per-script Noto fonts loaded on demand` (same trailer; body lists font URLs and sizes).

### Task 14: Customer Word templates — OOXML, rendering, inspection

**Model:** opus

**Files:**
- Create: `static/app/src/render/{ooxml.js,docxTemplate.js}`, `static/app/src/infra/templateInspect.js`
- Test: `static/app/test/render/{ooxml.test.js,docxTemplate.test.js}`, `static/app/test/infra/templateInspect.test.js`; helper `static/app/test/fixtures/makeDocx.js`

**Interfaces:**
- Consumes: `buildTemplateData` (Task 9), `checkTemplateTags`, `FIELD_TAG` (Task 7), `tableGrid` (Task 6), `fitImage` (Task 4), `PALETTE` (Task 11), `TEMPLATE_MAX_BYTES` (Task 4), `Images` (Task 12).
- Produces:
  - `escapeXml(text) → string`; `blocksToOoxml(blocks, { image(attachmentId) → { rId, cx, cy, n } | null, labels, contentWidthPx }) → string` — body-level XML (`<w:p>`/`<w:tbl>`), never empty (`<w:p/>` at least).
  - `createImageRegistry(images) → { ref(attachmentId) → { rId, cx, cy, n } | null, apply(zip) }` — `rId` = `rIdArtup<n>`, files `word/media/artup-<n>.<png|jpeg|gif>`.
  - `parseTag(tag) → { get(scope, context) }` — the docxtemplater parser.
  - `renderDocxTemplate({ template: Uint8Array, issues: Prepared[], meta, images, labels, PizZip, Docxtemplater }) → Uint8Array`.
  - `inspectTemplate(bytes, { fieldNames, PizZip, Docxtemplater, InspectModule }) → { tags: Tag[], errors: Array<{ kind: 'too-large'|'not-docx'|'syntax'|'unknown-tag'|'unknown-field'|'not-rich', tag?, suggestion?, detail? }> }`.

- [ ] **Step 1: Test helper** `test/fixtures/makeDocx.js` builds a minimal valid .docx with PizZip: `[Content_Types].xml` (Defaults rels/xml; Overrides for document, header1), `_rels/.rels`, `word/document.xml` wrapping the given `body` XML in `<w:document xmlns:w=… xmlns:r=… xmlns:wp=… xmlns:a=… xmlns:pic=…><w:body>…<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr></w:body></w:document>`, `word/header1.xml` with the given `header` XML, `word/_rels/document.xml.rels` with `rIdH` → `header1.xml`. Signature `makeDocx({ body, header = '<w:p/>' }) → Uint8Array`.

- [ ] **Step 2: Write the failing tests.**

`test/render/ooxml.test.js`:
  - `escapeXml('<a & "b">')` → `'&lt;a &amp; &quot;b&quot;&gt;'`;
  - a para with bold and link runs → `<w:p>` with `<w:b/>` and a `HYPERLINK "url"` field (`fldChar begin/separate/end`, `instrText`), no relationship needed;
  - a heading level 1 → bold run with `<w:sz w:val="32"/>` (size by level 32, 28, 26, 24, 22, 22);
  - a nested list → paragraphs prefixed `• ` / `1. ` with `<w:ind w:left="360"/>` and `720` for level 2;
  - a table with colspan/rowspan → `<w:tbl>` with `<w:gridSpan w:val="2"/>`, `<w:vMerge w:val="restart"/>`, `<w:vMerge/>`, every `<w:tc>` contains a `<w:p`;
  - code → Consolas runs with shading `PALETTE.codeFill`; image with a ref → `<w:drawing>` with `r:embed="rIdArtup1"` and `cx`/`cy` in EMU; image without ref → italic `[<imageUnavailable>: alt]`;
  - empty blocks → `'<w:p/>'`; text with `<`, `&` is escaped; `'\n'` inside a run → `<w:br/>`.

`test/render/docxTemplate.test.js` (`// @vitest-environment node`; issues from `prepareIssue(makeIssue(...))`):
  - a placeholder split across runs (`<w:r><w:t>{{sum</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>mary}}</w:t></w:r>`) renders the summary;
  - `{{#issues}}{{key}}{{/issues}}` inside one table row repeats the row per issue;
  - `{{@description}}` alone in a paragraph renders a `<w:tbl>` for the description table and an image: the zip gains `word/media/artup-1.png`, the rels file gains `Id="rIdArtup1"` with type `…/relationships/image`, `[Content_Types].xml` gains `<Default Extension="png" ContentType="image/png"/>` once;
  - plain `{{description}}` renders the plain text (no `<w:tbl>` inside a `<w:t>`);
  - `{{jql}}` in the header part renders the JQL;
  - `{{#assignee}}has{{/assignee}}` renders `has` for an assigned issue and nothing for an unassigned one;
  - `{{field "Story Points"}}` renders the value from `prepared.fields`;
  - `{{#issues}}{{#comments}}{{author}}: {{body}}{{/comments}}{{/issues}}` renders every comment;
  - the output opens with PizZip and `word/document.xml` contains no `{{`.

`test/infra/templateInspect.test.js`:
  - a valid template returns `tags` as `Tag` trees (`{ name: 'issues', kind: 'loop', children: [{ name: 'key', kind: 'value', children: [] }, { name: 'description', kind: 'raw', children: [] }] }`) and `errors: []`;
  - `{{#issues}}` without its closing tag → one error `{ kind: 'syntax', tag: 'issues', detail: <docxtemplater explanation> }`;
  - `{{@description}}` sharing a paragraph with other text → a `syntax` error for `description`;
  - `{{summry}}` → `{ kind: 'unknown-tag', tag: 'summry', suggestion: 'summary' }`;
  - bytes that are not a zip, or a zip without `word/document.xml` → `[{ kind: 'not-docx' }]`; more than `TEMPLATE_MAX_BYTES` → `[{ kind: 'too-large' }]` without parsing.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement.**
  - `ooxml.js`: pure string building. Paragraph `<w:p><w:pPr>…</w:pPr>runs</w:p>`; run `<w:r><w:rPr>…</w:rPr><w:t xml:space="preserve">text</w:t></w:r>`; links as `HYPERLINK` field codes; headings as bold runs sized by level; lists as prefixed paragraphs with `<w:ind w:left="${360 * (depth + 1)}"/>`; tables from `tableGrid` with `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>` single borders colour `PALETTE.rule`, header cells shaded `PALETTE.headerFill`, `<w:tblHeader/>` on a header row; images as inline drawing:

```js
const drawing = ({ rId, cx, cy, n }, alt) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${9000 + n}" name="artup-${n}" descr="${escapeXml(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${9000 + n}" name="artup-${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
```

    (EMU = px × 9525; `wp` and `r` namespaces are declared on `w:document` of every Word file.)
  - `docxTemplate.js`: `createImageRegistry(images)` allocates refs lazily (only images actually referenced), `apply(zip)` writes media files, appends `<Relationship Id="rIdArtup<n>" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/artup-<n>.<ext>"/>` before `</Relationships>` of `word/_rels/document.xml.rels`, and adds missing `<Default Extension=… ContentType=…/>` entries to `[Content_Types].xml`. `parseTag(tag)`: `'.'` → scope; `field "Name"` → `scope.fields?.[Name]`; dotted paths walk the scope; when the tag is rendered by the raw-XML module (`context.meta.part.module === 'rawxml'` — confirm the property name in `node_modules/docxtemplater/js/` before relying on it; the "plain `{{description}}` renders text" test proves it) read `<name>__xml` instead of `<name>`; return `undefined` when absent so docxtemplater looks in parent scopes. `renderDocxTemplate`: `zip = new PizZip(template)`; `registry = createImageRegistry(images)`; `toXml = (blocks) => blocksToOoxml(blocks, { image: registry.ref, labels, contentWidthPx: 600 })`; `data = buildTemplateData({ issues, meta, toXml })`; `new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' }, parser: parseTag, nullGetter: () => '' }).render(data)`; `registry.apply(zip)`; `return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })`.
  - `templateInspect.js`: size check first; `new PizZip(bytes)` in try/catch → `not-docx`; missing `word/document.xml` → `not-docx`; `new Docxtemplater(zip, { modules: [inspect], paragraphLoop: true, delimiters, parser: parseTag })` in try/catch — a `TemplateError` with `properties.errors` maps each to `{ kind: 'syntax', tag: e.properties.xtag ?? e.properties.id, detail: e.properties.explanation }`; otherwise convert `inspect.getStructuredTags()` (log one real structure in the test first and map `module === 'loop'` → `loop`, `module === 'rawxml'` → `raw`, others → `value`, `subparsed` → children) and append `checkTemplateTags(tags, { fieldNames })`. `InspectModule` is imported from `docxtemplater/js/inspect-module.js`.

- [ ] **Step 5: Run** → PASS.

- [ ] **Step 6: Commit** `REPORTS-15: Render customer Word templates with rich fields and images, and inspect them on upload` (same trailer).

### Task 15: Export pipeline — read, complete, images, build, retry, partial

**Model:** opus

**Files:**
- Create: `static/app/src/export/{errors.js,renderers.js,pipeline.js}`
- Test: `static/app/test/export/pipeline.test.js` (fake client + fake renderers; no library loading)

**Interfaces:**
- Consumes: everything in `core/*`, the client (Task 10), renderers (Tasks 11–14).
- Produces:
  - `ReportError(code, data)`; codes: `'no-jql'`, `'no-issues'`, `'too-many-for-document'` (`{ count, max }`), `'jql'` (`{ messages }`), `'network'` (`{ status }`), `'template-missing'`.
  - `loadRenderers() → { xlsx(input), docx(input), pdf(input), docxTemplate(input) }` — each dynamically imports its library and render module and returns `Uint8Array`.
  - `createExportRun({ client, entry, jql?, template, catalog, meta, labels, formats, renderers, clock, onProgress, signal, limit? })` → `{ start() → Promise<Outcome>, retryMissing() → Promise<Outcome>, buildPartial() → Promise<FileResult> }`.
    - `meta = { exportedBy, siteUrl, now: Date, exportedAt: string, title?, fileNamePattern?, paper }`.
    - `Outcome = { status: 'done', file: FileResult } | { status: 'incomplete', done: number, total: number, failedBatches: number }`.
    - `FileResult = { bytes: Uint8Array, fileName, mime, stats: { issues, total, skipped, seconds, retries, imagesMissing }, warnings: Array<{ kind, detail, issueKey? }> }`.
    - `onProgress({ phase: 'count'|'read'|'complete'|'images'|'build', done, total })`.

- [ ] **Step 1: Write the failing test** `test/export/pipeline.test.js` — a fake client built from in-memory issues (ids `1..N`, `bulkFetch` returns the requested ids, optional failure/skip injection), fake renderers returning `new Uint8Array([1])` and recording their input, `clock` returning 0 then 12.5; one `it` each:
  - an `issue` entry resolves `key = "RPT-9"`, a `sprint` entry `sprint = 12 ORDER BY Rank ASC`, a `board` entry calls `client.boardJql`, a `jql` entry adds `ORDER BY key ASC`; `none` without `jql` throws `ReportError('no-jql')`;
  - ids are read once, then `bulkFetch` is called in batches of 100 with `planFetch(template).fields` and `expand: ['renderedFields']` only when `plan.rendered`;
  - a `docx`/`pdf` run with `approximateCount` > 2 000 throws `ReportError('too-many-for-document', { count, max: 2000 })` before reading ids; `xlsx` never checks;
  - zero ids throw `ReportError('no-issues')`;
  - a 400 `JiraError` from the id search becomes `ReportError('jql', { messages })`;
  - issues come out in id order even when batches resolve out of order;
  - `issueErrors` count into `stats.skipped`, and `stats.total` is the id count;
  - an issue whose `comment.total` exceeds the embedded comments gets the full list via `listComments` when `plan.comments`; the same for worklogs via `listWorklogs`;
  - for xlsx the renderer receives `assembled` (from `createRowBuilder` + `assembleSheets`) and `summary` when the template asks for it, and raw issues are not kept after their rows are built (assert that the renderer input holds no `fields` objects);
  - for a `single` layout, images of `imagesFor` are downloaded once each (shared ids across issues fetched once), a 404 image counts in `stats.imagesMissing` and becomes a warning `{ kind: 'image-missing', detail: id, issueKey }`, and a non-image (unreadable bytes) is treated as missing;
  - when `attachmentBytes` fails with a non-404 status, `attachmentThumbnail` is tried before counting the image missing;
  - `onProgress` reports `read` with `done` rising to the id count, then `images`, then `build`;
  - `stats.retries` counts `onRetry` calls made through the client;
  - a batch failing after all retries (client throws `JiraError(503)`) makes `start()` resolve `{ status: 'incomplete', done: 100, total: 200, failedBatches: 1 }`; `retryMissing()` re-reads only that batch and resolves `done`; `buildPartial()` instead builds with `meta.partial = { done, total }` and a file name ending `-PARTIAL.<ext>`;
  - an abort during reading rejects with `AbortError` and no renderer is called;
  - the file name uses `renderFileName` with `{ project: <first issue's project key>, filter: entryLabel(entry) }` and the template's pattern; the mime types are `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `…wordprocessingml.document`, `application/pdf`;
  - warnings merge: missing columns (`{ kind: 'column-missing', detail: ref }`), ADF warnings with the issue key, emoji dropped in PDF (`{ kind: 'pdf-emoji', detail: String(n) }`), images missing.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `errors.js` (`ReportError extends Error` with `code`, `data`). `renderers.js`:

```js
/** Loads each format's library only when that format is used. */
export function loadRenderers() {
  return {
    async xlsx(input) {
      const [{ default: ExcelJS }, { renderXlsx }] = await Promise.all([import('exceljs'), import('../render/xlsx.js')]);
      return renderXlsx({ ...input, ExcelJS });
    },
    async docx(input) {
      const [docx, { renderDocx }] = await Promise.all([import('docx'), import('../render/docx.js')]);
      return renderDocx({ ...input, docx });
    },
    async pdf(input) {
      const [{ renderPdf }, { createBrowserPdfEngine }, { loadFonts }] = await Promise.all([
        import('../render/pdf.js'), import('../infra/pdfEngine.js'), import('../infra/fonts.js'),
      ]);
      return renderPdf({ ...input, engine: await createBrowserPdfEngine(), loadFonts });
    },
    async docxTemplate(input) {
      const [{ default: PizZip }, { default: Docxtemplater }, { renderDocxTemplate }] = await Promise.all([
        import('pizzip'), import('docxtemplater'), import('../render/docxTemplate.js'),
      ]);
      return renderDocxTemplate({ ...input, PizZip, Docxtemplater });
    },
  };
}
```

(`renderPdf` returns `{ bytes, emojiDropped }`; the pipeline unwraps it.)

`pipeline.js` structure (pure orchestration over injected dependencies; no `Date.now()` — time via `clock()`):
  1. `resolveJql()` — from `jql` argument, else `jqlForEntry(entry)`, else `client.boardJql` for boards; `withOrder` for plain JQL; `no-jql` otherwise.
  2. For docx/pdf: `approximateCount` → `too-many-for-document`.
  3. `searchIds` (map `JiraError` 400 → `jql`); empty → `no-issues`; `limit` argument caps ids (used by the preview).
  4. `plan = planFetch(template, catalog)`; batches of `BULK_BATCH`; each batch → `bulkFetch` through the client pool; on success, complete each issue (comments/worklogs when truncated and requested), then **consume** it immediately: xlsx → `rowBuilder.rowsFor(issue)` + `summary.add(issue)` stored at the batch's index; documents → `prepareIssue(issue, …)` stored at the index. A batch that throws a non-abort error is recorded in `failed` (index + ids) and the run continues.
  5. If `failed` is non-empty → return `incomplete`. `retryMissing()` repeats step 4 for failed batches only. `buildPartial()` builds from what is present.
  6. Images (documents): unique ids across `imagesFor(template, prepared)`; download through `client.attachmentBytes` (thumbnail fallback on non-404 failure); `readImageInfo` → `Images` map; unreadable or failed → missing.
  7. Build: xlsx → `assembleSheets` + `summary.result()` → `renderers.xlsx({ assembled, summary, meta, labels })`; built-in layouts → `buildLayout({ layout, issues, meta, labels, paper })` → `renderers.docx({ spec, images, labels, meta })` or `renderers.pdf(...)` (unwrap `{ bytes, emojiDropped }`); custom Word → `renderers.docxTemplate({ template: bytes, issues, meta, images, labels })`. `meta` is extended with `jql`, `count` (issues present) and `partial` when building a partial file.
  8. Return `FileResult` with `stats.seconds = (clock() - started) / 1000`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `REPORTS-16: Orchestrate exports with batch reads, completion, images, retries and partial files` (same trailer).

### Task 16: Template storage and permissions in the resolver

**Model:** opus

**Files:**
- Create: `apps/reports/src/templates/{validate.js,permissions.js,store.js}`
- Modify: `apps/reports/src/resolvers.js`
- Test: `apps/reports/test/{validate.test.js,permissions.test.js,store.test.js,resolvers.test.js}`

**Interfaces:**
- Consumes: KVS (`@forge/kvs`: `kvs.get/set/delete`, `kvs.query().where('key', WhereConditions.beginsWith(p)).limit(n).cursor(c).getMany()` → `{ results: [{ key, value }], nextCursor }`), `asUser().requestJira(route\`…\`)` from `@forge/api`.
- Produces resolver keys (all except `getAccess` reject with `'unlicensed'` when `decideLicence` says so):
  - `listTemplates({ projectKeys: string[] ≤ 20 }) → { user: Meta[], project: Meta[], site: Meta[] }` (project templates only for projects the user can browse);
  - `getScopes({ projectKeys }) → { site: boolean, projects: string[] }` (where the user may publish);
  - `saveTemplate({ template }) → Meta` (new: server sets `id`, `authorId`, `authorName` from the payload is ignored, `updatedAt`, `parts: 0`; existing: scope and scopeId cannot change);
  - `uploadTemplatePart({ id, index, total, data /* base64 */ }) → { stored: index }` (on the last part sets `parts`, `size`; deletes stale parts above `total`);
  - `getTemplatePart({ id, index }) → { data }`;
  - `deleteTemplate({ id }) → { deleted: true }`.
  - `Meta = { id, scope: 'user'|'project'|'site', scopeId, name, format: 'xlsx'|'docx'|'pdf', kind: 'columns'|'layout'|'docx', columns?, rowMode?, groupBy?, summary?, layout?, paper?, fileNamePattern?, placeholders?, parts, size, authorId, updatedAt }`.
  - Errors thrown as `new Error('forbidden' | 'not-found' | 'bad-request' | 'too-large' | 'unlicensed')`.

- [ ] **Step 1: Write the failing tests.**
  - `validate.test.js`: accepts a minimal columns template and a docx template; rejects (returns `'bad-request'`) an empty or > 80-character name, an unknown format/kind/scope/rowMode, more than 100 columns or a column ref > 200 characters, `placeholders` whose JSON exceeds 50 000 characters, a `fileNamePattern` > 200 characters, a project scope whose `scopeId` does not match `/^[A-Z][A-Z0-9_]+$/`, and unknown top-level keys (stripped, not rejected). Returns the cleaned metadata.
  - `permissions.test.js` (with a fake `fetchMyPermissions(keys, projectKey)`): user scope — view/manage only when `scopeId === accountId`; site — everyone views, `ADMINISTER` manages; project — `BROWSE_PROJECTS` views, `ADMINISTER_PROJECTS` manages; a failed permission call denies; results are cached per `(keys, projectKey)` within one checker.
  - `store.test.js` (in-memory fake KVS with prefix query and 2-page cursor): save → `tpl:user:<acc>:<id>` and `tplid:<id>`; list by scope prefix pages through the cursor; get by id; parts under `tplbin:<id>:<n>`; remove deletes meta, index and up to `TEMPLATE_MAX_PARTS` parts.
  - `resolvers.test.js` (mock `@forge/resolver`, `@forge/kvs`, `@forge/api`): the full matrix — personal CRUD by owner OK and by another user `forbidden`; project publish by project admin OK, by non-admin `forbidden`; site publish by Jira admin OK, else `forbidden`; `listTemplates` hides project templates of projects the user cannot browse; `uploadTemplatePart` rejects a part > 150 KB decoded (`too-large`), `index ≥ total`, `total > TEMPLATE_MAX_PARTS`, and a template whose `kind` is not `docx` (`bad-request`); `getTemplatePart` requires view permission; unlicensed production context rejects every template resolver with `unlicensed`; `saveTemplate` ignores a client-sent `authorId`.

- [ ] **Step 2: Run** `npx vitest run` in `apps/reports` → FAIL.

- [ ] **Step 3: Implement.** `permissions.js` exports `createPermissions({ accountId, fetchMyPermissions }) → { canView(meta), canManage(scope, scopeId) }`. `resolvers.js` wires `fetchMyPermissions` as:

```js
async function fetchMyPermissions(keys, projectKey) {
  const response = projectKey
    ? await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=${keys.join(',')}&projectKey=${projectKey}`)
    : await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=${keys.join(',')}`);
  if (!response.ok) return {};
  const body = await response.json();
  return Object.fromEntries(keys.map((k) => [k, body.permissions?.[k]?.havePermission === true]));
}
```

`store.js` exports `createTemplateStore({ kvs, beginsWith, newId })` with `list(scope, scopeId)`, `get(id)`, `save(meta)`, `remove(id)`, `putPart(id, n, data)`, `getPart(id, n)`, `removePartsFrom(id, n)`; `newId` is `crypto.randomUUID` in production. Size of a base64 part: `Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)`. Every resolver: licence check → validate input → permission check → store call; `context.accountId` is the only identity source.

- [ ] **Step 4: Run** → PASS; `npm run lint` → clean.

- [ ] **Step 5: Commit** `REPORTS-17: Store templates in KVS with personal, project and site permissions` (same trailer).

### Task 17: Visual foundation — icon, illustrations, shared components, preview harness

**Model:** sonnet

**Files:**
- Create (copy from `apps/export/static/app/src`, then adapt): `components/{AppHeader.jsx,ChoiceCard.jsx,PageLayout.jsx,StatTile.jsx,StepSection.jsx,icons.js}`, `illustrations/{AppIcon.jsx,EmptyIllustration.jsx,LockIllustration.jsx,SuccessIllustration.jsx,parts.jsx}`, new `illustrations/ReportIllustration.jsx`, `studio/AccessGate.jsx` → `app/AccessGate.jsx`, `studio/useAccess.js` → `app/useAccess.js`; `preview/{index.html,main.jsx,Gallery.jsx,bridgeMock.js,driver.js,fixtures.js}`; `resources/icon.svg`
- Test: `static/app/test/{components.test.jsx,preview.test.js}` (copied and adapted)

**Interfaces:**
- Produces: the same components and props as Export (`ChoiceCard({ icon, title, description, selected, onSelect, accent })`, `StepSection({ index, title, children })`, `StatTile({ label, value })`, `PageLayout({ header, aside, children })`, `AppHeader({ title, subtitle })`, `AccessGate({ children })`), `glyph()` in `icons.js` with the icons this app needs (`file-spreadsheet`/`table`, `page`, `pdf`-like document, `download`, `upload`, `drag-handle`, `delete`, `edit`, `filter`, `refresh`), `ReportIllustration` (a sheet + document motif built from `parts.jsx`, filled with tokens only). The preview harness renders every screen state from `fixtures.js` at `?screen=<name>&state=<state>&locale=<code>&theme=<light|dark>&width=<px>`.

- [ ] **Step 1:** Copy the files, rename Export-specific wording/keys to Reports (`app.*`), recolour `AppIcon` and `resources/icon.svg` to the Reports accent (token-based in JSX; the SVG resource uses the same two hex values as Export's icon but with the green→blue pair swapped for teal→blue — `resources/` is outside `src`, so hex is allowed there).
- [ ] **Step 2:** `components.test.jsx`: each component renders its props, `ChoiceCard` is a radio (`role="radio"`, `aria-checked`) and selectable by keyboard (Space/Enter), `AccessGate` shows the lock state for `unlicensed` with one action (retry) and renders children when licensed.
- [ ] **Step 3:** Preview harness: `bridgeMock.js` implements `invoke`, `requestJira` (served from `fixtures.js`: a 30-issue RPT-like data set with CJK and Cyrillic summaries), `view.getContext`, `view.theme.enable`; `preview.test.js` asserts every `screen/state` pair listed in `fixtures.js` renders without throwing.
- [ ] **Step 4:** Add i18n keys for all texts introduced here to all 26 locale files; run `npm --prefix static/app test` → PASS.
- [ ] **Step 5: Commit** `REPORTS-18: Add the visual foundation, icon and preview harness` (same trailer).

### Task 18: Export wizard

**Model:** opus

**Files:**
- Create: `static/app/src/wizard/{Wizard.jsx,SourceStep.jsx,FormatStep.jsx,TemplatePicker.jsx,ColumnsEditor.jsx,ExcelPreview.jsx,RunningView.jsx,ResultView.jsx,FailureView.jsx,WarningsTable.jsx,useWizardForm.js,useExportRun.js,useTemplates.js,useCatalog.js,labels.js}`
- Test: `static/app/test/wizard/{form.test.js,run.test.jsx,wizard.test.jsx,columns.test.jsx}`

**Interfaces:**
- Consumes: `createBridgeClient` (Task 10), `createExportRun`, `loadRenderers`, `ReportError` (Task 15), `BUILTINS` (Task 7), `buildFieldCatalog` (Task 5), `saveBlob` (Task 10), `renderFileName` (Task 4), resolvers `listTemplates`, `getTemplatePart` (Task 16), `useI18n` (Task 2), components (Task 17).
- Produces: `<Wizard entry={Entry} context={forgeContext} />` used by both apps; `labelsFor(t) → labels object` covering every label key of Tasks 8, 9, 11, 12, 13, 14 (including `partialBanner`), `formatsFor(locale) → Formats` (`date` with `timeZone: 'UTC'`, `dateTime` local, both `Intl.DateTimeFormat` medium styles).

Behaviour (each line is a test in `wizard.test.jsx` / `run.test.jsx`, driven through the preview-style bridge mock):

- [ ] **Step 1: Form state** `useWizardForm(entry)` — pure reducer tested in `form.test.js`: initial format `xlsx` (issue entry → `docx`); choosing a format selects its first built-in template; choosing a custom template copies its columns/groupBy/summary into the editable form without mutating the template; column add/remove/move; `paper` A4 default, LETTER when `navigator.language` is `en-US`/`en-CA` (injected); file-name pattern defaults to `DEFAULT_FILE_PATTERN`; `canStart` false when the entry is `none` and the JQL field is empty.
- [ ] **Step 2: Steps UI.**
  - `SourceStep` (global page only, entry `none`): JQL `TextArea` + "Saved filter" `Select` fed by `client.searchFilters` with debounce 300 ms; choosing a filter fills the JQL and remembers the filter name for `{filter}`; a JQL error from the run shows under the field (`ReportError('jql')` messages, verbatim).
  - `FormatStep`: three `ChoiceCard`s (Excel / Word / PDF) with one-sentence descriptions; Word/PDF show paper size radio (A4 / Letter).
  - `TemplatePicker`: grouped list — Built-in, My templates, Project, Site (from `listTemplates({ projectKeys })`, where project keys come from the entry: issue key prefix, the board's project via the first read, or none); for Word/PDF built-ins a static screenshot thumbnail (`preview/thumbs/<id>.png`, produced in Task 21) and name/description; custom Word templates are only offered for Word.
  - `ColumnsEditor` (Excel): field `Select` over the catalog (`useCatalog` → `client.getFields()` once per session, cached in a module variable) plus the pseudo-columns of the row mode; a vertical list of chosen columns reorderable by drag (`@atlaskit/pragmatic-drag-and-drop` `draggable`/`dropTargetForElements`, with a drag handle) **and** by keyboard (Alt+↑/↓ on the focused item, announced via `aria-live`); remove button per column; row mode radio (issue / worklog / comment); group-by `Select`; "Summary sheet" `Toggle`. `columns.test.jsx` covers keyboard reordering and removal.
  - `ExcelPreview`: runs `createExportRun` with `limit: PREVIEW_ISSUES` and a renderer that captures `assembled` instead of writing a file; shows the first sheet's header and ≤ 5 rows in `DynamicTable`, links as links, dates formatted; count "N issues match" from `approximateCount`. Shown for Excel only.
  - Primary button "Export" → running view.
- [ ] **Step 3: Run hook** `useExportRun` — owns an `AbortController`, builds the client with `onRetry`, calls `createExportRun`, exposes `{ state: 'idle'|'running'|'incomplete'|'done'|'failed', progress, outcome, error, start, cancel, retryMissing, downloadPartial, download }`. On `done` it calls `saveBlob` immediately (user gesture chain from the click) and keeps the Blob for "Download again". Loading a custom Word template reads its parts with `getTemplatePart` (0..parts−1, sequential) and joins them before starting. `run.test.jsx`: progress shown per phase with a determinate `ProgressBar`; cancel returns to the form with nothing downloaded; `incomplete` shows "N of M issues read" with "Retry missing" (primary) and "Download partial file"; `done` shows `StatTile`s (issues, seconds, skipped, images missing) and the warnings table; "Download again" re-saves the same Blob; `too-many-for-document` shows its message with a "Switch to Excel" action; `unlicensed` never starts a run.
  - `WarningsTable`: grouped by kind with translated kind names and counts, expandable to details (issue key + detail), paginated at 20 rows.
- [ ] **Step 4:** i18n keys for everything above in all 26 locales (including all `labelsFor` keys — they are also used inside files); `npm --prefix static/app test` → PASS.
- [ ] **Step 5:** Visual check through the preview harness (`?screen=wizard&state=form|form-excel|preview|running|incomplete|done|failed`) at 1280 and 800 px, light and dark, en-US and de-DE; fix anything that clips or overflows.
- [ ] **Step 6: Commit** `REPORTS-19: Add the export wizard with column editor, Excel preview, progress, retry and download` (same trailer).

### Task 19: Templates tab

**Model:** sonnet

**Files:**
- Create: `static/app/src/templates/{TemplatesTab.jsx,TemplatesTable.jsx,ExcelTemplateForm.jsx,DocxUploadForm.jsx,ScopePicker.jsx,DeleteDialog.jsx,useTemplateAdmin.js,upload.js}`
- Test: `static/app/test/templates/{upload.test.js,tab.test.jsx}`

**Interfaces:**
- Consumes: resolvers `listTemplates`, `getScopes`, `saveTemplate`, `uploadTemplatePart`, `deleteTemplate` (Task 16); `inspectTemplate` (Task 14); `ColumnsEditor`, `useCatalog` (Task 18); `TEMPLATE_PART_BYTES`, `TEMPLATE_MAX_BYTES` (Task 4).
- Produces: `<TemplatesTab context={…} />`; `splitParts(bytes, size) → string[]` (base64 parts) and `joinParts(parts) → Uint8Array` in `upload.js`.

- [ ] **Step 1: `upload.test.js`:** `splitParts` of 400 000 random bytes with 150 KB parts gives 3 base64 strings whose decoded sizes are 153 600, 153 600, 92 800; `joinParts(splitParts(x))` equals `x`; base64 encoding works on chunks (no call-stack overflow on 2 MB).
- [ ] **Step 2: UI:**
  - `TemplatesTable` (`DynamicTable`): name, format lozenge, scope ("Personal" / project key / "Site"), updated (Intl), author; row actions Edit / Delete only when `canManage` (from `getScopes`); empty state with `EmptyIllustration` + one sentence + "Create template".
  - `ExcelTemplateForm`: name, `ColumnsEditor`, row mode, group-by, summary toggle, file-name pattern `TextField` with a live example (`renderFileName` with sample values), `ScopePicker` (Personal always; Project — `Select` of projects from `GET /rest/api/3/project/search?action=edit&maxResults=50` via `requestJira`, filtered to `getScopes().projects`; Site — only if `getScopes().site`).
  - `DocxUploadForm`: drop zone (`<input type="file" accept=".docx">` styled with tokens, drag-over state), immediate `inspectTemplate` with the site's field names; errors listed as `SectionMessage` items with translated kind texts and the suggestion ("Did you mean {{summary}}?"); a collapsible "Available tags" reference generated from `ISSUE_TAGS`, `ITEM_TAGS`, `DOC_TAGS`; Save disabled while errors exist; saving = `saveTemplate` (with `placeholders` = inspected tags) → `uploadTemplatePart` for each part with a progress bar → reload list. A "Download example template" button saves the bundled `static/app/public/example-template.docx`. That file is generated once by `static/app/scripts/make-example-template.mjs` (the `docx` package writing literal `{{…}}` tags: a header with `{{jql}}` and `{{exportedAt}}`, a table row loop over `{{#issues}}`, a `{{@description}}` paragraph and a comments loop) and committed; a test inspects it with `inspectTemplate` and expects zero errors.
  - `DeleteDialog`: `@atlaskit/modal-dialog` confirm with the template name.
- [ ] **Step 3: `tab.test.jsx`:** list renders groups; a non-admin sees no Project/Site options; upload of a template with `{{summry}}` shows the suggestion and blocks Save; a valid upload calls `uploadTemplatePart` with `index` 0..n−1 and `total` n; delete asks for confirmation and calls `deleteTemplate`; resolver `forbidden` shows `errors.forbidden`.
- [ ] **Step 4:** i18n keys in all 26 locales; tests PASS; preview states `?screen=templates&state=empty|list|excel-form|docx-errors|docx-ok|deleting` checked at 1280/800, light/dark.
- [ ] **Step 5: Commit** `REPORTS-20: Add the templates tab with Excel column templates and Word template upload` (same trailer).

### Task 20: Entry points — global page and action modal

**Model:** sonnet

**Files:**
- Modify: `static/app/src/app/{GlobalApp.jsx,ActionApp.jsx}` (remove the development context probe)
- Test: `static/app/test/app/{global.test.jsx,action.test.jsx}`

**Interfaces:**
- Consumes: `entryFromContext` (Task 7), `Wizard` (Task 18), `TemplatesTab` (Task 19), `AccessGate` (Task 17), `docs/live-checks.md` §Contexts (Task 3).

- [ ] **Step 1:** `GlobalApp`: `AccessGate` → `PageLayout` with `AppHeader` and `@atlaskit/tabs` "Export" / "Templates"; Export renders `<Wizard entry={{ kind: 'none' }} />`, Templates renders `TemplatesTab`; the selected tab is kept in `localStorage` (try/catch).
- [ ] **Step 2:** `ActionApp`: `AccessGate` → `<Wizard entry={entryFromContext(context.extension)} />` in a compact layout (no tabs; width ≥ 600 px of the modal); a `none` entry (unknown context) shows an error state with one sentence and "Open ArtUp Reports" linking to the global page (`router.navigate` from `@forge/bridge` to the global page URL `/jira/apps/<appId>/<envId>` built from `context.localId` parts — check `docs/live-checks.md` for the exact route and record a Ruling if it differs); after a successful download the modal shows the result view and a "Close" button (`view.close()`).
- [ ] **Step 3:** Tests: each of the six extension shapes from `docs/live-checks.md` leads to the right entry label on screen; the global page switches tabs; production context without licence shows the lock state; no `<pre>` probe remains anywhere (grep test).
- [ ] **Step 4:** Build, tests PASS, deploy to development (commands as in Task 2 Step 6). Opening the entry points on the live site needs the owner's login, so it happens at checkpoint C1; after the owner's clicks, read `forge logs -e development` and fix any error found.
- [ ] **Step 5: Commit** `REPORTS-21: Wire the six entry points to the wizard and the templates tab` (same trailer).

### Task 21: Screenshot matrix, overflow probe, translation quality, template thumbnails

**Model:** sonnet

**Files:**
- Create: `static/app/scripts/{screenshots.mjs,contact-sheet.mjs}` (adapted from Export), `static/app/preview/thumbs/*.png` (8 layout thumbnails)
- Modify: locale files where the probe finds problems

- [ ] **Step 1:** Adapt `screenshots.mjs`: `MATRIX = { global: { states: ['export-form', 'export-excel', 'preview', 'running', 'incomplete', 'done', 'failed', 'templates-list', 'templates-empty', 'docx-errors', 'unlicensed'], widths: [1280, 800] }, action: { states: ['form', 'running', 'done', 'none'], widths: [1280, 800, 600] } }`, locales en-US, de-DE, ru-RU, ja-JP, fi-FI, zh-CN, themes light/dark; probe mode over all 26 locales reports any element whose `scrollWidth > clientWidth` or text clipped by `overflow: hidden`.
- [ ] **Step 2:** Run `npm run screenshots` → contact sheet `static/app/screenshots/index.html`; fix every overflow found (shorter translation or wrapping), rerun until the probe reports 0.
- [ ] **Step 3:** Translation pass: for each locale, a native-quality review of all keys (terminology consistent with Jira's own UI in that language: "Issue", "Sprint", "Board", "Backlog", "Filter"); record changed keys in the commit body.
- [ ] **Step 4:** Thumbnails: render each Word/PDF built-in from the preview fixture data to PDF (Node, Task 13 engine), rasterise page 1 at 400 px width with `pdftoppm` (install `poppler` with Homebrew if missing and note it), save as `preview/thumbs/<layout>.png` (Word and PDF share the layout thumbnail); `TemplatePicker` shows them.
- [ ] **Step 5: Commit** `REPORTS-22: Add the screenshot matrix, fix overflows and translations, add layout thumbnails` (same trailer).

### Task 22: Deploy, load acceptance on artuplabs-dev, template matrix

**Model:** sonnet

**Files:**
- Create: `apps/reports/scripts/{acceptance.mjs,synthetic.mjs,template-matrix.mjs}`, `atlassian/plans/2026-09-29-artup-reports-acceptance.md` (results section filled here)

- [ ] **Step 1: Acceptance script** `scripts/acceptance.mjs` runs the real `createExportRun` from `static/app/src` in Node 22 against `https://artuplabs-dev.atlassian.net` (basic auth from `.env`; a fetch adapter with the `requestJira` contract; renderers imported directly with Node libraries and the Node PDF engine of Task 13; `clock = performance.now`). Commands:
  - `xlsx --jql "project = RPT" --template xlsx-issues --out data/rpt-10k.xlsx` → must finish ≤ 60 s; prints seconds, retries, peak RSS (`process.memoryUsage().rss` sampled every 250 ms), file size; reads the file back and asserts 10 000 data rows and 10 000 hyperlinks.
  - `docx --jql "project = RPT AND attachments is not EMPTY" --limit 500 --template docx-single --out data/rpt-500.docx` → ≤ 120 s, images missing = 0.
  - `pdf` with the same 500 issues → ≤ 120 s; extracted text of page 1 contains a CJK summary.
  - `docx-template --template-file data/example.docx` with the example template of Task 19 on 100 issues → opens with PizZip, no `{{` left.
  - `xlsx --template xlsx-worklogs` and `xlsx-comments` on RPT → row counts equal the seeded 1 000 worklogs / 6 000 comments (± those added by live checks).
- [ ] **Step 2: Synthetic** `scripts/synthetic.mjs --issues 50000` builds 50 000 fake issues in memory (same field shapes as RPT, text in three scripts), runs `createRowBuilder` → `assembleSheets` → `renderXlsx`, prints seconds and peak heap; must finish without error. Record whether peak heap stays under 1.5 GB; if not, record a Ruling and a follow-up (streaming rows into the workbook) before listing.
- [ ] **Step 3: Template matrix** `scripts/template-matrix.mjs` renders 8 built-ins × A4/LETTER × Latin/Cyrillic/CJK sample issues into `data/matrix/`; PDFs rasterised with `pdftoppm`; Word files converted with `soffice --headless --convert-to pdf` when LibreOffice is installed (otherwise listed for the owner to open in Word at checkpoint C2); writes `data/matrix/index.html` contact sheet. Check every page image for clipped text or tables running off the page; fix renderers if any.
- [ ] **Step 4: Deploy** to development (Task 2 Step 6 commands) and run `forge eligibility` → eligible. Record the deployed version.
- [ ] **Step 5:** Write `atlassian/plans/2026-09-29-artup-reports-acceptance.md`: (a) measured results of Steps 1–3 against brief §4, one row per criterion, pass/fail with numbers; (b) the owner's manual checklist for checkpoint C2 (below).

Owner checklist (in the acceptance file, Russian, one line per item, each with where to click and what to expect):
  1. Поиск → «Приложения» → «Export to Excel, Word or PDF» → Excel, встроенный «список задач» → файл открывается в Excel: ключи — ссылки, даты — даты, шапка закреплена, фильтр есть.
  2. Тот же поиск → Word «одна задача» на 20 задачах с картинками → картинки внутри, шапка таблиц повторяется, номера страниц.
  3. PDF «отчёт по спринту» из меню спринта → кириллица и иероглифы без квадратиков.
  4. **Скорость картинок через браузер:** Word на 500 задач с вложениями (`project = RPT AND attachments is not EMPTY`) — время на экране результата ≤ 120 с, повторов (retries) — сколько показано. Если > 120 с или повторов > 50 — сообщить (R-X5, запасной путь — миниатюры).
  5. Своя страница → «Шаблоны» → загрузить пример шаблона (кнопка «Скачать пример») с опечаткой `{{summry}}` → подсказка «summary», сохранить нельзя; исправить в Word, загрузить → выгрузка по нему работает.
  6. Шаблон «для проекта» виден другому пользователю проекта и не виден пользователю без доступа к проекту.
  7. Отмена выгрузки на середине → ничего не скачалось, форма вернулась.
  8. Тёмная тема и русский язык интерфейса — всё читается, ничего не обрезано.
- [ ] **Step 6: Commit** `REPORTS-23: Record load acceptance on 10 000 issues and the template matrix` (same trailer).

### Task 23: Listing drafts, privacy page, product page on artuplabs.com

**Model:** sonnet

**Files:**
- Create: `atlassian/listing-reports/{listing.md,privacy-security.md,highlights.md,screenshots/}`; `site/reports/index.html` (+ assets) following `site/export/`
- Modify: `atlassian/README.md` (status row), `NEXT_STEPS.md` (owner steps for Reports)

- [ ] **Step 1:** Listing text from `atlassian/listing-export/` structure: name "ArtUp Reports — Excel, Word & PDF export for Jira", tagline, summary, 3 highlights mapped to brief §4 (10 000 issues in a minute; Word templates made in Word, no code; Runs on Atlassian, nothing leaves Atlassian), quick-start steps, pricing note (free ≤ 10 users, no watermark), and the Privacy & Security answers (no egress, no issue data stored, KVS stores template files and metadata only, data residency = Atlassian's).
- [ ] **Step 2:** Screenshots: pick 5 from the Task 21 matrix (1280 px, light, en-US) — wizard, Excel preview, result, templates tab, a PDF page — and export at Marketplace sizes.
- [ ] **Step 3:** Product page `site/reports/index.html` in the style of `site/export/` (same CSS, no external requests beyond what `site/export` already uses); link from the site index. Do **not** deploy the site — the owner deploys.
- [ ] **Step 4:** Update `atlassian/README.md` row #3 status and `NEXT_STEPS.md` with the owner steps: C2 checklist, production deploy approval, listing submission (owner only), site deploy.
- [ ] **Step 5: Commit** `REPORTS-24: Draft the Marketplace listing, privacy answers and product page` (same trailer).

---

## Execution order and checkpoints

| Checkpoint | After | Owner action |
|---|---|---|
| C1 | Task 20 | open the six entry points once on artuplabs-dev (the app works on real contexts); look at the screenshot contact sheet after Task 21 |
| C2 | Task 22 | manual checklist in `2026-09-29-artup-reports-acceptance.md`, incl. item 4 (browser image speed, R-X5); approve production deploy |
| C3 | Task 23 | submit the listing; deploy the site |

Dependencies: 1 → 2 → 3 → {4, 5} → 6 → 7 → 8 → 9 → {10, 11} → {12, 13, 14} → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23. Tasks 4 and 5 (pure, full code) may go to one sonnet implementer as a batch (one commit per task, one review). Tasks 11, 12, 13 and 14 only share Task 9's `DocSpec`/`Prepared` and Task 11's palette — run them in order but each with its own implementer and reviewer.

| Task | Model | Why |
|---|---|---|
| 1, 2, 3, 4, 5, 7, 8, 11, 17, 19, 20, 21, 22, 23 | sonnet | scaffolding and copying, pure modules with full code, UI to a written contract, measurements, texts |
| 6, 9, 10, 12, 13, 14, 15, 16, 18 | opus | ADF, layouts, client retry semantics, three renderers against real libraries, pipeline, permissions, the wizard |

Reviews: spec-compliance and code-quality reviewers use the same model as the task's implementer; the final whole-branch review uses opus.
