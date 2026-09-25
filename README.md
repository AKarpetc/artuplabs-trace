# ArtUp Trace

A Forge app for Jira Cloud that gives a project a lightweight requirements-traceability view.

- Tracks configured Jira issue types as "requirements" and shows what percentage of them are covered by a linked "verification" issue (e.g. a Story linked to a Task).
- Flags "suspect" links: a requirement changed after a link to it was confirmed, so the confirmation may be stale. A single click re-confirms the link against the requirement's current fingerprint.
- Captures point-in-time baselines of a project's requirements and diffs any two baselines to show what changed (added, removed, content changed, links changed), paged and exportable as CSV. Each diff row shows the status in both baselines, but a status-only change is not listed as a difference in v1.
- Reads Jira only: no new issue types, no custom fields, no writes to issue data. All syncing runs through a checkpointed background job within a fixed Jira API points budget.
- Issue deletions are applied to the cache immediately. Other issue and link changes reach it through an incremental sync that starts about a minute after the Jira event, plus an hourly reconcile and a weekly full sync.
- The fingerprint that decides when a link becomes suspect covers the requirement's summary and description. In v1 these fields are fixed and cannot be configured.

## Frontend

The UI is Custom UI, in `static/app`: a React 18 app built with Vite and styled with Atlaskit components and design tokens (no hard-coded colours, so it works in both light and dark Jira themes). It talks to the backend only through the existing resolvers, over `@forge/bridge`.

The app follows the viewer's Jira language, with translations for 26 locales (`static/app/src/i18n/locales`); a string missing from a locale falls back to the English (`en-US`) text. Exporting coverage or a baseline diff downloads a CSV file (`artup-trace-<kind>-<projectKey>-<YYYY-MM-DD>.csv`) directly in the browser.

```
npm --prefix static/app install
npm run test:ui
npm run build:ui
```

`npm run build:ui` runs the Vite build for both modules and must be run before every `forge deploy` — it produces `static/app/dist/project-page` and `static/app/dist/issue-panel`, which `manifest.yml` points at.

## Tests

```
npm test
```

Runs the Vitest suite (`vitest run`) against `test/**/*.test.js`. 182 tests currently pass, covering fingerprinting, coverage/suspect-link rules, CSV escaping, the Jira client's rate-limit and transient-failure handling, checkpointed sync jobs, event handling, baseline diffing, access control, and resolver/worker orchestration (with mocked Forge modules).

`npm run test:ui` runs the frontend's own Vitest suite (125 tests) against `static/app/test/**/*.test.jsx`.

## Deploy

```
npm run build:ui
forge lint
forge deploy --non-interactive -e development
forge eligibility -e development
```

`forge eligibility` checks the deployed version against the Runs on Atlassian program (no external egress, no remotes/Connect modules, bundled resources only). The app manifest sets `app.licensing.enabled: true`; resolvers in `src/core/access.js` and `src/handlers/resolvers.js` only require an active license when `context.environmentType === 'PRODUCTION'`, so development and staging installs are unaffected by licensing. **Production license enforcement (`context.license.active`) must be verified once the app has a Marketplace listing** — there is no way to exercise a `PRODUCTION` environment context before then.

## Data stored

The app stores no issue descriptions or other free text beyond what is listed below. All data lives in Forge SQL (app-owned) and Forge KVS (project config), scoped per installation:

- **Requirement issues** (`req_issue`): issue id, issue key, project id, issue type id, summary, status name, a SHA-256 **fingerprint** hash of the fingerprint fields (summary and description) (never the field values or description text), a SHA-256 **links hash**, a per-field SHA-256 hash for each extra fingerprint field beyond summary/description (`fields_json`; no field values; always empty in v1, where the fingerprint fields are fixed), and sync bookkeeping (last-seen sync id).
- **Trace links** (`trace_link`): the link id, the requirement's issue id, the linked issue's id/key/type/status, the link type, direction, the SHA-256 fingerprint the link was last confirmed against, who confirmed it and when, and whether it is currently suspect.
- **Issue versions** (`issue_version`): one row per distinct fingerprint seen for an issue — issue id, issue key, summary, status name, the SHA-256 fingerprint, and the same per-field SHA-256 hashes as `req_issue.fields_json` (never the field values or description text) — used for baselines only: each baseline member points at the version it captured.
- **Baselines** (`baseline`, `baseline_member`): a named, timestamped snapshot of a project's requirements (issue id, version id, links hash, status name) plus a checksum, used to diff two points in time.
- **Jobs** (`job`): checkpointed state for full-sync, incremental-sync and baseline-capture background jobs. Finished jobs are deleted after 7 days.
- **Project config** (Forge KVS): which issue types count as requirements/verification and which link types indicate coverage. The fingerprint field list is stored with it but is fixed to summary and description in v1.

## Load check (pending)

Controller ruling R25 replaces the staging load run in the original task brief with local tooling; the run itself has not been executed yet. To carry it out:

1. In the Jira UI, configure an ArtUp Trace project (requirement issue type, verification issue type, link type).
2. Run the seed script to generate load (see below).
3. Watch `forge logs -e development` (or `-e staging`, if deployed there) during a full sync.
4. Record: total sync pages, wall time, whether any HTTP 429 occurred, and `getDiff` latency between two baselines.

### Seed script

`scripts/seed-requirements.mjs` is a dependency-free Node 22 ES module that creates `COUNT` requirement issues (bulk-created 50 per call via `POST /rest/api/3/issue/bulk`), then one verification issue per even-numbered requirement, and links each pair via `POST /rest/api/3/issueLink`. It honours HTTP 429 by sleeping for `Retry-After` seconds before retrying, and prints progress plus a final summary. It has not been run.

```
JIRA_SITE=artuplabs-dev.atlassian.net \
JIRA_EMAIL=you@example.com \
JIRA_TOKEN=<atlassian api token> \
PROJECT_KEY=TRACE \
COUNT=300 \
REQ_TYPE=Story \
VERIFY_TYPE=Task \
LINK_TYPE=Relates \
node scripts/seed-requirements.mjs
```

All variables except `JIRA_EMAIL`, `JIRA_TOKEN`, and `PROJECT_KEY` have the defaults shown above.

### Results

| Date | Requirements seeded | Sync pages | Wall time | HTTP 429s | Coverage | `getDiff` latency |
| ---- | -------------------- | ---------- | --------- | --------- | -------- | ------------------ |
|      |                       |            |           |           |          |                     |
