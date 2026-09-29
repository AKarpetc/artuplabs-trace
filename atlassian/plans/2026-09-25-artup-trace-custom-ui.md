# ArtUp Trace — Custom UI, i18n and UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UI Kit frontend with a polished, full-width Custom UI (React + Atlaskit) that follows the viewer's Jira language (26 locales) and theme, saves CSV exports as real files, and is pleasant to use; the backend stays as is.

**Architecture:** Two Custom UI resources built with Vite from one source tree under `static/app` (entry per module: project page, issue panel). They talk to the existing resolvers through `@forge/bridge` `invoke`. Translations are bundled JSON per locale selected from `view.getContext().locale`. Theme via `view.theme.enable()` + Atlaskit design tokens. CSV: resolver returns text, frontend saves it with a Blob and `<a download>` (the Forge Custom UI iframe has `allow-downloads`).

**Tech Stack:** Forge Custom UI, React 18, Vite, Atlaskit (`@atlaskit/tabs`, `dynamic-table`, `button`, `select`, `progress-bar`, `section-message`, `lozenge`, `empty-state`, `textfield`, `heading`, `primitives`, `tokens`, `spinner`, `css-reset`, `flag`, `checkbox`, `modal-dialog`), `@forge/bridge`, Vitest + @testing-library/react + jsdom.

**Spec (user acceptance feedback 2026-09-25, binding):**
1. The app is in the viewer's Jira language — all Jira locales (Forge-supported: zh-CN, zh-TW, cs-CZ, da-DK, nl-NL, en-US, en-GB, et-EE, fi-FI, fr-FR, de-DE, hu-HU, is-IS, it-IT, ja-JP, ko-KR, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, tr-TR, es-ES, sv-SE).
2. It looks like a native Jira screen and is not cramped: full width, larger tables, prominent tabs, generous spacing, readable.
3. Export saves a `.csv` file; no text modal.
4. It is pretty and convenient to use.
Previous plan and rulings still hold for the backend: `atlassian/plans/2026-09-24-artup-trace-v1.md`, `atlassian/plans/2026-09-24-artup-trace-v1-rulings.md`.

**Repository:** `~/Projects/My/artuplabs-trace`, branch `trace-v1-custom-ui` (from `trace-v1` a288b15). Local only, never push. Forge creds: `set -a && . ~/DistributB2B/.env && set +a`. Dev site `artuplabs-dev.atlassian.net`, test project `REQ` (id 10002), requirement type «История» (10005), verification «Задача» (10006).

## Global Constraints

- Backend (`src/core`, `src/infra`, `src/handlers`) unchanged except: resolver `exportCsv` may add a `fileName`-independent change only if needed; resolver keys and payloads stay the same.
- No external egress, no remote fonts/CDNs: everything bundled; `forge eligibility` must stay "eligible for Runs on Atlassian".
- Scopes unchanged (`read:jira-work`, `write:jira-work`, `read:jira-user`, `storage:app`).
- Only Atlaskit components/primitives and design tokens for styling (`token('…')`, `xcss`); no hard-coded colours, so dark and light Jira themes both work.
- Every user-visible string goes through `t('key')`; no literal UI text in components. `en-US.json` is the source of keys; every locale file has exactly the same keys (a test enforces it). Missing key → en-US text, never the raw key.
- Layout: page content uses full available width with 24px side padding (`space.300`), sections separated by `space.400`; tables fill the width; body text 14px, headings via `@atlaskit/heading`.
- CSV file name: `artup-trace-<kind>-<projectKey>-<YYYY-MM-DD>.csv`, UTF-8 with BOM (the resolver already adds the BOM).
- Issue keys in every table are links that open the issue in Jira (`router.navigate('/browse/KEY')`).
- Commit format `TRACE-<n>: <Description>` + blank line + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push.
- No `//` comments inside function bodies; JSDoc 1–2 lines on exported helpers.

## Review Focus

