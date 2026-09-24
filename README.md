# ArtUp Trace

A Forge app for Jira Cloud that gives a project a lightweight requirements-traceability view.

- Tracks configured Jira issue types as "requirements" and shows what percentage of them are covered by a linked "verification" issue (e.g. a Story linked to a Task).
- Flags "suspect" links: a requirement changed after a link to it was confirmed, so the confirmation may be stale. A single click re-confirms the link against the requirement's current fingerprint.
- Captures point-in-time baselines of a project's requirements and diffs any two baselines to show what changed (added, removed, status changed), paged and exportable as CSV.
- Reads Jira only: no new issue types, no custom fields, no writes to issue data. All syncing runs through a checkpointed background job within a fixed Jira API points budget.

## Tests

```
npm test
```

Runs the Vitest suite (`vitest run`) against `test/**/*.test.js`. 110 tests currently pass, covering fingerprinting, coverage/suspect-link rules, CSV escaping, the Jira client's rate-limit handling, checkpointed sync jobs, baseline diffing, and access control.

## Deploy

```
forge lint
forge deploy --non-interactive -e development
forge eligibility -e development
```

`forge eligibility` checks the deployed version against the Runs on Atlassian program (no external egress, no remotes/Connect modules, bundled resources only). The app manifest sets `app.licensing.enabled: true`; resolvers in `src/core/access.js` and `src/handlers/resolvers.js` only require an active license when `context.environmentType === 'PRODUCTION'`, so development and staging installs are unaffected by licensing. **Production license enforcement (`context.license.active`) must be verified once the app has a Marketplace listing** — there is no way to exercise a `PRODUCTION` environment context before then.

## Data stored

The app stores no issue descriptions or other free text beyond what is listed below. All data lives in Forge SQL (app-owned) and Forge KVS (project config), scoped per installation:

- **Requirement issues** (`req_issue`): issue id, issue key, project id, issue type id, summary, status name, a SHA-256 **fingerprint** hash of the configured fingerprint fields (never the field values or description text), a SHA-256 **links hash**, and sync bookkeeping (last-seen sync id).
- **Trace links** (`trace_link`): the link id, the requirement's issue id, the linked issue's id/key/type/status, the link type, direction, the SHA-256 fingerprint the link was last confirmed against, who confirmed it and when, and whether it is currently suspect.
- **Issue versions** (`issue_version`): one row per distinct fingerprint seen for an issue — issue id, issue key, summary, status name, and the SHA-256 fingerprint (never the field values or description text) — used to re-anchor confirmed links when the fingerprint configuration changes.
- **Baselines** (`baseline`, `baseline_member`): a named, timestamped snapshot of a project's requirements (issue id, version id, links hash, status name) plus a checksum, used to diff two points in time.
- **Jobs** (`job`): checkpointed state for full-sync and baseline-capture background jobs.
- **Project config** (Forge KVS): which issue types count as requirements/verification, which link type indicates coverage, and which fields make up the fingerprint.

## Load check (pending)

Controller ruling R25 replaces the staging load run in the original task brief with local tooling; the run itself has not been executed yet. To carry it out:

1. In the Jira UI, configure an ArtUp Trace project (requirement issue type, verification issue type, link type, fingerprint fields).
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