1. A Jira locale Forge returns in another shape (`ru_RU`, `ru`, `pt-BR`, `en_GB`, unknown `xx_YY`) → the closest supported language or English, never a crash or raw keys. Test: Task 2 `resolveLocale` cases.
2. A translation file missing a key or with a broken `{placeholder}` → English text with values filled, never `{count}` shown to the user. Test: Task 2 key-parity and interpolation tests.
3. Export when the project has 0 rows or the export is truncated → a file still downloads (header only) and a warning says it was truncated. Test: Task 5 `ExportButton` tests.
4. Dark theme → every text and surface readable (tokens only). Check: Task 8 manual list item + lint rule/grep for hex colours in `static/app/src`.
5. A long summary (500+ chars, emoji, RTL-free non-Latin text) in a table → wraps within the cell, table stays full width, no horizontal page scroll. Check: Task 4 component test renders long text; manual list item.

---

## File Structure

```
static/app/package.json            own deps (react, atlaskit, vite, vitest)
static/app/vite.config.js          two entries → dist/project-page.html, dist/issue-panel.html
static/app/project-page.html       entry html
static/app/issue-panel.html        entry html
static/app/src/i18n/locales/*.json 26 locale files (en-US is the key source)
static/app/src/i18n/index.js       resolveLocale, createT, I18nProvider/useT
static/app/src/api.js              invoke wrappers + error mapping
static/app/src/theme.js            view.theme.enable() + context bootstrap
static/app/src/download.js         csvFileName, saveTextFile
static/app/src/components/*.jsx    IssueLink, SummaryCards, ExportButton, PageSection, Toasts
static/app/src/project/*.jsx       ProjectApp, CoverageTab, SuspectTab, BaselinesTab, SettingsTab, Onboarding
static/app/src/issue/IssueApp.jsx  issue panel
static/app/test/*.test.js(x)       vitest (jsdom)
manifest.yml                       resources → static/app/dist, no render: native
src/frontend/*                     deleted in Task 8
```

---

### Task 1: Custom UI scaffold, theme and full-width shell

**Files:** Create `static/app/package.json`, `static/app/vite.config.js`, `static/app/project-page.html`, `static/app/issue-panel.html`, `static/app/src/theme.js`, `static/app/src/project/main.jsx`, `static/app/src/issue/main.jsx`, `static/app/test/smoke.test.jsx`; Modify `manifest.yml`, root `package.json` (scripts), `.gitignore` (`static/app/dist`, `static/app/node_modules` — dist must NOT be ignored by forge deploy: check `.forgeignore` semantics; if the root `.gitignore` is used by forge to exclude files, put dist ignore only in `static/app/.gitignore`).

**Interfaces — Produces:** `bootstrap(render)` in `theme.js`: awaits `view.theme.enable()` and `view.getContext()`, returns `{ context }`; project/issue `main.jsx` render a placeholder `<ProjectApp context>` / `<IssueApp context>` inside `@atlaskit/css-reset` + a full-width `Box` with padding `space.300`.

- [ ] Step 1: In `static/app` create a Vite + React 18 project (`npm init -y`, install `react@18 react-dom@18 @forge/bridge @atlaskit/css-reset @atlaskit/primitives @atlaskit/tokens @atlaskit/heading @atlaskit/spinner` and dev `vite @vitejs/plugin-react vitest @testing-library/react @testing-library/jest-dom jsdom`). Pin exact versions resolved by npm.
- [ ] Step 2: `vite.config.js`: `base: './'`, `build.outDir: 'dist'`, `rollupOptions.input: { 'project-page': 'project-page.html', 'issue-panel': 'issue-panel.html' }`; vitest `environment: 'jsdom'`.
- [ ] Step 3: `theme.js`:
```js
import { view } from '@forge/bridge';

/** Enables Jira theming and returns the Forge view context. */
export async function bootstrap() {
  await view.theme.enable();
  const context = await view.getContext();
  return { context };
}
```
- [ ] Step 4: Smoke test renders the shell with a mocked `@forge/bridge` (`vi.mock('@forge/bridge', () => ({ view: { theme: { enable: vi.fn() }, getContext: vi.fn().mockResolvedValue({ locale: 'en_US', extension: { project: { id: '10002', key: 'REQ' } } }) }, invoke: vi.fn(), router: { navigate: vi.fn() } }))`). Run `npm test` in `static/app` — pass.
- [ ] Step 5: Manifest: replace `jira:projectPage` and `jira:issuePanel` resources with `- key: project-page` `path: static/app/dist` + `tunnel: { port: 3000 }` omitted; set module `resource: project-page` and `resource: issue-panel` pointing to resources whose `path` is `static/app/dist` and whose HTML is chosen by... Forge Custom UI serves `index.html` of the resource path: therefore build to two directories instead: `dist/project-page/index.html` and `dist/issue-panel/index.html` (adjust Vite: build twice via two configs or a multi-page build with a post-build move; choose the simplest that yields two directories each with `index.html`). Remove `render: native`. Keep `icon: resource:icons;icon.svg` and all other modules untouched. Verify manifest schema by `forge lint`.
- [ ] Step 6: Root `package.json` scripts: `"build:ui": "npm --prefix static/app run build"`, `"test:ui": "npm --prefix static/app test"`; root `npm test` still runs backend tests only.
- [ ] Step 7: `npm run build:ui`, `forge lint`, `forge deploy --non-interactive -e development`, `perl -e 'alarm 300; exec @ARGV' forge install --non-interactive --upgrade --site artuplabs-dev.atlassian.net --product jira --environment development`, `forge eligibility -e development --non-interactive` → eligible. Commit `TRACE-17: Add Custom UI shell with Jira theming`.

### Task 2: i18n core with 26 locales wiring

**Files:** Create `static/app/src/i18n/index.js`, `static/app/src/i18n/locales/en-US.json` (all keys used by Tasks 3–7, listed below), `static/app/test/i18n.test.js`.

**Interfaces — Produces:** `SUPPORTED_LOCALES` (26 codes above); `resolveLocale(raw): string`; `createT(locale, dictionaries): (key, values?) => string`; `I18nProvider({ locale, children })`, `useT()`; `formatNumber(locale, n)`, `formatDate(locale, iso)`.

Rules: `resolveLocale` normalises `_`→`-`, exact match wins; else language-only match with preference `pt→pt-BR`, `zh→zh-CN`, `en→en-US`, `no/nb/nn→no-NO`; else `en-US`. `createT` looks up locale dict, then `en-US`, then returns the key; replaces `{name}` placeholders from `values`; a placeholder with no value stays empty string (never `{name}`). Dictionaries are imported statically (bundled) via `import.meta.glob('./locales/*.json', { eager: true })`.

Keys (en-US values; Task 7 translates): `app.title` "ArtUp Trace"; `app.lastSynced` "Last synced {time}"; `app.syncing` "Sync in progress: {pages} pages read. Results update as it runs."; `app.syncFailed` "Last sync failed: {error}"; `tabs.coverage` "Coverage"; `tabs.suspects` "Suspect links"; `tabs.baselines` "Baselines"; `tabs.settings` "Settings"; `cards.coverage` "Coverage"; `cards.uncovered` "Without verification"; `cards.suspects` "Suspect links"; `cards.requirements` "Requirements"; `coverage.headline` "{percent}% covered — {covered} of {total} requirements"; `coverage.empty.title` "No requirements found"; `coverage.empty.body` "No issues of the requirement types were found yet. The first sync can take up to an hour on large projects."; `table.requirement` "Requirement"; `table.summary` "Summary"; `table.status` "Status"; `table.link` "Link"; `table.linkedIssue` "Linked issue"; `table.change` "Change"; `table.statusBeforeAfter` "Status before → after"; `table.search` "Search by key or summary"; `table.loadMore` "Load more"; `suspects.empty.title` "No suspect links"; `suspects.empty.body` "A link becomes suspect when its requirement's summary or description changes after the link was confirmed."; `suspects.confirm` "Confirm"; `suspects.confirmSelected` "Confirm selected ({count})"; `suspects.confirmed` "Link confirmed"; `suspects.gone` "This link no longer exists; the list was refreshed."; `baselines.newName` "New baseline name"; `baselines.create` "Create baseline"; `baselines.created` "Baseline {name} is being captured"; `baselines.refresh` "Refresh"; `baselines.name` "Name"; `baselines.createdAt` "Created"; `baselines.count` "Requirements"; `baselines.status` "Status"; `baselines.status.complete` "Complete"; `baselines.status.capturing` "Capturing"; `baselines.status.failed` "Failed"; `baselines.compareTitle` "Compare two baselines"; `baselines.before` "Before"; `baselines.after` "After"; `baselines.compare` "Compare"; `baselines.counts` "Added {added} · Removed {removed} · Changed {changed} · Links changed {linksChanged}"; `baselines.empty` "No baselines yet. Create one to freeze the current state of your requirements."; `change.added` "Added"; `change.removed` "Removed"; `change.changed` "Changed"; `change.links-changed` "Links changed"; `export.button` "Export CSV"; `export.done` "File {fileName} downloaded"; `export.truncated` "Only the first 5 000 rows were exported."; `settings.title` "Settings"; `settings.reqTypes` "Requirement issue types"; `settings.verTypes` "Verification issue types (tests or tasks that prove a requirement)"; `settings.linkTypes` "Link types that count (empty = any)"; `settings.fingerprintNote` "Links become suspect when the requirement's summary or description changes."; `settings.save` "Save"; `settings.saved` "Saved. Sync started in the background."; `onboarding.title` "Set up ArtUp Trace in three steps"; `onboarding.step1` "Choose which issue types are requirements."; `onboarding.step2` "Choose which issue types verify them."; `onboarding.step3` "Save — the first sync runs in the background."; `onboarding.cta` "Open settings"; `issue.notRequirement` "This issue is not tracked as a requirement. Configure requirement types on the project's ArtUp Trace page."; `issue.covered` "Covered"; `issue.notCovered` "Not covered"; `issue.ok` "OK"; `issue.suspect` "Suspect — confirm"; `issue.refreshNote` "Data refreshes within a few minutes of changes."; `errors.no-permission` "You do not have permission for this action in this project."; `errors.unlicensed` "ArtUp Trace license is not active on this site."; `errors.bad-request` "The request was not valid. Refresh the page and try again."; `errors.generic` "Something went wrong: {message}"; `common.retry` "Try again".

- [ ] Step 1: Tests first: `resolveLocale` for `ru_RU`→`ru-RU`, `ru`→`ru-RU`, `pt`→`pt-BR`, `pt_PT`→`pt-PT`, `zh`→`zh-CN`, `en_GB`→`en-GB`, `nb_NO`→`no-NO`, `xx_YY`→`en-US`, `undefined`→`en-US`; `createT` fallback to en-US, key when missing everywhere, placeholder fill, missing value → empty. Key-parity test: for every JSON in `locales/`, key set equals en-US's and every `{placeholder}` present in en-US value appears in the translation. (Until Task 7 only en-US exists; the parity test iterates over whatever files exist.)
- [ ] Step 2: Implement; tests green. Commit `TRACE-18: Add i18n core with locale resolution`.

### Task 3: API layer, toasts, issue links, page building blocks

**Files:** Create `static/app/src/api.js`, `static/app/src/components/IssueLink.jsx`, `Toasts.jsx` (wrapping `@atlaskit/flag` `FlagGroup` with a `useToasts()` hook), `PageSection.jsx`, `SummaryCards.jsx`; tests `static/app/test/api.test.js`, `components.test.jsx`.

**Interfaces — Produces:** `call(key, payload)` → resolves data or throws `AppError { code: 'no-permission'|'unlicensed'|'bad-request'|'generic', message }` (map from the thrown error message; unknown → generic with message); `errorMessage(t, error)`; `<IssueLink issueKey>` renders an Atlaskit `Link`-styled button calling `router.navigate('/browse/' + issueKey)`; `<SummaryCards items=[{ label, value, appearance }]>` responsive grid of cards (tokens: `elevation.surface.raised`, `border.radius.200`, padding `space.200`, value via `Heading size="large"`); `<PageSection title actions>` heading + right-aligned actions row.
- [ ] Tests: `call` maps `Error('no-permission')` etc.; IssueLink click navigates; SummaryCards renders all values. Commit `TRACE-19: Add API layer and shared UI building blocks`.

### Task 4: Project page — Coverage, Suspect links, Baselines, Settings, Onboarding

**Files:** Create `static/app/src/project/ProjectApp.jsx`, `CoverageTab.jsx`, `SuspectTab.jsx`, `BaselinesTab.jsx`, `SettingsTab.jsx`, `Onboarding.jsx`, `useRows.js` (paged loader with `loaded`, `error`, `loadMore`, in-flight guard); tests `static/app/test/project.test.jsx`.

Behaviour (resolver keys/payloads as today — read `src/handlers/resolvers.js`):
- ProjectApp: header (`Heading size="large"` app title + last synced + sync/fail `SectionMessage`), `SummaryCards` (coverage %, uncovered count, suspect count, requirement total), Atlaskit `Tabs` full width. When not configured: `Onboarding` (numbered 3 steps + button that switches to Settings tab) instead of the other tabs' content.
- CoverageTab: `ProgressBar`, headline, search field filtering loaded rows client-side, `DynamicTable` (sortable key/summary/status, rowsPerPage none, full width, `IssueLink` in key column), Load more, Export button (Task 5), empty state only after a successful load; error → `SectionMessage` with Try again.
- SuspectTab: same table pattern; checkbox column + "Confirm selected (n)" button + per-row Confirm; after confirm show toast; ok:false → toast `suspects.gone` + reload.
- BaselinesTab: create form (Textfield + primary Button, disabled when empty), list table with status `Lozenge`, compare section with two controlled `Select`s, counts line, diff table with change `Lozenge`s and Load more, Export diff.
- SettingsTab: three `Select isMulti`, note text, Save primary button, success toast; errors listed; fingerprint fields not editable (R26).
- In-flight guard on every Load more and Confirm button (disabled + spinner while pending).
- Tests (mock `@forge/bridge` invoke): empty project shows onboarding / empty state not NaN; load failure shows error, not empty state; long summary (600 chars) renders without truncating the table; confirm ok:false shows the "gone" toast and reloads; Load more disabled while pending.
- Commit `TRACE-20: Build the project page in Custom UI`.

### Task 5: Export as a real file

**Files:** Create `static/app/src/download.js`, `static/app/src/components/ExportButton.jsx`; tests `static/app/test/download.test.js`.

```js
/** File name for an export: artup-trace-<kind>-<projectKey>-<YYYY-MM-DD>.csv */
export function csvFileName(kind, projectKey, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const safeKey = String(projectKey || 'project').replace(/[^A-Za-z0-9_-]/g, '');
  return `artup-trace-${kind}-${safeKey}-${date}.csv`;
}

/** Saves text as a file through a temporary download link (needs a user gesture). */
export function saveTextFile(fileName, text, doc = document) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```
- ExportButton `{ kind, projectKey, payload }`: calls `exportCsv`, then `saveTextFile`, toast `export.done`, and if `truncated` a warning toast; loading state on the button; errors → toast via `errorMessage`.
- Tests: file name format and sanitising; `saveTextFile` creates an anchor with `download` and clicks it (jsdom, stub `URL.createObjectURL`); ExportButton with 0 rows still saves a file; truncated shows warning.
- Commit `TRACE-21: Save CSV exports as files`.

### Task 6: Issue panel in Custom UI

**Files:** Create `static/app/src/issue/IssueApp.jsx`; test `static/app/test/issue.test.jsx`.
- Coverage `Lozenge`, links table (link type, `IssueLink`, status, OK lozenge or Confirm button with in-flight guard), refresh note, translated errors. Tests: not-a-requirement text; confirm flow.
- Commit `TRACE-22: Build the issue panel in Custom UI`.

### Task 7: Translations for all 26 locales

**Files:** Create `static/app/src/i18n/locales/<code>.json` for the 25 non-English codes (en-GB may copy en-US with British spelling where different).
- Translate every key naturally for a Jira user in that language; keep product name "ArtUp Trace", "CSV", issue keys and `{placeholders}` unchanged; use each language's usual Jira terms (ru: «задача», «требование», «связь», «срез»? use «базовая линия» or «снимок» consistently — pick «снимок» for ru; document chosen glossary per language at the top of the report).
- Key-parity test green for all files. Commit `TRACE-23: Translate the app into 26 Jira languages`.

### Task 8: Remove UI Kit, deploy, eligibility, acceptance list

**Files:** Delete `src/frontend/`; Modify `README.md` (Custom UI build, `npm run build:ui` before deploy, languages, export saves files); root lint config if it referenced `src/frontend`.
- Grep `static/app/src` for hex/rgb colours → none. `npm test`, `npm run test:ui`, `npm run build:ui`, `forge lint`, deploy, upgrade install, `forge eligibility` → eligible. Commit `TRACE-24: Remove the UI Kit frontend`.
- Write the manual acceptance list into the report (for the user): switch Jira language to Русский and English; dark and light theme; coverage cards; search; click a key opens the issue; confirm selected; baseline compare with Load more; Export saves `artup-trace-coverage-REQ-<date>.csv` and opens in Sheets with Cyrillic intact; issue panel.
