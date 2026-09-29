# ArtUp Trace v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Jira Cloud Forge app that shows requirement→verification coverage from native Jira links, flags links whose requirement changed after the link was confirmed ("suspect"), captures immutable baselines and diffs two of them, and exports results as CSV.

**Architecture:** Jira is read in the background into a per-installation Forge SQL cache (requirements, their links, fingerprints). Coverage and suspicion are computed at write time by pure functions in `src/core/` and stored as columns, so the UI reads cheap SQL aggregates instead of walking 20 000 issues live. Long work (full sync) runs as checkpointed async-queue jobs under a per-installation Jira points budget; product events and an hourly reconcile keep the cache fresh; baselines are copied from the cache (zero Jira calls).

**Tech Stack:** Forge (runtime nodejs24.x), UI Kit (`@forge/react`), `@forge/resolver`, `@forge/api` (requestJira), `@forge/sql` 4.x (Forge SQL, MySQL dialect/TiDB), `@forge/kvs` 2.x (settings), `@forge/events` 3.x (Queue), Vitest for unit tests.

**Spec:** `~/DistributB2B/atlassian/15_traceability_gaps.md` §4 (candidate 1 = product) and `~/DistributB2B/atlassian/16_forge_limits_feasibility.md` (platform limits, §G constraints). Read both before starting.

**Repository:** `~/Projects/My/artuplabs-trace` (local git, branch `main`, scaffold commit `526abd9`). Forge credentials: `set -a && . ~/DistributB2B/.env && set +a` before any `forge` command. Dev site: `artuplabs-dev.atlassian.net`.

## Global Constraints

- UI Kit only: import UI components exclusively from `@forge/react`; no HTML elements, no `Table` (use `DynamicTable`), no Custom UI, no `@forge/ui`.
- No external egress: no `permissions.external`, no remotes, no Connect modules, no providers (keeps Runs on Atlassian; verify with `forge eligibility`).
- Scopes are fixed for v1 and must not grow later: `read:jira-work`, `write:jira-work`, `read:jira-user`, `storage:app`.
- Forge SQL ships in the first release (adding it later forces a major version with admin consent).
- No new issue types, no custom fields, no writes to Jira data. The app only reads Jira.
- Store description only as a SHA-256 hash, never its text.
- Jira points budget: at most **5 000 points per 15 minutes per installation** (points = 1 per request + 1 per issue returned). On HTTP 429 honour `Retry-After` by re-enqueueing, never by sleeping in a loop.
- SQL: every SELECT the UI triggers is paged (≤ 500 rows) and must finish < 5 s and < 4 MiB; multi-row writes ≤ 500 rows per statement.
- Async consumer and scheduled functions: `timeoutSeconds: 900`; a job step stops starting new pages after 700 s and re-enqueues itself from its checkpoint.
- Resolvers authorize every call with the *user's* Jira permissions (`/rest/api/3/mypermissions` as user) because SQL is read as app: view = `BROWSE_PROJECTS`, confirm link / create baseline = `EDIT_ISSUES`, settings = `ADMINISTER_PROJECTS`.
- Commit messages: `TRACE-<task number>: <Description>` (for example `TRACE-2: Add requirement fingerprint`). Never `git push`.
- Code style: vanilla ES modules, JSDoc on exported functions (one or two lines), no inline `//` comments inside function bodies.

## Review Focus

1. A requirement changes only in a field outside its fingerprint (assignee, status, labels, sprint) → its links must **not** become suspect. Test: Task 2 `fingerprint ignores non-fingerprint fields`.
2. A project with no requirements (or the app not configured yet) → the page says "No requirements found" / "Configure requirement types", never `NaN%` or `0%` of nothing. Test: Task 4 `coverage of empty set reports percent null`, UI branch in Task 12.
3. An admin changes which fields form the fingerprint → existing links must not all turn suspect at once; confirmed fingerprints are re-anchored to the new fingerprint. Test: Task 3 `fingerprint fields change requires re-anchoring`, Task 8 `re-anchor on config change`.
4. CSV with summaries containing commas, quotes, newlines, non-ASCII, or starting with `=`, `+`, `-`, `@` → opens in Excel/Sheets as plain text, one row per issue. Test: Task 6 CSV cases.
5. Jira returns 429 in the middle of a full sync → the job resumes from its checkpoint later, rows are not duplicated, and the project is not marked "synced" until the last page. Test: Task 8 `429 mid-sync re-enqueues from checkpoint`.

---

## File Structure

```
manifest.yml                      modules, functions, queue, triggers, SQL, scopes
package.json                      deps + "test": "vitest run"
src/index.js                      exports every Forge function handler
src/core/fingerprint.js           requirement fingerprint + links hash (pure)
src/core/config.js                project config defaults, validation, change detection (pure)
src/core/links.js                 extract links from Jira issue JSON, coverage predicate (pure)
src/core/coverage.js              coverage summary maths (pure)
src/core/csv.js                   CSV serialisation with formula-injection guard (pure)
src/core/budget.js                Jira points budget window (pure)
src/core/baselineDiff.js          classify diff rows, baseline checksum (pure)
src/core/jobs.js                  job-step orchestration with injected deps (pure logic)
src/infra/jira.js                 Jira REST client: search page, permissions, 429 handling
src/infra/schema.js               SQL migrations
src/infra/repo.js                 SQL repository (cache, links, jobs, baselines)
src/infra/settings.js             KVS: project config + budget state
src/infra/queue.js                async queue push helper
src/handlers/resolvers.js         UI resolver definitions
src/handlers/events.js            product event + lifecycle handlers
src/handlers/worker.js            async job consumer
src/handlers/reconcile.js         hourly scheduled reconcile
src/frontend/projectPage.jsx      project page: Coverage | Suspect links | Baselines | Settings
src/frontend/issuePanel.jsx       issue panel: this issue's links and suspicion
test/core/*.test.js               unit tests for src/core
test/fakes/memoryRepo.js          in-memory repo used by job tests
```

---

### Task 1: Tooling, manifest skeleton, SQL migrations

**Files:**
- Modify: `package.json`, `manifest.yml`, `src/index.js`
- Create: `src/infra/schema.js`, `src/handlers/events.js`, `vitest.config.js`, `test/smoke.test.js`
- Delete: `src/resolvers/index.js` (replaced in Task 11), `src/frontend/index.jsx` (replaced in Task 12)

**Interfaces:**
- Produces: `runMigrations(): Promise<string[]>` in `src/infra/schema.js`; tables listed below (later tasks rely on exact column names); handler exports `onLifecycle` in `src/handlers/events.js`.

- [ ] **Step 1: Install dependencies**

```bash
cd ~/Projects/My/artuplabs-trace
npm install @forge/api@8 @forge/sql@4 @forge/kvs@2 @forge/events@3
npm install -D vitest@5
```

- [ ] **Step 2: Add test script and vitest config**

In `package.json` set `"scripts": { "lint": "eslint src/**/*", "test": "vitest run" }` and `"name": "artuplabs-trace"`.

`vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.js'], environment: 'node' },
});
```

`test/smoke.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test` — Expected: 1 passed.

- [ ] **Step 3: Write the schema module**

`src/infra/schema.js`:
```js
import { migrationRunner } from '@forge/sql';

/** Applies all pending migrations; safe to call repeatedly. */
export async function runMigrations() {
  return migrationRunner
    .enqueue('v001_req_issue', `CREATE TABLE IF NOT EXISTS req_issue (
      issue_id VARCHAR(32) PRIMARY KEY,
      issue_key VARCHAR(64) NOT NULL,
      project_id VARCHAR(32) NOT NULL,
      issue_type_id VARCHAR(32) NOT NULL,
      summary VARCHAR(1024) NOT NULL,
      status_name VARCHAR(255) NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      links_hash CHAR(64) NOT NULL,
      covered TINYINT NOT NULL DEFAULT 0,
      fields_json TEXT,
      jira_updated_at VARCHAR(40),
      seen_sync_id BIGINT NOT NULL DEFAULT 0,
      INDEX idx_req_project (project_id, issue_id),
      INDEX idx_req_cov (project_id, covered, issue_id)
    )`)
    .enqueue('v002_trace_link', `CREATE TABLE IF NOT EXISTS trace_link (
      link_id VARCHAR(32) PRIMARY KEY,
      project_id VARCHAR(32) NOT NULL,
      req_issue_id VARCHAR(32) NOT NULL,
      other_issue_id VARCHAR(32) NOT NULL,
      other_key VARCHAR(64) NOT NULL,
      other_type_id VARCHAR(32) NOT NULL,
      other_status VARCHAR(255) NOT NULL,
      link_type_id VARCHAR(32) NOT NULL,
      link_type_name VARCHAR(255) NOT NULL,
      direction VARCHAR(8) NOT NULL,
      confirmed_fingerprint CHAR(64) NOT NULL,
      confirmed_by VARCHAR(128),
      confirmed_at VARCHAR(40),
      suspect TINYINT NOT NULL DEFAULT 0,
      INDEX idx_link_req (req_issue_id),
      INDEX idx_link_suspect (project_id, suspect, link_id)
    )`)
    .enqueue('v003_issue_version', `CREATE TABLE IF NOT EXISTS issue_version (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      issue_id VARCHAR(32) NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      issue_key VARCHAR(64) NOT NULL,
      summary VARCHAR(1024) NOT NULL,
      status_name VARCHAR(255) NOT NULL,
      fields_json TEXT,
      UNIQUE KEY uq_version (issue_id, fingerprint)
    )`)
    .enqueue('v004_baseline', `CREATE TABLE IF NOT EXISTS baseline (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      project_id VARCHAR(32) NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_by VARCHAR(128) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      status VARCHAR(16) NOT NULL,
      member_count INT NOT NULL DEFAULT 0,
      checksum CHAR(64),
      INDEX idx_baseline_project (project_id, id)
    )`)
    .enqueue('v005_baseline_member', `CREATE TABLE IF NOT EXISTS baseline_member (
      baseline_id BIGINT NOT NULL,
      issue_id VARCHAR(32) NOT NULL,
      version_id BIGINT NOT NULL,
      links_hash CHAR(64) NOT NULL,
      PRIMARY KEY (baseline_id, issue_id)
    )`)
    .enqueue('v006_job', `CREATE TABLE IF NOT EXISTS job (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(32) NOT NULL,
      project_id VARCHAR(32) NOT NULL,
      status VARCHAR(16) NOT NULL,
      state_json TEXT NOT NULL,
      error TEXT,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_job_project (project_id, kind, id)
    )`)
    .run();
}
```

- [ ] **Step 4: Lifecycle handler that runs migrations**

`src/handlers/events.js`:
```js
import { runMigrations } from '../infra/schema';

/** Runs SQL migrations when the app is installed or upgraded. */
export async function onLifecycle() {
  const applied = await runMigrations();
  console.log(`migrations applied: ${applied.length}`);
}
```

`src/index.js`:
```js
export { onLifecycle } from './handlers/events';
```

- [ ] **Step 5: Manifest skeleton with final scopes and SQL**

Replace `manifest.yml` keeping the generated `app.id` and `app.runtime` block verbatim:
```yaml
modules:
  trigger:
    - key: lifecycle
      function: on-lifecycle
      events:
        - avi:forge:installed:app
        - avi:forge:upgraded:app
  function:
    - key: on-lifecycle
      handler: index.onLifecycle
  sql:
    - key: main
      engine: mysql
permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - read:jira-user
    - storage:app
app:
  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64
  id: ari:cloud:ecosystem::app/6f24b898-5a6c-4b8b-92b2-d218cfeb1a6c
```

Delete `src/resolvers/index.js` and `src/frontend/index.jsx`.

- [ ] **Step 6: Lint, deploy, upgrade install, verify migrations**

```bash
set -a && . ~/DistributB2B/.env && set +a
forge lint
forge deploy --non-interactive -e development
forge install --non-interactive --upgrade --site artuplabs-dev.atlassian.net --product jira --environment development
forge logs -e development --since 15m
```
Expected: lint clean; deploy OK; logs contain `migrations applied: 6` (or `0` on re-run). If the lifecycle event did not fire, uninstall and install again, then re-check logs.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "TRACE-1: Add SQL schema, final scopes and test tooling"
```

---

### Task 2: Requirement fingerprint and links hash

**Files:**
- Create: `src/core/fingerprint.js`
- Test: `test/core/fingerprint.test.js`

**Interfaces:**
- Produces: `stableStringify(value): string`; `fingerprint(issue, fieldIds): string` (64-hex SHA-256); `linksHash(links): string` where `links` is `Array<{ linkTypeId, direction, otherIssueId }>`.
- `issue` shape everywhere in this plan: Jira search result item `{ id, key, fields: { summary, description, status: { name }, issuetype: { id }, issuelinks: [...], updated, [customfield_x]: any } }`.

- [ ] **Step 1: Write the failing tests**

`test/core/fingerprint.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { fingerprint, linksHash, stableStringify } from '../../src/core/fingerprint';

const base = {
  id: '10001',
  key: 'REQ-1',
  fields: {
    summary: 'Login must lock after 5 attempts',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lock' }] }] },
    status: { name: 'To Do' },
    assignee: { accountId: 'a' },
    customfield_10050: 'High',
  },
};

describe('stableStringify', () => {
  it('orders object keys so equal objects serialise equally', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('fingerprint', () => {
  it('is a 64-char hex string', () => {
    expect(fingerprint(base, ['summary', 'description'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when summary changes', () => {
    const edited = { ...base, fields: { ...base.fields, summary: 'Login must lock after 3 attempts' } };
    expect(fingerprint(edited, ['summary', 'description'])).not.toBe(fingerprint(base, ['summary', 'description']));
  });

  it('changes when description changes', () => {
    const edited = { ...base, fields: { ...base.fields, description: { type: 'doc', version: 1, content: [] } } };
    expect(fingerprint(edited, ['summary', 'description'])).not.toBe(fingerprint(base, ['summary', 'description']));
  });

  it('ignores non-fingerprint fields', () => {
    const edited = { ...base, fields: { ...base.fields, status: { name: 'Done' }, assignee: { accountId: 'b' } } };
    expect(fingerprint(edited, ['summary', 'description'])).toBe(fingerprint(base, ['summary', 'description']));
  });

  it('includes a selected custom field', () => {
    const edited = { ...base, fields: { ...base.fields, customfield_10050: 'Low' } };
    const ids = ['summary', 'description', 'customfield_10050'];
    expect(fingerprint(edited, ids)).not.toBe(fingerprint(base, ids));
  });

  it('treats a missing field and null the same', () => {
    const withNull = { ...base, fields: { ...base.fields, description: null } };
    const without = { ...base, fields: { summary: base.fields.summary } };
    expect(fingerprint(withNull, ['summary', 'description'])).toBe(fingerprint(without, ['summary', 'description']));
  });
});

describe('linksHash', () => {
  it('does not depend on link order', () => {
    const a = { linkTypeId: '1', direction: 'out', otherIssueId: '2' };
    const b = { linkTypeId: '3', direction: 'in', otherIssueId: '4' };
    expect(linksHash([a, b])).toBe(linksHash([b, a]));
  });

  it('changes when a link is added', () => {
    const a = { linkTypeId: '1', direction: 'out', otherIssueId: '2' };
    expect(linksHash([a])).not.toBe(linksHash([]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/core/fingerprint.test.js` — Expected: FAIL, cannot resolve `../../src/core/fingerprint`.

- [ ] **Step 3: Implement**

`src/core/fingerprint.js`:
```js
import { createHash } from 'node:crypto';

/** JSON serialisation with sorted object keys, so equal values give equal strings. */
export function stableStringify(value) {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 over the selected fields of a Jira issue; other fields do not affect it. */
export function fingerprint(issue, fieldIds) {
  const fields = issue.fields ?? {};
  const picked = [...fieldIds].sort().map((id) => [id, fields[id] ?? null]);
  return sha256(stableStringify(picked));
}

/** Order-independent hash of a requirement's links. */
export function linksHash(links) {
  const parts = links.map((l) => `${l.linkTypeId}:${l.direction}:${l.otherIssueId}`).sort();
  return sha256(parts.join('|'));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/core/fingerprint.test.js` — Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/fingerprint.js test/core/fingerprint.test.js
git commit -m "TRACE-2: Add requirement fingerprint and links hash"
```

---

### Task 3: Project configuration

**Files:**
- Create: `src/core/config.js`
- Test: `test/core/config.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_FINGERPRINT_FIELDS = ['summary', 'description']`
  - `normalizeConfig(raw): Config` where `Config = { requirementTypeIds: string[], verificationTypeIds: string[], linkTypeIds: string[], fingerprintFieldIds: string[] }`
  - `validateConfig(config): string[]` (list of human-readable errors, empty when valid)
  - `isConfigured(config): boolean`
  - `diffConfig(oldConfig, newConfig): { needsResync: boolean, needsReanchor: boolean }`

- [ ] **Step 1: Write the failing tests**

`test/core/config.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { normalizeConfig, validateConfig, isConfigured, diffConfig, DEFAULT_FINGERPRINT_FIELDS } from '../../src/core/config';

describe('normalizeConfig', () => {
  it('fills defaults for missing input', () => {
    expect(normalizeConfig(undefined)).toEqual({
      requirementTypeIds: [],
      verificationTypeIds: [],
      linkTypeIds: [],
      fingerprintFieldIds: DEFAULT_FINGERPRINT_FIELDS,
    });
  });

  it('dedupes and stringifies ids', () => {
    expect(normalizeConfig({ requirementTypeIds: [10001, '10001'] }).requirementTypeIds).toEqual(['10001']);
  });
});

describe('validateConfig', () => {
  it('requires at least one requirement and one verification type', () => {
    expect(validateConfig(normalizeConfig({}))).toEqual([
      'Choose at least one requirement issue type.',
      'Choose at least one verification issue type.',
    ]);
  });

  it('rejects the same type as requirement and verification', () => {
    const errors = validateConfig(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['1'] }));
    expect(errors).toEqual(['An issue type cannot be both requirement and verification.']);
  });

  it('requires summary in fingerprint fields', () => {
    const errors = validateConfig(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'], fingerprintFieldIds: ['description'] }));
    expect(errors).toEqual(['Fingerprint fields must include summary.']);
  });
});

describe('isConfigured', () => {
  it('is false until valid', () => {
    expect(isConfigured(normalizeConfig({}))).toBe(false);
    expect(isConfigured(normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'] }))).toBe(true);
  });
});

describe('diffConfig', () => {
  const a = normalizeConfig({ requirementTypeIds: ['1'], verificationTypeIds: ['2'] });

  it('no change needs nothing', () => {
    expect(diffConfig(a, a)).toEqual({ needsResync: false, needsReanchor: false });
  });

  it('requirement or verification or link types change requires resync', () => {
    expect(diffConfig(a, { ...a, requirementTypeIds: ['1', '3'] }).needsResync).toBe(true);
    expect(diffConfig(a, { ...a, linkTypeIds: ['9'] }).needsResync).toBe(true);
  });

  it('fingerprint fields change requires re-anchoring', () => {
    expect(diffConfig(a, { ...a, fingerprintFieldIds: ['summary'] })).toEqual({ needsResync: true, needsReanchor: true });
  });

  it('order of ids does not count as a change', () => {
    const b = { ...a, fingerprintFieldIds: ['description', 'summary'] };
    expect(diffConfig(a, b)).toEqual({ needsResync: false, needsReanchor: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/core/config.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/core/config.js`:
```js
export const DEFAULT_FINGERPRINT_FIELDS = ['summary', 'description'];

function ids(list) {
  return [...new Set((list ?? []).map(String))];
}

/** Returns a complete config object with defaults applied. */
export function normalizeConfig(raw) {
  const input = raw ?? {};
  const fingerprintFieldIds = ids(input.fingerprintFieldIds);
  return {
    requirementTypeIds: ids(input.requirementTypeIds),
    verificationTypeIds: ids(input.verificationTypeIds),
    linkTypeIds: ids(input.linkTypeIds),
    fingerprintFieldIds: fingerprintFieldIds.length ? fingerprintFieldIds : DEFAULT_FINGERPRINT_FIELDS,
  };
}

/** Human-readable validation errors; empty array when the config is usable. */
export function validateConfig(config) {
  const errors = [];
  if (!config.requirementTypeIds.length) {
    errors.push('Choose at least one requirement issue type.');
  }
  if (!config.verificationTypeIds.length) {
    errors.push('Choose at least one verification issue type.');
  }
  if (config.requirementTypeIds.some((id) => config.verificationTypeIds.includes(id))) {
    errors.push('An issue type cannot be both requirement and verification.');
  }
  if (!config.fingerprintFieldIds.includes('summary')) {
    errors.push('Fingerprint fields must include summary.');
  }
  return errors;
}

/** True when the project has a valid configuration. */
export function isConfigured(config) {
  return validateConfig(config).length === 0;
}

function sameSet(a, b) {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

/** Tells which background work a config change requires. */
export function diffConfig(oldConfig, newConfig) {
  const needsReanchor = !sameSet(oldConfig.fingerprintFieldIds, newConfig.fingerprintFieldIds);
  const needsResync = needsReanchor
    || !sameSet(oldConfig.requirementTypeIds, newConfig.requirementTypeIds)
    || !sameSet(oldConfig.verificationTypeIds, newConfig.verificationTypeIds)
    || !sameSet(oldConfig.linkTypeIds, newConfig.linkTypeIds);
  return { needsResync, needsReanchor };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run test/core/config.test.js` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.js test/core/config.test.js
git commit -m "TRACE-3: Add project configuration rules"
```

---

### Task 4: Link extraction, coverage predicate, coverage summary

**Files:**
- Create: `src/core/links.js`, `src/core/coverage.js`
- Test: `test/core/links.test.js`, `test/core/coverage.test.js`

**Interfaces:**
- Consumes: `Config` from Task 3.
- Produces:
  - `extractLinks(issue): LinkRow[]` where `LinkRow = { linkId, reqIssueId, otherIssueId, otherKey, otherTypeId, otherStatus, linkTypeId, linkTypeName, direction: 'in'|'out' }`
  - `isCovered(links, config): boolean`
  - `coverageSummary(total, covered): { total, covered, uncovered, percent: number|null }` (percent rounded to one decimal, `null` when total is 0)

- [ ] **Step 1: Write the failing tests**

`test/core/links.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { extractLinks, isCovered } from '../../src/core/links';

const issue = {
  id: '100',
  fields: {
    issuelinks: [
      {
        id: '900',
        type: { id: '10003', name: 'Tests', inward: 'is tested by', outward: 'tests' },
        inwardIssue: { id: '200', key: 'QA-1', fields: { issuetype: { id: '20' }, status: { name: 'Passed' } } },
      },
      {
        id: '901',
        type: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        outwardIssue: { id: '300', key: 'DEV-7', fields: { issuetype: { id: '30' }, status: { name: 'Done' } } },
      },
    ],
  },
};

describe('extractLinks', () => {
  it('maps inward and outward links to rows', () => {
    expect(extractLinks(issue)).toEqual([
      { linkId: '900', reqIssueId: '100', otherIssueId: '200', otherKey: 'QA-1', otherTypeId: '20', otherStatus: 'Passed', linkTypeId: '10003', linkTypeName: 'Tests', direction: 'in' },
      { linkId: '901', reqIssueId: '100', otherIssueId: '300', otherKey: 'DEV-7', otherTypeId: '30', otherStatus: 'Done', linkTypeId: '10000', linkTypeName: 'Blocks', direction: 'out' },
    ]);
  });

  it('returns empty array when issue has no links field', () => {
    expect(extractLinks({ id: '1', fields: {} })).toEqual([]);
  });
});

describe('isCovered', () => {
  const links = extractLinks(issue);

  it('is covered by any link to a verification type when link types are unrestricted', () => {
    expect(isCovered(links, { verificationTypeIds: ['20'], linkTypeIds: [] })).toBe(true);
  });

  it('is not covered when the verification type is not linked', () => {
    expect(isCovered(links, { verificationTypeIds: ['99'], linkTypeIds: [] })).toBe(false);
  });

  it('respects the link type restriction', () => {
    expect(isCovered(links, { verificationTypeIds: ['20'], linkTypeIds: ['10000'] })).toBe(false);
    expect(isCovered(links, { verificationTypeIds: ['20'], linkTypeIds: ['10003'] })).toBe(true);
  });
});
```

`test/core/coverage.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { coverageSummary } from '../../src/core/coverage';

describe('coverageSummary', () => {
  it('computes percent with one decimal', () => {
    expect(coverageSummary(3, 2)).toEqual({ total: 3, covered: 2, uncovered: 1, percent: 66.7 });
  });

  it('coverage of empty set reports percent null', () => {
    expect(coverageSummary(0, 0)).toEqual({ total: 0, covered: 0, uncovered: 0, percent: null });
  });

  it('full coverage is 100', () => {
    expect(coverageSummary(5, 5).percent).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/core/links.test.js test/core/coverage.test.js` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/core/links.js`:
```js
/** Converts the issuelinks field of a requirement into flat link rows. */
export function extractLinks(issue) {
  const raw = issue.fields?.issuelinks ?? [];
  return raw
    .map((link) => {
      const other = link.inwardIssue ?? link.outwardIssue;
      if (!other) {
        return null;
      }
      return {
        linkId: String(link.id),
        reqIssueId: String(issue.id),
        otherIssueId: String(other.id),
        otherKey: other.key,
        otherTypeId: String(other.fields?.issuetype?.id ?? ''),
        otherStatus: other.fields?.status?.name ?? '',
        linkTypeId: String(link.type.id),
        linkTypeName: link.type.name,
        direction: link.inwardIssue ? 'in' : 'out',
      };
    })
    .filter(Boolean);
}

/** A requirement is covered when it links to a verification issue through an allowed link type. */
export function isCovered(links, config) {
  return links.some((l) => config.verificationTypeIds.includes(l.otherTypeId)
    && (config.linkTypeIds.length === 0 || config.linkTypeIds.includes(l.linkTypeId)));
}
```

`src/core/coverage.js`:
```js
/** Coverage numbers for display; percent is null when there are no requirements. */
export function coverageSummary(total, covered) {
  const percent = total === 0 ? null : Math.round((covered / total) * 1000) / 10;
  return { total, covered, uncovered: total - covered, percent };
}
```

- [ ] **Step 4: Run tests** — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/links.js src/core/coverage.js test/core/links.test.js test/core/coverage.test.js
git commit -m "TRACE-4: Add link extraction and coverage rules"
```

---

### Task 5: Jira points budget

**Files:**
- Create: `src/core/budget.js`
- Test: `test/core/budget.test.js`

**Interfaces:**
- Produces: `BUDGET = { windowMs: 900000, maxPoints: 5000 }`; `takePoints(state, points, nowMs, limits = BUDGET): { ok: boolean, state: { windowStart: number, used: number }, waitSeconds: number }`.

- [ ] **Step 1: Write the failing tests**

`test/core/budget.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { takePoints } from '../../src/core/budget';

const limits = { windowMs: 1000, maxPoints: 10 };

describe('takePoints', () => {
  it('starts a window on empty state', () => {
    expect(takePoints(undefined, 4, 5000, limits)).toEqual({ ok: true, state: { windowStart: 5000, used: 4 }, waitSeconds: 0 });
  });

  it('accumulates inside the window', () => {
    const r = takePoints({ windowStart: 5000, used: 4 }, 5, 5500, limits);
    expect(r).toEqual({ ok: true, state: { windowStart: 5000, used: 9 }, waitSeconds: 0 });
  });

  it('refuses when the window would overflow and reports wait until reset', () => {
    const r = takePoints({ windowStart: 5000, used: 9 }, 5, 5500, limits);
    expect(r).toEqual({ ok: false, state: { windowStart: 5000, used: 9 }, waitSeconds: 1 });
  });

  it('opens a new window after expiry', () => {
    const r = takePoints({ windowStart: 5000, used: 10 }, 5, 6001, limits);
    expect(r).toEqual({ ok: true, state: { windowStart: 6001, used: 5 }, waitSeconds: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/core/budget.js`:
```js
export const BUDGET = { windowMs: 15 * 60 * 1000, maxPoints: 5000 };

/** Reserves Jira points in a fixed window; when refused, waitSeconds says when the window resets. */
export function takePoints(state, points, nowMs, limits = BUDGET) {
  const expired = !state || nowMs - state.windowStart >= limits.windowMs;
  const current = expired ? { windowStart: nowMs, used: 0 } : state;
  if (current.used + points > limits.maxPoints) {
    const waitMs = current.windowStart + limits.windowMs - nowMs;
    return { ok: false, state: current, waitSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
  return { ok: true, state: { windowStart: current.windowStart, used: current.used + points }, waitSeconds: 0 };
}
```

- [ ] **Step 4: Run tests** — Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/budget.js test/core/budget.test.js
git commit -m "TRACE-5: Add Jira points budget window"
```

---

### Task 6: CSV serialisation

**Files:**
- Create: `src/core/csv.js`
- Test: `test/core/csv.test.js`

**Interfaces:**
- Produces: `toCsv(columns, rows): string` where `columns = Array<{ key: string, title: string }>`; output uses `\r\n` line endings and starts with a UTF-8 BOM (`﻿`) so Excel detects encoding.

- [ ] **Step 1: Write the failing tests**

`test/core/csv.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/core/csv';

const cols = [{ key: 'key', title: 'Key' }, { key: 'summary', title: 'Summary' }];

describe('toCsv', () => {
  it('writes BOM, header and rows with CRLF', () => {
    expect(toCsv(cols, [{ key: 'R-1', summary: 'Plain' }])).toBe('﻿Key,Summary\r\nR-1,Plain\r\n');
  });

  it('quotes commas, quotes and newlines', () => {
    const out = toCsv(cols, [{ key: 'R-2', summary: 'a, "b"\nc' }]);
    expect(out).toBe('﻿Key,Summary\r\nR-2,"a, ""b""\nc"\r\n');
  });

  it('neutralises formula prefixes', () => {
    const out = toCsv(cols, [{ key: 'R-3', summary: '=HYPERLINK("x")' }, { key: 'R-4', summary: '+1' }, { key: 'R-5', summary: '-2' }, { key: 'R-6', summary: '@a' }]);
    expect(out.split('\r\n').slice(1, 5)).toEqual([
      `R-3,"'=HYPERLINK(""x"")"`,
      "R-4,'+1",
      "R-5,'-2",
      "R-6,'@a",
    ]);
  });

  it('keeps non-ASCII text and renders null as empty', () => {
    expect(toCsv(cols, [{ key: 'R-7', summary: null }, { key: 'R-8', summary: 'Требование ✓' }]))
      .toBe('﻿Key,Summary\r\nR-7,\r\nR-8,Требование ✓\r\n');
  });
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/csv.js`:
```js
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** RFC 4180 CSV with BOM; cells that look like spreadsheet formulas are prefixed with a quote. */
export function toCsv(columns, rows) {
  const header = columns.map((c) => cell(c.title)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(row[c.key])).join(','));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run tests** — Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/csv.js test/core/csv.test.js
git commit -m "TRACE-6: Add safe CSV export"
```

---

### Task 7: Jira client and settings storage

**Files:**
- Create: `src/infra/jira.js`, `src/infra/settings.js`
- Test: `test/infra/jira.test.js`

**Interfaces:**
- Consumes: nothing from core.
- Produces:
  - `class RateLimited extends Error { retryAfterSeconds: number }`
  - `createJira(request)` → `{ searchPage({ jql, fields, nextPageToken, maxResults }): Promise<{ issues, nextPageToken: string|null, points: number }>, hasPermission(asUserRequest, projectId, permission): Promise<boolean> }` where `request(path, init)` returns a `Response`-like `{ status, headers: { get(name) }, json() }`.
  - `SEARCH_PAGE = 100`
  - `settings.getConfig(projectId): Promise<Config>`, `settings.saveConfig(projectId, config): Promise<void>`, `settings.getBudget(): Promise<state|undefined>`, `settings.saveBudget(state): Promise<void>`, `settings.getSyncMeta(projectId): Promise<{ lastSyncId, lastSyncedAt, watermark } | undefined>`, `settings.saveSyncMeta(projectId, meta): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`test/infra/jira.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { createJira, RateLimited } from '../../src/infra/jira';

function response(status, body, headers = {}) {
  return { status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body };
}

describe('searchPage', () => {
  it('posts JQL and returns issues, next token and points spent', async () => {
    const calls = [];
    const jira = createJira(async (path, init) => {
      calls.push({ path, body: JSON.parse(init.body) });
      return response(200, { issues: [{ id: '1' }, { id: '2' }], nextPageToken: 'n2' });
    });
    const page = await jira.searchPage({ jql: 'project = 10000', fields: ['summary'], maxResults: 100 });
    expect(calls[0]).toEqual({ path: '/rest/api/3/search/jql', body: { jql: 'project = 10000', fields: ['summary'], maxResults: 100 } });
    expect(page).toEqual({ issues: [{ id: '1' }, { id: '2' }], nextPageToken: 'n2', points: 3 });
  });

  it('passes nextPageToken and returns null when last page', async () => {
    const jira = createJira(async (_p, init) => {
      expect(JSON.parse(init.body).nextPageToken).toBe('t');
      return response(200, { issues: [] });
    });
    expect((await jira.searchPage({ jql: 'x', fields: [], nextPageToken: 't', maxResults: 100 })).nextPageToken).toBeNull();
  });

  it('throws RateLimited with Retry-After on 429', async () => {
    const jira = createJira(async () => response(429, {}, { 'retry-after': '42' }));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toMatchObject({ name: 'RateLimited', retryAfterSeconds: 42 });
  });

  it('defaults Retry-After to 60 seconds', async () => {
    const jira = createJira(async () => response(429, {}));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toBeInstanceOf(RateLimited);
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('throws a descriptive error on other failures', async () => {
    const jira = createJira(async () => response(400, { errorMessages: ['bad jql'] }));
    await expect(jira.searchPage({ jql: 'x', fields: [], maxResults: 100 })).rejects.toThrow('Jira search failed (400): bad jql');
  });
});

describe('hasPermission', () => {
  it('reads havePermission from mypermissions', async () => {
    const jira = createJira(async () => response(200, {}));
    const asUser = async (path) => {
      expect(path).toBe('/rest/api/3/mypermissions?projectId=10000&permissions=BROWSE_PROJECTS');
      return response(200, { permissions: { BROWSE_PROJECTS: { havePermission: true } } });
    };
    expect(await jira.hasPermission(asUser, '10000', 'BROWSE_PROJECTS')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/infra/jira.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement the client**

`src/infra/jira.js`:
```js
import api, { route } from '@forge/api';

export const SEARCH_PAGE = 100;

/** Raised when Jira answers 429; the caller re-enqueues after retryAfterSeconds. */
export class RateLimited extends Error {
  constructor(retryAfterSeconds) {
    super(`Jira rate limited, retry after ${retryAfterSeconds}s`);
    this.name = 'RateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function failure(res, what) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body.errorMessages ?? []).join('; ');
  } catch {
    detail = '';
  }
  return new Error(`${what} failed (${res.status}): ${detail}`);
}

/** Jira client over an injected request(path, init) function. */
export function createJira(request) {
  return {
    async searchPage({ jql, fields, nextPageToken, maxResults }) {
      const body = { jql, fields, maxResults };
      if (nextPageToken) {
        body.nextPageToken = nextPageToken;
      }
      const res = await request('/rest/api/3/search/jql', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        throw new RateLimited(Number(res.headers.get('retry-after')) || 60);
      }
      if (res.status !== 200) {
        throw await failure(res, 'Jira search');
      }
      const json = await res.json();
      const issues = json.issues ?? [];
      return { issues, nextPageToken: json.nextPageToken ?? null, points: 1 + issues.length };
    },

    async hasPermission(asUserRequest, projectId, permission) {
      const res = await asUserRequest(`/rest/api/3/mypermissions?projectId=${encodeURIComponent(projectId)}&permissions=${permission}`);
      if (res.status !== 200) {
        return false;
      }
      const json = await res.json();
      return json.permissions?.[permission]?.havePermission === true;
    },
  };
}

/** Request function that calls Jira as the app. */
export function asAppRequest(path, init) {
  return api.asApp().requestJira(route`${path}`, init);
}

/** Request function that calls Jira as the current user. */
export function asUserRequest(path, init) {
  return api.asUser().requestJira(route`${path}`, init);
}
```

Note: `route` is a tagged template that escapes interpolations. Verify in the installed typings that interpolating a full path with query string is accepted:
```bash
grep -n "route\|assumeTrustedRoute" node_modules/@forge/api/out/index.d.ts | head
```
If `route` escapes `?` and `&`, replace `route\`${path}\`` with `assumeTrustedRoute(path)` from `@forge/api` (paths here are built only from constants and numeric ids; `encodeURIComponent` is applied to ids).

- [ ] **Step 4: Implement settings**

`src/infra/settings.js`:
```js
import { kvs } from '@forge/kvs';
import { normalizeConfig } from '../core/config';

/** Project config with defaults applied. */
export async function getConfig(projectId) {
  return normalizeConfig(await kvs.get(`config:${projectId}`));
}

/** Persists a normalized project config. */
export async function saveConfig(projectId, config) {
  await kvs.set(`config:${projectId}`, config);
}

/** Installation-wide Jira points budget state. */
export async function getBudget() {
  return kvs.get('budget');
}

/** Saves the Jira points budget state. */
export async function saveBudget(state) {
  await kvs.set('budget', state);
}

/** Last successful sync info for a project. */
export async function getSyncMeta(projectId) {
  return kvs.get(`sync:${projectId}`);
}

/** Saves last successful sync info for a project. */
export async function saveSyncMeta(projectId, meta) {
  await kvs.set(`sync:${projectId}`, meta);
}
```

- [ ] **Step 5: Run tests** — `npx vitest run test/infra/jira.test.js` — Expected: 6 passed. (Vitest does not load `@forge/api` network code during these tests because only `createJira` is exercised; if import fails in node, add `vi.mock('@forge/api', () => ({ default: {}, route: (s) => s }))` at the top of the test file.)

- [ ] **Step 6: Commit**

```bash
git add src/infra/jira.js src/infra/settings.js test/infra/jira.test.js
git commit -m "TRACE-7: Add Jira client with rate-limit handling and KVS settings"
```

---

### Task 8: Sync job logic and SQL repository for the cache

**Files:**
- Create: `src/core/jobs.js`, `src/infra/repo.js`, `test/fakes/memoryRepo.js`
- Test: `test/core/jobs.test.js`

**Interfaces:**
- Consumes: `fingerprint`, `linksHash` (Task 2); `isConfigured` (Task 3); `extractLinks`, `isCovered` (Task 4); `takePoints` (Task 5); `RateLimited`, `SEARCH_PAGE` (Task 7).
- Produces:
  - `issueFields(config): string[]` = `['summary','status','issuetype','issuelinks','updated', ...config.fingerprintFieldIds]` deduped.
  - `toCacheRows(issue, config, syncId, projectId): { req: ReqRow, links: LinkRow[] }` where `ReqRow = { issueId, issueKey, projectId, issueTypeId, summary, statusName, fingerprint, linksHash, covered: 0|1, fieldsJson, jiraUpdatedAt, seenSyncId }`.
  - `runSyncStep(job, deps): Promise<{ status: 'running'|'done'|'waiting', job, delaySeconds: number }>` where `job = { id, kind: 'full-sync'|'incremental-sync', projectId, state: { syncId, jql, nextPageToken, pages, reanchor } }` and `deps = { jira, repo, config, now: () => number, budget: { get, save }, deadlineMs }`.
  - Repo methods (real in `repo.js`, fake in `memoryRepo.js`):
    - `upsertRequirements(rows: ReqRow[])`
    - `replaceLinks(reqIssueIds: string[], links: LinkRow[], fingerprintsByReq: Record<string,string>)` — inserts new links with `confirmed_fingerprint = fingerprintsByReq[req]`, updates descriptive columns of existing links without touching `confirmed_*`, deletes links of these requirements that are not in `links`
    - `refreshSuspect(reqIssueIds: string[])` — `suspect = (confirmed_fingerprint <> req_issue.fingerprint)`
    - `reanchor(reqIssueIds: string[])` — `confirmed_fingerprint = req_issue.fingerprint, suspect = 0`
    - `deleteRequirementsNotSeen(projectId, syncId)`, `deleteRequirements(issueIds)`
    - `createJob(kind, projectId, state, nowIso): Promise<number>`, `getJob(id)`, `saveJob(job, status, nowIso, error?)`, `latestJob(projectId, kind)`

- [ ] **Step 1: Write the in-memory fake repo**

`test/fakes/memoryRepo.js`:
```js
/** In-memory repo mirroring src/infra/repo.js semantics for job tests. */
export function memoryRepo() {
  const reqs = new Map();
  const links = new Map();
  const jobs = new Map();
  let nextJob = 1;
  return {
    reqs,
    links,
    jobs,
    async upsertRequirements(rows) {
      rows.forEach((r) => reqs.set(r.issueId, { ...r }));
    },
    async replaceLinks(reqIssueIds, rows, fingerprintsByReq) {
      const keep = new Set(rows.map((l) => l.linkId));
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId) && !keep.has(l.linkId)).forEach((l) => links.delete(l.linkId));
      rows.forEach((l) => {
        const existing = links.get(l.linkId);
        links.set(l.linkId, existing
          ? { ...existing, ...l }
          : { ...l, confirmedFingerprint: fingerprintsByReq[l.reqIssueId], confirmedBy: null, suspect: 0 });
      });
    },
    async refreshSuspect(reqIssueIds) {
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId)).forEach((l) => {
        l.suspect = l.confirmedFingerprint !== reqs.get(l.reqIssueId)?.fingerprint ? 1 : 0;
      });
    },
    async reanchor(reqIssueIds) {
      [...links.values()].filter((l) => reqIssueIds.includes(l.reqIssueId)).forEach((l) => {
        l.confirmedFingerprint = reqs.get(l.reqIssueId).fingerprint;
        l.suspect = 0;
      });
    },
    async deleteRequirementsNotSeen(projectId, syncId) {
      [...reqs.values()].filter((r) => r.projectId === projectId && r.seenSyncId !== syncId).forEach((r) => {
        reqs.delete(r.issueId);
        [...links.values()].filter((l) => l.reqIssueId === r.issueId).forEach((l) => links.delete(l.linkId));
      });
    },
    async deleteRequirements(issueIds) {
      issueIds.forEach((id) => {
        reqs.delete(id);
        [...links.values()].filter((l) => l.reqIssueId === id).forEach((l) => links.delete(l.linkId));
      });
    },
    async createJob(kind, projectId, state) {
      const id = nextJob++;
      jobs.set(id, { id, kind, projectId, state, status: 'running' });
      return id;
    },
    async getJob(id) {
      return jobs.get(id);
    },
    async saveJob(job, status, _nowIso, error) {
      jobs.set(job.id, { ...job, status, error: error ?? null });
    },
    async latestJob(projectId, kind) {
      return [...jobs.values()].filter((j) => j.projectId === projectId && j.kind === kind).pop();
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`test/core/jobs.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { runSyncStep, toCacheRows, issueFields } from '../../src/core/jobs';
import { RateLimited } from '../../src/infra/jira';
import { memoryRepo } from '../fakes/memoryRepo';

const config = { requirementTypeIds: ['10'], verificationTypeIds: ['20'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

function req(id, summary, linked = true) {
  return {
    id,
    key: `REQ-${id}`,
    fields: {
      summary,
      description: null,
      status: { name: 'To Do' },
      issuetype: { id: '10' },
      updated: '2026-09-24T10:00:00.000+0000',
      issuelinks: linked ? [{ id: `L${id}`, type: { id: '1', name: 'Tests' }, inwardIssue: { id: `T${id}`, key: `QA-${id}`, fields: { issuetype: { id: '20' }, status: { name: 'Passed' } } } }] : [],
    },
  };
}

function fakeJira(pages) {
  let call = 0;
  return {
    calls: () => call,
    async searchPage() {
      const page = pages[call++];
      if (page instanceof Error) {
        throw page;
      }
      return { issues: page.issues, nextPageToken: page.next ?? null, points: 1 + page.issues.length };
    },
  };
}

function budgetStore() {
  let state;
  return { get: async () => state, save: async (s) => { state = s; } };
}

function deps(jira, repo, overrides = {}) {
  let t = 1_000_000;
  return { jira, repo, config, now: () => (t += 10), budget: budgetStore(), deadlineMs: 10_000_000, ...overrides };
}

async function newJob(repo, kind = 'full-sync', extra = {}) {
  const state = { syncId: 7, jql: 'project = 1', nextPageToken: null, pages: 0, reanchor: false, ...extra };
  const id = await repo.createJob(kind, '1', state);
  return repo.getJob(id);
}

describe('issueFields', () => {
  it('always includes structural fields and dedupes', () => {
    expect(issueFields(config)).toEqual(['summary', 'status', 'issuetype', 'issuelinks', 'updated', 'description']);
  });
});

describe('toCacheRows', () => {
  it('marks covered requirement and hashes links', () => {
    const { req: row, links } = toCacheRows(req('1', 'A'), config, 7, '1');
    expect(row).toMatchObject({ issueId: '1', issueKey: 'REQ-1', projectId: '1', covered: 1, seenSyncId: 7, statusName: 'To Do' });
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(links).toHaveLength(1);
  });
});

describe('runSyncStep', () => {
  it('syncs all pages then deletes unseen requirements', async () => {
    const repo = memoryRepo();
    await repo.upsertRequirements([{ issueId: 'old', projectId: '1', seenSyncId: 1, fingerprint: 'x' }]);
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, { issues: [req('2', 'B', false)] }]);
    const job = await newJob(repo);
    const result = await runSyncStep(job, deps(jira, repo));
    expect(result.status).toBe('done');
    expect([...repo.reqs.keys()].sort()).toEqual(['1', '2']);
    expect(repo.reqs.get('2').covered).toBe(0);
    expect(repo.links.get('L1')).toMatchObject({ suspect: 0 });
  });

  it('a changed summary makes existing links suspect; unchanged links stay clean', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A'), req('2', 'B')] }]), repo));
    await runSyncStep(await newJob(repo, 'full-sync', { syncId: 8 }), deps(fakeJira([{ issues: [req('1', 'A changed'), req('2', 'B')] }]), repo));
    expect(repo.links.get('L1').suspect).toBe(1);
    expect(repo.links.get('L2').suspect).toBe(0);
  });

  it('re-anchor on config change clears suspicion instead of flagging everything', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A')] }]), repo));
    const summaryOnly = { ...config, fingerprintFieldIds: ['summary'] };
    const job = await newJob(repo, 'full-sync', { syncId: 8, reanchor: true });
    await runSyncStep(job, deps(fakeJira([{ issues: [req('1', 'A')] }]), repo, { config: summaryOnly }));
    expect(repo.links.get('L1').suspect).toBe(0);
    expect(repo.links.get('L1').confirmedFingerprint).toBe(repo.reqs.get('1').fingerprint);
  });

  it('429 mid-sync re-enqueues from checkpoint', async () => {
    const repo = memoryRepo();
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, new RateLimited(30)]);
    const job = await newJob(repo);
    const first = await runSyncStep(job, deps(jira, repo));
    expect(first).toMatchObject({ status: 'waiting', delaySeconds: 30 });
    expect(first.job.state.nextPageToken).toBe('p2');
    expect(repo.reqs.has('1')).toBe(true);

    const resumed = await runSyncStep(first.job, deps(fakeJira([{ issues: [req('2', 'B')] }]), repo));
    expect(resumed.status).toBe('done');
    expect([...repo.reqs.keys()].sort()).toEqual(['1', '2']);
  });

  it('does not delete unseen rows when a full sync stops early', async () => {
    const repo = memoryRepo();
    await repo.upsertRequirements([{ issueId: 'old', projectId: '1', seenSyncId: 1, fingerprint: 'x' }]);
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, new RateLimited(30)]);
    await runSyncStep(await newJob(repo), deps(jira, repo));
    expect(repo.reqs.has('old')).toBe(true);
  });

  it('waits when the points budget is exhausted without calling Jira', async () => {
    const repo = memoryRepo();
    const jira = fakeJira([{ issues: [req('1', 'A')] }]);
    const budget = { get: async () => ({ windowStart: 1_000_000, used: 5000 }), save: async () => {} };
    const result = await runSyncStep(await newJob(repo), deps(jira, repo, { budget, now: () => 1_000_100 }));
    expect(result.status).toBe('waiting');
    expect(result.delaySeconds).toBeGreaterThan(0);
    expect(jira.calls()).toBe(0);
  });

  it('stops at the deadline and continues later', async () => {
    const repo = memoryRepo();
    const jira = fakeJira([{ issues: [req('1', 'A')], next: 'p2' }, { issues: [req('2', 'B')] }]);
    let t = 0;
    const result = await runSyncStep(await newJob(repo), deps(jira, repo, { now: () => (t += 1000), deadlineMs: 1500 }));
    expect(result).toMatchObject({ status: 'running', delaySeconds: 0 });
    expect(result.job.state.nextPageToken).toBe('p2');
  });

  it('incremental sync removes issues that stopped being requirements and never deletes unseen', async () => {
    const repo = memoryRepo();
    await runSyncStep(await newJob(repo), deps(fakeJira([{ issues: [req('1', 'A'), req('2', 'B')] }]), repo));
    const retyped = req('2', 'B');
    retyped.fields.issuetype.id = '99';
    await runSyncStep(await newJob(repo, 'incremental-sync', { syncId: 9 }), deps(fakeJira([{ issues: [retyped] }]), repo));
    expect([...repo.reqs.keys()]).toEqual(['1']);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run test/core/jobs.test.js` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement the job logic**

`src/core/jobs.js`:
```js
import { fingerprint, linksHash } from './fingerprint';
import { extractLinks, isCovered } from './links';
import { takePoints } from './budget';
import { RateLimited, SEARCH_PAGE } from '../infra/jira';

/** Jira fields requested for requirement issues. */
export function issueFields(config) {
  return [...new Set(['summary', 'status', 'issuetype', 'issuelinks', 'updated', ...config.fingerprintFieldIds])];
}

/** Maps one Jira requirement issue to a cache row and its link rows. */
export function toCacheRows(issue, config, syncId, projectId) {
  const links = extractLinks(issue);
  const extra = Object.fromEntries(config.fingerprintFieldIds
    .filter((id) => !['summary', 'description'].includes(id))
    .map((id) => [id, issue.fields?.[id] ?? null]));
  return {
    req: {
      issueId: String(issue.id),
      issueKey: issue.key,
      projectId: String(projectId),
      issueTypeId: String(issue.fields?.issuetype?.id ?? ''),
      summary: String(issue.fields?.summary ?? '').slice(0, 1024),
      statusName: issue.fields?.status?.name ?? '',
      fingerprint: fingerprint(issue, config.fingerprintFieldIds),
      linksHash: linksHash(links),
      covered: isCovered(links, config) ? 1 : 0,
      fieldsJson: JSON.stringify(extra),
      jiraUpdatedAt: issue.fields?.updated ?? null,
      seenSyncId: syncId,
    },
    links,
  };
}

async function applyPage(issues, job, deps) {
  const isRequirement = (i) => deps.config.requirementTypeIds.includes(String(i.fields?.issuetype?.id));
  const reqIssues = issues.filter(isRequirement);
  const dropped = issues.filter((i) => !isRequirement(i)).map((i) => String(i.id));
  const rows = reqIssues.map((i) => toCacheRows(i, deps.config, job.state.syncId, job.projectId));
  const reqIds = rows.map((r) => r.req.issueId);
  if (rows.length) {
    await deps.repo.upsertRequirements(rows.map((r) => r.req));
    const fingerprints = Object.fromEntries(rows.map((r) => [r.req.issueId, r.req.fingerprint]));
    await deps.repo.replaceLinks(reqIds, rows.flatMap((r) => r.links), fingerprints);
    if (job.state.reanchor) {
      await deps.repo.reanchor(reqIds);
    }
    await deps.repo.refreshSuspect(reqIds);
  }
  if (dropped.length) {
    await deps.repo.deleteRequirements(dropped);
  }
}

/** Runs sync pages until done, deadline, budget exhaustion or a 429; returns how to continue. */
export async function runSyncStep(job, deps) {
  const started = deps.now();
  let current = { ...job, state: { ...job.state } };
  while (deps.now() - started < deps.deadlineMs) {
    const reserve = takePoints(await deps.budget.get(), 1 + SEARCH_PAGE, deps.now());
    if (!reserve.ok) {
      return { status: 'waiting', job: current, delaySeconds: reserve.waitSeconds };
    }
    await deps.budget.save(reserve.state);
    let page;
    try {
      page = await deps.jira.searchPage({
        jql: current.state.jql,
        fields: issueFields(deps.config),
        nextPageToken: current.state.nextPageToken,
        maxResults: SEARCH_PAGE,
      });
    } catch (error) {
      if (error instanceof RateLimited) {
        return { status: 'waiting', job: current, delaySeconds: error.retryAfterSeconds };
      }
      throw error;
    }
    await applyPage(page.issues, current, deps);
    current = { ...current, state: { ...current.state, nextPageToken: page.nextPageToken, pages: current.state.pages + 1 } };
    if (!page.nextPageToken) {
      if (current.kind === 'full-sync') {
        await deps.repo.deleteRequirementsNotSeen(current.projectId, current.state.syncId);
      }
      return { status: 'done', job: current, delaySeconds: 0 };
    }
  }
  return { status: 'running', job: current, delaySeconds: 0 };
}
```

- [ ] **Step 5: Run tests** — `npx vitest run test/core/jobs.test.js` — Expected: all pass. If `@forge/api` import from `src/infra/jira.js` fails under node, add at the top of `test/core/jobs.test.js`: `vi.mock('@forge/api', () => ({ default: {}, route: (s) => s }));` and import `vi` from vitest.

- [ ] **Step 6: Implement the SQL repository (cache + jobs)**

`src/infra/repo.js`:
```js
import { sql } from '@forge/sql';

const CHUNK = 500;

function chunks(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function placeholders(count, width) {
  const row = `(${new Array(width).fill('?').join(',')})`;
  return new Array(count).fill(row).join(',');
}

async function run(query, params = []) {
  return sql.prepare(query).bindParams(...params).execute();
}

/** Inserts or updates requirement cache rows. */
export async function upsertRequirements(rows) {
  for (const part of chunks(rows)) {
    const params = part.flatMap((r) => [r.issueId, r.issueKey, r.projectId, r.issueTypeId, r.summary, r.statusName,
      r.fingerprint, r.linksHash, r.covered, r.fieldsJson, r.jiraUpdatedAt, r.seenSyncId]);
    await run(`INSERT INTO req_issue (issue_id, issue_key, project_id, issue_type_id, summary, status_name,
        fingerprint, links_hash, covered, fields_json, jira_updated_at, seen_sync_id)
      VALUES ${placeholders(part.length, 12)}
      ON DUPLICATE KEY UPDATE issue_key = VALUES(issue_key), project_id = VALUES(project_id),
        issue_type_id = VALUES(issue_type_id), summary = VALUES(summary), status_name = VALUES(status_name),
        fingerprint = VALUES(fingerprint), links_hash = VALUES(links_hash), covered = VALUES(covered),
        fields_json = VALUES(fields_json), jira_updated_at = VALUES(jira_updated_at), seen_sync_id = VALUES(seen_sync_id)`, params);
  }
}

/** Upserts observed links (confirmed_* only set on insert) and deletes vanished links of these requirements. */
export async function replaceLinks(reqIssueIds, links, fingerprintsByReq) {
  for (const part of chunks(links)) {
    const params = part.flatMap((l) => [l.linkId, l.projectId ?? null, l.reqIssueId, l.otherIssueId, l.otherKey, l.otherTypeId,
      l.otherStatus, l.linkTypeId, l.linkTypeName, l.direction, fingerprintsByReq[l.reqIssueId]]);
    await run(`INSERT INTO trace_link (link_id, project_id, req_issue_id, other_issue_id, other_key, other_type_id,
        other_status, link_type_id, link_type_name, direction, confirmed_fingerprint)
      VALUES ${placeholders(part.length, 11)}
      ON DUPLICATE KEY UPDATE req_issue_id = VALUES(req_issue_id), other_issue_id = VALUES(other_issue_id),
        other_key = VALUES(other_key), other_type_id = VALUES(other_type_id), other_status = VALUES(other_status),
        link_type_id = VALUES(link_type_id), link_type_name = VALUES(link_type_name), direction = VALUES(direction)`, params);
  }
  const keep = new Set(links.map((l) => l.linkId));
  for (const part of chunks(reqIssueIds)) {
    const existing = await run(`SELECT link_id FROM trace_link WHERE req_issue_id IN (${part.map(() => '?').join(',')})`, part);
    const gone = existing.rows.map((r) => r.link_id).filter((id) => !keep.has(id));
    for (const g of chunks(gone)) {
      await run(`DELETE FROM trace_link WHERE link_id IN (${g.map(() => '?').join(',')})`, g);
    }
  }
}

/** Recomputes the suspect flag of all links of these requirements. */
export async function refreshSuspect(reqIssueIds) {
  for (const part of chunks(reqIssueIds)) {
    await run(`UPDATE trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
      SET t.suspect = IF(t.confirmed_fingerprint = r.fingerprint, 0, 1), t.project_id = r.project_id
      WHERE t.req_issue_id IN (${part.map(() => '?').join(',')})`, part);
  }
}

/** Anchors links to the current requirement fingerprint and clears suspicion. */
export async function reanchor(reqIssueIds) {
  for (const part of chunks(reqIssueIds)) {
    await run(`UPDATE trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
      SET t.confirmed_fingerprint = r.fingerprint, t.suspect = 0
      WHERE t.req_issue_id IN (${part.map(() => '?').join(',')})`, part);
  }
}

/** Removes requirements (and their links) that a completed full sync did not see. */
export async function deleteRequirementsNotSeen(projectId, syncId) {
  await run('DELETE FROM trace_link WHERE req_issue_id IN (SELECT issue_id FROM req_issue WHERE project_id = ? AND seen_sync_id <> ?)', [projectId, syncId]);
  await run('DELETE FROM req_issue WHERE project_id = ? AND seen_sync_id <> ?', [projectId, syncId]);
}

/** Removes the given requirements and their links. */
export async function deleteRequirements(issueIds) {
  for (const part of chunks(issueIds)) {
    const marks = part.map(() => '?').join(',');
    await run(`DELETE FROM trace_link WHERE req_issue_id IN (${marks})`, part);
    await run(`DELETE FROM req_issue WHERE issue_id IN (${marks})`, part);
  }
}

/** Creates a job row and returns its id. */
export async function createJob(kind, projectId, state, nowIso) {
  const res = await run('INSERT INTO job (kind, project_id, status, state_json, updated_at) VALUES (?, ?, ?, ?, ?)',
    [kind, projectId, 'running', JSON.stringify(state), nowIso]);
  return Number(res.rows.insertId);
}

function toJob(row) {
  return row ? { id: Number(row.id), kind: row.kind, projectId: row.project_id, status: row.status, state: JSON.parse(row.state_json), error: row.error, updatedAt: row.updated_at } : undefined;
}

/** Loads a job by id. */
export async function getJob(id) {
  const res = await run('SELECT * FROM job WHERE id = ?', [id]);
  return toJob(res.rows[0]);
}

/** Saves job state and status. */
export async function saveJob(job, status, nowIso, error) {
  await run('UPDATE job SET status = ?, state_json = ?, error = ?, updated_at = ? WHERE id = ?',
    [status, JSON.stringify(job.state), error ?? null, nowIso, job.id]);
}

/** Most recent job of a kind for a project. */
export async function latestJob(projectId, kind) {
  const res = await run('SELECT * FROM job WHERE project_id = ? AND kind = ? ORDER BY id DESC LIMIT 1', [projectId, kind]);
  return toJob(res.rows[0]);
}
```

Also set `projectId` on link rows before `replaceLinks` so the column is filled on insert: in `src/core/jobs.js` `applyPage`, change `rows.flatMap((r) => r.links)` to `rows.flatMap((r) => r.links.map((l) => ({ ...l, projectId: job.projectId })))`. Re-run `npx vitest run test/core/jobs.test.js` — Expected: still all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/jobs.js src/infra/repo.js test/fakes/memoryRepo.js test/core/jobs.test.js
git commit -m "TRACE-8: Add checkpointed sync job and SQL cache repository"
```

---

### Task 9: Worker, events, reconcile, queue wiring

**Files:**
- Create: `src/infra/queue.js`, `src/handlers/worker.js`, `src/handlers/reconcile.js`
- Modify: `src/handlers/events.js`, `src/index.js`, `manifest.yml`

**Interfaces:**
- Consumes: `runSyncStep` (Task 8), repo functions (Task 8), settings (Task 7), `createJira`, `asAppRequest` (Task 7), `isConfigured` (Task 3), `runMigrations` (Task 1).
- Produces:
  - `enqueueJob(jobId, delaySeconds = 0): Promise<void>` in `src/infra/queue.js`
  - `startSync(projectId, { full, reanchor }): Promise<number>` in `src/handlers/worker.js` — creates job row and enqueues it; returns job id
  - handler exports `jobWorker`, `onIssueEvent`, `reconcile`

- [ ] **Step 1: Queue helper**

`src/infra/queue.js`:
```js
import { Queue } from '@forge/events';

const queue = new Queue({ key: 'trace-jobs' });

/** Schedules a job step; delay is capped at the platform maximum of 900 s. */
export async function enqueueJob(jobId, delaySeconds = 0) {
  await queue.push({ body: { jobId }, delayInSeconds: Math.min(900, Math.max(0, Math.ceil(delaySeconds))) });
}
```

- [ ] **Step 2: Worker**

`src/handlers/worker.js`:
```js
import * as repo from '../infra/repo';
import * as settings from '../infra/settings';
import { createJira, asAppRequest } from '../infra/jira';
import { enqueueJob } from '../infra/queue';
import { runSyncStep } from '../core/jobs';
import { isConfigured } from '../core/config';
import { runMigrations } from '../infra/schema';

const DEADLINE_MS = 700 * 1000;

function jqlFor(projectId, config, full, watermark) {
  const types = config.requirementTypeIds.join(',');
  if (full || !watermark) {
    return `project = ${projectId} AND issuetype in (${types}) ORDER BY id ASC`;
  }
  return `project = ${projectId} AND updated >= "${watermark}" ORDER BY id ASC`;
}

/** Jira JQL date for a watermark 10 minutes before the given time (covers event delays). */
export function watermarkFor(nowMs) {
  const d = new Date(nowMs - 10 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Creates a sync job for a project and enqueues its first step. */
export async function startSync(projectId, { full, reanchor = false }) {
  const config = await settings.getConfig(projectId);
  const meta = await settings.getSyncMeta(projectId);
  const syncId = Date.now();
  const kind = full || !meta ? 'full-sync' : 'incremental-sync';
  const state = { syncId, jql: jqlFor(projectId, config, kind === 'full-sync', meta?.watermark), nextPageToken: null, pages: 0, reanchor, startedAt: Date.now() };
  const id = await repo.createJob(kind, String(projectId), state, new Date().toISOString());
  await enqueueJob(id);
  return id;
}

/** Async consumer: runs one bounded step of a job and re-enqueues until done. */
export async function jobWorker(event) {
  await runMigrations();
  const job = await repo.getJob(event.body.jobId);
  if (!job || job.status === 'done' || job.status === 'failed') {
    return;
  }
  const config = await settings.getConfig(job.projectId);
  if (!isConfigured(config)) {
    await repo.saveJob(job, 'failed', new Date().toISOString(), 'Project is not configured.');
    return;
  }
  const deps = {
    jira: createJira(asAppRequest),
    repo,
    config,
    now: () => Date.now(),
    budget: { get: settings.getBudget, save: settings.saveBudget },
    deadlineMs: DEADLINE_MS,
  };
  try {
    const result = await runSyncStep(job, deps);
    const nowIso = new Date().toISOString();
    if (result.status === 'done') {
      await repo.saveJob(result.job, 'done', nowIso);
      await settings.saveSyncMeta(job.projectId, { lastSyncId: job.state.syncId, lastSyncedAt: nowIso, watermark: watermarkFor(job.state.startedAt) });
      return;
    }
    await repo.saveJob(result.job, result.status, nowIso);
    await enqueueJob(job.id, result.delaySeconds);
  } catch (error) {
    await repo.saveJob(job, 'failed', new Date().toISOString(), String(error.message ?? error));
    throw error;
  }
}
```

- [ ] **Step 3: Events and reconcile**

Replace `src/handlers/events.js`:
```js
import { runMigrations } from '../infra/schema';
import * as settings from '../infra/settings';
import { isConfigured } from '../core/config';
import { startSync } from './worker';

/** Runs SQL migrations when the app is installed or upgraded. */
export async function onLifecycle() {
  const applied = await runMigrations();
  console.log(`migrations applied: ${applied.length}`);
}

/** Any issue or link change in a configured project schedules an incremental sync for it. */
export async function onIssueEvent(event) {
  const projectId = event.issue?.fields?.project?.id ?? event.issueLink?.sourceIssueProjectId ?? event.projectId;
  if (!projectId) {
    return;
  }
  const config = await settings.getConfig(String(projectId));
  if (!isConfigured(config)) {
    return;
  }
  await startSync(String(projectId), { full: false });
}
```

Before relying on the payload paths above, check the actual event shapes: run `forge logs -e development --since 15m` after Step 6 and log `JSON.stringify(Object.keys(event))` temporarily; adjust the `projectId` lookup to the observed fields for `avi:jira:updated:issue`, `avi:jira:created:issuelink`, `avi:jira:deleted:issuelink`, `avi:jira:deleted:issue`, then remove the temporary log.

`src/handlers/reconcile.js`:
```js
import { kvs } from '@forge/kvs';
import { isConfigured } from '../core/config';
import * as settings from '../infra/settings';
import { startSync } from './worker';

/** Hourly: incremental sync for every configured project; weekly full sync. */
export async function reconcile() {
  const projects = (await kvs.get('projects')) ?? [];
  const weekMs = 7 * 24 * 3600 * 1000;
  for (const projectId of projects) {
    const config = await settings.getConfig(projectId);
    if (!isConfigured(config)) {
      continue;
    }
    const meta = await settings.getSyncMeta(projectId);
    const full = !meta || Date.now() - Date.parse(meta.lastSyncedAt) > weekMs;
    await startSync(projectId, { full });
  }
}
```

The `projects` KVS key (list of configured project ids) is written by the settings resolver in Task 11.

Debounce note: bursts of events create many incremental jobs. Mitigation in `onIssueEvent`: skip when `repo.latestJob(projectId, 'incremental-sync')` is `running` or `waiting` and was updated less than 5 minutes ago. Implement:
```js
import * as repo from '../infra/repo';
```
and before `startSync`:
```js
  const last = await repo.latestJob(String(projectId), 'incremental-sync');
  if (last && ['running', 'waiting'].includes(last.status) && Date.now() - Date.parse(last.updatedAt) < 5 * 60 * 1000) {
    return;
  }
```

- [ ] **Step 4: Export handlers**

`src/index.js`:
```js
export { onLifecycle, onIssueEvent } from './handlers/events';
export { jobWorker } from './handlers/worker';
export { reconcile } from './handlers/reconcile';
```

- [ ] **Step 5: Manifest**

The `trigger:` and `function:` lists below **replace** the ones from Task 1 (they already include the lifecycle entries); `consumer:` and `scheduledTrigger:` are new; keep `sql:` as is:
```yaml
  trigger:
    - key: lifecycle
      function: on-lifecycle
      events:
        - avi:forge:installed:app
        - avi:forge:upgraded:app
    - key: issue-events
      function: on-issue-event
      events:
        - avi:jira:updated:issue
        - avi:jira:deleted:issue
        - avi:jira:created:issuelink
        - avi:jira:deleted:issuelink
      filter:
        ignoreSelf: true
  consumer:
    - key: trace-jobs-consumer
      queue: trace-jobs
      function: job-worker
  scheduledTrigger:
    - key: hourly-reconcile
      function: reconcile
      interval: hour
  function:
    - key: on-lifecycle
      handler: index.onLifecycle
    - key: on-issue-event
      handler: index.onIssueEvent
    - key: job-worker
      handler: index.jobWorker
      timeoutSeconds: 900
    - key: reconcile
      handler: index.reconcile
      timeoutSeconds: 900
```

- [ ] **Step 6: Lint, test, deploy**

```bash
npm test
forge lint
forge deploy --non-interactive -e development
forge install --non-interactive --upgrade --site artuplabs-dev.atlassian.net --product jira --environment development
```
Expected: tests pass, lint clean, deploy OK. End-to-end verification happens in Task 12 once the settings UI exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "TRACE-9: Wire sync worker, product events and hourly reconcile"
```

---

### Task 10: Baselines — capture from cache, diff, checksum

**Files:**
- Create: `src/core/baselineDiff.js`, `src/infra/baselineRepo.js`
- Test: `test/core/baselineDiff.test.js`

**Interfaces:**
- Produces:
  - `classifyDiffRow({ leftVersionId, rightVersionId, leftLinksHash, rightLinksHash }): 'added'|'removed'|'changed'|'links-changed'|'unchanged'`
  - `baselineChecksum(members: Array<{ issueId, fingerprint, linksHash }>): string` (members sorted by issueId inside)
  - `baselineRepo.createBaseline({ projectId, name, createdBy, nowIso }): Promise<number>`
  - `baselineRepo.snapshotBatch(baselineId, projectId, afterIssueId, limit): Promise<{ lastIssueId: string|null, copied: number }>`
  - `baselineRepo.completeBaseline(baselineId): Promise<{ memberCount, checksum }>`
  - `baselineRepo.failBaseline(baselineId, message)`
  - `baselineRepo.listBaselines(projectId): Promise<Array<{ id, name, createdBy, createdAt, status, memberCount, checksum }>>`
  - `baselineRepo.diffCounts(leftId, rightId): Promise<{ added, removed, changed, linksChanged }>`
  - `baselineRepo.diffPage(leftId, rightId, afterIssueId, limit): Promise<Array<{ issueId, issueKey, summary, change, leftStatus, rightStatus }>>` (changed rows only, ordered by issue id, both passes merged)

- [ ] **Step 1: Write the failing tests**

`test/core/baselineDiff.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { classifyDiffRow, baselineChecksum } from '../../src/core/baselineDiff';

describe('classifyDiffRow', () => {
  it('detects added, removed, changed, links-changed, unchanged', () => {
    expect(classifyDiffRow({ leftVersionId: null, rightVersionId: 5, leftLinksHash: null, rightLinksHash: 'a' })).toBe('added');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: null, leftLinksHash: 'a', rightLinksHash: null })).toBe('removed');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 6, leftLinksHash: 'a', rightLinksHash: 'a' })).toBe('changed');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 5, leftLinksHash: 'a', rightLinksHash: 'b' })).toBe('links-changed');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 5, leftLinksHash: 'a', rightLinksHash: 'a' })).toBe('unchanged');
  });

  it('content change wins over link change', () => {
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 6, leftLinksHash: 'a', rightLinksHash: 'b' })).toBe('changed');
  });
});

describe('baselineChecksum', () => {
  it('is order independent and sensitive to content', () => {
    const a = { issueId: '1', fingerprint: 'f1', linksHash: 'l1' };
    const b = { issueId: '2', fingerprint: 'f2', linksHash: 'l2' };
    expect(baselineChecksum([a, b])).toBe(baselineChecksum([b, a]));
    expect(baselineChecksum([a, { ...b, fingerprint: 'x' }])).not.toBe(baselineChecksum([a, b]));
  });

  it('handles an empty baseline', () => {
    expect(baselineChecksum([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement pure logic**

`src/core/baselineDiff.js`:
```js
import { createHash } from 'node:crypto';

/** Classifies one issue between a left and right baseline. */
export function classifyDiffRow({ leftVersionId, rightVersionId, leftLinksHash, rightLinksHash }) {
  if (leftVersionId == null) {
    return 'added';
  }
  if (rightVersionId == null) {
    return 'removed';
  }
  if (String(leftVersionId) !== String(rightVersionId)) {
    return 'changed';
  }
  return leftLinksHash === rightLinksHash ? 'unchanged' : 'links-changed';
}

/** SHA-256 over sorted issueId:fingerprint:linksHash triples; proves a baseline was not altered. */
export function baselineChecksum(members) {
  const text = [...members]
    .sort((a, b) => (a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0))
    .map((m) => `${m.issueId}:${m.fingerprint}:${m.linksHash}`)
    .join('\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
```

- [ ] **Step 4: Run tests** — Expected: 4 passed.

- [ ] **Step 5: Implement the baseline repository**

`src/infra/baselineRepo.js`:
```js
import { sql } from '@forge/sql';
import { baselineChecksum, classifyDiffRow } from '../core/baselineDiff';

async function run(query, params = []) {
  return sql.prepare(query).bindParams(...params).execute();
}

/** Creates a baseline row in status "capturing". */
export async function createBaseline({ projectId, name, createdBy, nowIso }) {
  const res = await run('INSERT INTO baseline (project_id, name, created_by, created_at, status) VALUES (?, ?, ?, ?, ?)',
    [projectId, name, createdBy, nowIso, 'capturing']);
  return Number(res.rows.insertId);
}

/** Copies the next batch of cached requirements into the baseline (idempotent). */
export async function snapshotBatch(baselineId, projectId, afterIssueId, limit) {
  const page = await run(`SELECT issue_id FROM req_issue WHERE project_id = ? AND issue_id > ? ORDER BY issue_id LIMIT ${Number(limit)}`,
    [projectId, afterIssueId ?? '']);
  const ids = page.rows.map((r) => r.issue_id);
  if (!ids.length) {
    return { lastIssueId: null, copied: 0 };
  }
  const marks = ids.map(() => '?').join(',');
  await run(`INSERT IGNORE INTO issue_version (issue_id, fingerprint, issue_key, summary, status_name, fields_json)
    SELECT issue_id, fingerprint, issue_key, summary, status_name, fields_json FROM req_issue WHERE issue_id IN (${marks})`, ids);
  await run(`INSERT IGNORE INTO baseline_member (baseline_id, issue_id, version_id, links_hash)
    SELECT ?, r.issue_id, v.id, r.links_hash FROM req_issue r
    JOIN issue_version v ON v.issue_id = r.issue_id AND v.fingerprint = r.fingerprint
    WHERE r.issue_id IN (${marks})`, [baselineId, ...ids]);
  return { lastIssueId: ids[ids.length - 1], copied: ids.length };
}

/** Computes checksum over all members and marks the baseline complete. */
export async function completeBaseline(baselineId) {
  const members = [];
  let after = '';
  for (;;) {
    const page = await run(`SELECT m.issue_id, v.fingerprint, m.links_hash FROM baseline_member m
      JOIN issue_version v ON v.id = m.version_id
      WHERE m.baseline_id = ? AND m.issue_id > ? ORDER BY m.issue_id LIMIT 1000`, [baselineId, after]);
    if (!page.rows.length) {
      break;
    }
    page.rows.forEach((r) => members.push({ issueId: r.issue_id, fingerprint: r.fingerprint, linksHash: r.links_hash }));
    after = page.rows[page.rows.length - 1].issue_id;
  }
  const checksum = baselineChecksum(members);
  await run('UPDATE baseline SET status = ?, member_count = ?, checksum = ? WHERE id = ? AND status = ?',
    ['complete', members.length, checksum, baselineId, 'capturing']);
  return { memberCount: members.length, checksum };
}

/** Marks a baseline as failed. */
export async function failBaseline(baselineId, message) {
  await run('UPDATE baseline SET status = ?, name = CONCAT(name, ?) WHERE id = ? AND status = ?',
    ['failed', ` (failed: ${String(message).slice(0, 100)})`, baselineId, 'capturing']);
}

/** Baselines of a project, newest first. */
export async function listBaselines(projectId) {
  const res = await run('SELECT * FROM baseline WHERE project_id = ? ORDER BY id DESC LIMIT 100', [projectId]);
  return res.rows.map((r) => ({ id: Number(r.id), name: r.name, createdBy: r.created_by, createdAt: r.created_at, status: r.status, memberCount: Number(r.member_count), checksum: r.checksum }));
}

/** Counts of added, removed, changed and link-changed issues between two baselines. */
export async function diffCounts(leftId, rightId) {
  const both = await run(`SELECT
      SUM(CASE WHEN l.version_id <> r.version_id THEN 1 ELSE 0 END) AS changed,
      SUM(CASE WHEN l.version_id = r.version_id AND l.links_hash <> r.links_hash THEN 1 ELSE 0 END) AS links_changed
    FROM baseline_member l JOIN baseline_member r ON r.issue_id = l.issue_id AND r.baseline_id = ?
    WHERE l.baseline_id = ?`, [rightId, leftId]);
  const removed = await run(`SELECT COUNT(*) AS n FROM baseline_member l
    LEFT JOIN baseline_member r ON r.issue_id = l.issue_id AND r.baseline_id = ?
    WHERE l.baseline_id = ? AND r.issue_id IS NULL`, [rightId, leftId]);
  const added = await run(`SELECT COUNT(*) AS n FROM baseline_member r
    LEFT JOIN baseline_member l ON l.issue_id = r.issue_id AND l.baseline_id = ?
    WHERE r.baseline_id = ? AND l.issue_id IS NULL`, [leftId, rightId]);
  return {
    added: Number(added.rows[0].n),
    removed: Number(removed.rows[0].n),
    changed: Number(both.rows[0].changed ?? 0),
    linksChanged: Number(both.rows[0].links_changed ?? 0),
  };
}

/** One page of differing issues between two baselines, ordered by issue id. */
export async function diffPage(leftId, rightId, afterIssueId, limit) {
  const lim = Number(limit);
  const leftSide = await run(`SELECT l.issue_id, l.version_id AS lv, r.version_id AS rv, l.links_hash AS lh, r.links_hash AS rh
    FROM baseline_member l LEFT JOIN baseline_member r ON r.issue_id = l.issue_id AND r.baseline_id = ?
    WHERE l.baseline_id = ? AND l.issue_id > ? AND (r.issue_id IS NULL OR l.version_id <> r.version_id OR l.links_hash <> r.links_hash)
    ORDER BY l.issue_id LIMIT ${lim}`, [rightId, leftId, afterIssueId ?? '']);
  const addedSide = await run(`SELECT r.issue_id, NULL AS lv, r.version_id AS rv, NULL AS lh, r.links_hash AS rh
    FROM baseline_member r LEFT JOIN baseline_member l ON l.issue_id = r.issue_id AND l.baseline_id = ?
    WHERE r.baseline_id = ? AND r.issue_id > ? AND l.issue_id IS NULL
    ORDER BY r.issue_id LIMIT ${lim}`, [leftId, rightId, afterIssueId ?? '']);
  const rows = [...leftSide.rows, ...addedSide.rows]
    .sort((a, b) => (a.issue_id < b.issue_id ? -1 : 1))
    .slice(0, lim);
  if (!rows.length) {
    return [];
  }
  const versionIds = [...new Set(rows.flatMap((r) => [r.lv, r.rv]).filter((v) => v != null))];
  const versions = await run(`SELECT id, issue_key, summary, status_name FROM issue_version WHERE id IN (${versionIds.map(() => '?').join(',')})`, versionIds);
  const byId = new Map(versions.rows.map((v) => [String(v.id), v]));
  return rows.map((r) => {
    const left = r.lv != null ? byId.get(String(r.lv)) : null;
    const right = r.rv != null ? byId.get(String(r.rv)) : null;
    const shown = right ?? left;
    return {
      issueId: r.issue_id,
      issueKey: shown.issue_key,
      summary: shown.summary,
      change: classifyDiffRow({ leftVersionId: r.lv, rightVersionId: r.rv, leftLinksHash: r.lh, rightLinksHash: r.rh }),
      leftStatus: left?.status_name ?? '',
      rightStatus: right?.status_name ?? '',
    };
  });
}
```

- [ ] **Step 6: Baseline capture job in the worker**

In `src/handlers/worker.js` add (and import `* as baselineRepo from '../infra/baselineRepo'`):
```js
/** Creates a baseline after an incremental sync and enqueues its capture. */
export async function startBaseline(projectId, name, accountId) {
  const baselineId = await baselineRepo.createBaseline({ projectId: String(projectId), name, createdBy: accountId, nowIso: new Date().toISOString() });
  const syncJobId = await startSync(String(projectId), { full: false });
  const id = await repo.createJob('baseline', String(projectId), { baselineId, afterIssueId: '', waitForJobId: syncJobId }, new Date().toISOString());
  await enqueueJob(id, 30);
  return baselineId;
}

async function runBaselineStep(job) {
  const sync = await repo.getJob(job.state.waitForJobId);
  if (sync && !['done', 'failed'].includes(sync.status)) {
    await repo.saveJob(job, 'waiting', new Date().toISOString());
    await enqueueJob(job.id, 60);
    return;
  }
  const started = Date.now();
  let state = { ...job.state };
  while (Date.now() - started < DEADLINE_MS) {
    const batch = await baselineRepo.snapshotBatch(state.baselineId, job.projectId, state.afterIssueId, 500);
    if (!batch.lastIssueId) {
      await baselineRepo.completeBaseline(state.baselineId);
      await repo.saveJob({ ...job, state }, 'done', new Date().toISOString());
      return;
    }
    state = { ...state, afterIssueId: batch.lastIssueId };
  }
  await repo.saveJob({ ...job, state }, 'running', new Date().toISOString());
  await enqueueJob(job.id);
}
```

In `jobWorker`, right after loading the job, dispatch:
```js
  if (job.kind === 'baseline') {
    try {
      await runBaselineStep(job);
    } catch (error) {
      await baselineRepo.failBaseline(job.state.baselineId, error.message ?? error);
      await repo.saveJob(job, 'failed', new Date().toISOString(), String(error.message ?? error));
    }
    return;
  }
```

A baseline is taken from the cache after the incremental sync finishes, so it costs no extra Jira points beyond that sync.

- [ ] **Step 7: Run tests, lint**

`npm test && forge lint` — Expected: all pass, lint clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "TRACE-10: Add baselines captured from cache with SQL diff and checksum"
```

---

### Task 11: Resolvers with permission checks and licensing gate

**Files:**
- Create: `src/handlers/resolvers.js`, `src/core/access.js`
- Test: `test/core/access.test.js`
- Modify: `src/index.js`, `manifest.yml`

**Interfaces:**
- Consumes: everything above.
- Produces resolver keys (UI calls these via `invoke`):
  - `getOverview({ projectId })` → `{ configured, config, sync: { lastSyncedAt, job }, coverage: coverageSummary }`
  - `getGaps({ projectId, after })` → `{ rows: [{ issueId, issueKey, summary, statusName }], next }`
  - `getSuspects({ projectId, after })` → `{ rows: [{ linkId, reqKey, reqSummary, otherKey, linkTypeName, otherStatus }], next }`
  - `confirmLink({ projectId, linkId })` → `{ ok: true }`
  - `getIssueTrace({ issueId, projectId })` → `{ isRequirement, covered, links: [{ linkId, otherKey, linkTypeName, otherStatus, suspect }] }`
  - `listBaselines({ projectId })`, `createBaseline({ projectId, name })` → `{ baselineId }`
  - `getDiff({ projectId, leftId, rightId, after })` → `{ counts, rows, next }`
  - `exportCsv({ projectId, kind: 'gaps'|'suspects'|'diff', leftId?, rightId? })` → `{ csv, truncated }` (max 5 000 rows)
  - `getIssueTypes({ projectId })`, `getLinkTypes()`, `getSettings({ projectId })`, `saveSettings({ projectId, config })` → `{ errors }`
  - `startFullSync({ projectId })`
  - `access.decide({ environmentType, license, havePermission })` → `{ allowed: boolean, reason: 'ok'|'no-permission'|'unlicensed' }`

- [ ] **Step 1: Failing tests for the access rule**

`test/core/access.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { decide } from '../../src/core/access';

describe('decide', () => {
  it('denies without Jira permission', () => {
    expect(decide({ environmentType: 'PRODUCTION', license: { isActive: true }, havePermission: false })).toEqual({ allowed: false, reason: 'no-permission' });
  });

  it('denies an inactive license in production', () => {
    expect(decide({ environmentType: 'PRODUCTION', license: { isActive: false }, havePermission: true })).toEqual({ allowed: false, reason: 'unlicensed' });
  });

  it('allows development without a license object', () => {
    expect(decide({ environmentType: 'DEVELOPMENT', license: undefined, havePermission: true })).toEqual({ allowed: true, reason: 'ok' });
  });

  it('allows active license', () => {
    expect(decide({ environmentType: 'PRODUCTION', license: { isActive: true }, havePermission: true })).toEqual({ allowed: true, reason: 'ok' });
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `src/core/access.js`:
```js
/** Access decision for a resolver call: Jira permission first, then license in production. */
export function decide({ environmentType, license, havePermission }) {
  if (!havePermission) {
    return { allowed: false, reason: 'no-permission' };
  }
  if (environmentType === 'PRODUCTION' && license?.isActive !== true) {
    return { allowed: false, reason: 'unlicensed' };
  }
  return { allowed: true, reason: 'ok' };
}
```
Run tests — Expected: 4 passed.

- [ ] **Step 3: Add read queries to `src/infra/repo.js`**

```js
/** Totals for coverage of a project. */
export async function coverageCounts(projectId) {
  const res = await run('SELECT COUNT(*) AS total, COALESCE(SUM(covered), 0) AS covered FROM req_issue WHERE project_id = ?', [projectId]);
  return { total: Number(res.rows[0].total), covered: Number(res.rows[0].covered) };
}

/** Uncovered requirements page ordered by issue id. */
export async function gapsPage(projectId, after, limit) {
  const res = await run(`SELECT issue_id, issue_key, summary, status_name FROM req_issue
    WHERE project_id = ? AND covered = 0 AND issue_id > ? ORDER BY issue_id LIMIT ${Number(limit)}`, [projectId, after ?? '']);
  return res.rows.map((r) => ({ issueId: r.issue_id, issueKey: r.issue_key, summary: r.summary, statusName: r.status_name }));
}

/** Suspect links page ordered by link id. */
export async function suspectsPage(projectId, after, limit) {
  const res = await run(`SELECT t.link_id, r.issue_key, r.summary, t.other_key, t.link_type_name, t.other_status
    FROM trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
    WHERE t.project_id = ? AND t.suspect = 1 AND t.link_id > ? ORDER BY t.link_id LIMIT ${Number(limit)}`, [projectId, after ?? '']);
  return res.rows.map((r) => ({ linkId: r.link_id, reqKey: r.issue_key, reqSummary: r.summary, otherKey: r.other_key, linkTypeName: r.link_type_name, otherStatus: r.other_status }));
}

/** Confirms a link: anchors it to the requirement's current fingerprint. */
export async function confirmLink(projectId, linkId, accountId, nowIso) {
  await run(`UPDATE trace_link t JOIN req_issue r ON r.issue_id = t.req_issue_id
    SET t.confirmed_fingerprint = r.fingerprint, t.suspect = 0, t.confirmed_by = ?, t.confirmed_at = ?
    WHERE t.link_id = ? AND t.project_id = ?`, [accountId, nowIso, linkId, projectId]);
}

/** Cached trace info for one issue. */
export async function issueTrace(issueId) {
  const req = await run('SELECT covered FROM req_issue WHERE issue_id = ?', [issueId]);
  const links = await run('SELECT link_id, other_key, link_type_name, other_status, suspect FROM trace_link WHERE req_issue_id = ? ORDER BY link_id', [issueId]);
  return {
    isRequirement: req.rows.length > 0,
    covered: req.rows[0]?.covered === 1,
    links: links.rows.map((l) => ({ linkId: l.link_id, otherKey: l.other_key, linkTypeName: l.link_type_name, otherStatus: l.other_status, suspect: Number(l.suspect) === 1 })),
  };
}
```

- [ ] **Step 4: Resolvers**

`src/handlers/resolvers.js`:
```js
import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import * as repo from '../infra/repo';
import * as baselineRepo from '../infra/baselineRepo';
import * as settings from '../infra/settings';
import { createJira, asUserRequest } from '../infra/jira';
import { decide } from '../core/access';
import { coverageSummary } from '../core/coverage';
import { normalizeConfig, validateConfig, diffConfig } from '../core/config';
import { toCsv } from '../core/csv';
import { startSync, startBaseline } from './worker';

const PAGE = 200;
const CSV_MAX = 5000;
const resolver = new Resolver();
const jira = createJira(() => { throw new Error('app requests are not used in resolvers'); });

async function guard(req, projectId, permission) {
  const havePermission = await jira.hasPermission(asUserRequest, projectId, permission);
  const verdict = decide({ environmentType: req.context.environmentType, license: req.context.license, havePermission });
  if (!verdict.allowed) {
    throw new Error(verdict.reason);
  }
}

function define(key, permission, fn) {
  resolver.define(key, async (req) => {
    const projectId = String(req.payload.projectId ?? req.context.extension?.project?.id ?? '');
    await guard(req, projectId, permission);
    return fn({ ...req.payload, projectId }, req.context);
  });
}

async function pageAll(fetchPage, cursorOf) {
  const rows = [];
  let after = '';
  while (rows.length < CSV_MAX) {
    const page = await fetchPage(after);
    if (!page.length) {
      break;
    }
    rows.push(...page);
    after = cursorOf(page[page.length - 1]);
  }
  return { rows: rows.slice(0, CSV_MAX), truncated: rows.length >= CSV_MAX };
}

define('getOverview', 'BROWSE_PROJECTS', async ({ projectId }) => {
  const config = await settings.getConfig(projectId);
  const configured = validateConfig(config).length === 0;
  const counts = await repo.coverageCounts(projectId);
  const meta = await settings.getSyncMeta(projectId);
  const job = (await repo.latestJob(projectId, 'full-sync')) ?? null;
  return { configured, config, sync: { lastSyncedAt: meta?.lastSyncedAt ?? null, job }, coverage: coverageSummary(counts.total, counts.covered) };
});

define('getGaps', 'BROWSE_PROJECTS', async ({ projectId, after }) => {
  const rows = await repo.gapsPage(projectId, after, PAGE);
  return { rows, next: rows.length === PAGE ? rows[rows.length - 1].issueId : null };
});

define('getSuspects', 'BROWSE_PROJECTS', async ({ projectId, after }) => {
  const rows = await repo.suspectsPage(projectId, after, PAGE);
  return { rows, next: rows.length === PAGE ? rows[rows.length - 1].linkId : null };
});

define('confirmLink', 'EDIT_ISSUES', async ({ projectId, linkId }, context) => {
  await repo.confirmLink(projectId, String(linkId), context.accountId, new Date().toISOString());
  return { ok: true };
});

define('getIssueTrace', 'BROWSE_PROJECTS', async ({ issueId }, context) => repo.issueTrace(String(issueId ?? context.extension?.issue?.id)));

define('listBaselines', 'BROWSE_PROJECTS', async ({ projectId }) => baselineRepo.listBaselines(projectId));

define('createBaseline', 'EDIT_ISSUES', async ({ projectId, name }, context) => {
  const clean = String(name ?? '').trim().slice(0, 200);
  if (!clean) {
    throw new Error('Baseline name is required.');
  }
  return { baselineId: await startBaseline(projectId, clean, context.accountId) };
});

define('getDiff', 'BROWSE_PROJECTS', async ({ leftId, rightId, after }) => {
  const counts = await baselineRepo.diffCounts(Number(leftId), Number(rightId));
  const rows = await baselineRepo.diffPage(Number(leftId), Number(rightId), after, PAGE);
  return { counts, rows, next: rows.length === PAGE ? rows[rows.length - 1].issueId : null };
});

define('exportCsv', 'BROWSE_PROJECTS', async ({ projectId, kind, leftId, rightId }) => {
  if (kind === 'gaps') {
    const { rows, truncated } = await pageAll((a) => repo.gapsPage(projectId, a, 500), (r) => r.issueId);
    return { csv: toCsv([{ key: 'issueKey', title: 'Requirement' }, { key: 'summary', title: 'Summary' }, { key: 'statusName', title: 'Status' }], rows), truncated };
  }
  if (kind === 'suspects') {
    const { rows, truncated } = await pageAll((a) => repo.suspectsPage(projectId, a, 500), (r) => r.linkId);
    return { csv: toCsv([{ key: 'reqKey', title: 'Requirement' }, { key: 'reqSummary', title: 'Summary' }, { key: 'linkTypeName', title: 'Link' }, { key: 'otherKey', title: 'Linked issue' }, { key: 'otherStatus', title: 'Linked status' }], rows), truncated };
  }
  const { rows, truncated } = await pageAll((a) => baselineRepo.diffPage(Number(leftId), Number(rightId), a, 500), (r) => r.issueId);
  return { csv: toCsv([{ key: 'issueKey', title: 'Requirement' }, { key: 'summary', title: 'Summary' }, { key: 'change', title: 'Change' }, { key: 'leftStatus', title: 'Status before' }, { key: 'rightStatus', title: 'Status after' }], rows), truncated };
});

define('getIssueTypes', 'BROWSE_PROJECTS', async ({ projectId }) => {
  const res = await asUserRequest(`/rest/api/3/issuetype/project?projectId=${encodeURIComponent(projectId)}`);
  const types = await res.json();
  return types.filter((t) => !t.subtask).map((t) => ({ id: String(t.id), name: t.name }));
});

define('getLinkTypes', 'BROWSE_PROJECTS', async () => {
  const res = await asUserRequest('/rest/api/3/issueLinkType');
  const json = await res.json();
  return (json.issueLinkTypes ?? []).map((t) => ({ id: String(t.id), name: t.name }));
});

define('getSettings', 'ADMINISTER_PROJECTS', async ({ projectId }) => settings.getConfig(projectId));

define('saveSettings', 'ADMINISTER_PROJECTS', async ({ projectId, config }) => {
  const next = normalizeConfig(config);
  const errors = validateConfig(next);
  if (errors.length) {
    return { errors };
  }
  const previous = await settings.getConfig(projectId);
  await settings.saveConfig(projectId, next);
  const projects = new Set((await kvs.get('projects')) ?? []);
  projects.add(projectId);
  await kvs.set('projects', [...projects]);
  const change = diffConfig(previous, next);
  const firstTime = validateConfig(previous).length > 0;
  if (firstTime || change.needsResync) {
    await startSync(projectId, { full: true, reanchor: !firstTime && change.needsReanchor });
  }
  return { errors: [] };
});

define('startFullSync', 'ADMINISTER_PROJECTS', async ({ projectId }) => ({ jobId: await startSync(projectId, { full: true }) }));

export const resolverHandler = resolver.getDefinitions();
```

Note on the issue panel: `projectId` comes from `context.extension.project.id` for both the project page and the issue panel — verify in logs during Task 13 and adjust the fallback in `define` if the issue panel context names it differently.

- [ ] **Step 5: Export and manifest**

`src/index.js` add: `export { resolverHandler } from './handlers/resolvers';`

Manifest `function:` add:
```yaml
    - key: resolver
      handler: index.resolverHandler
```

- [ ] **Step 6: Test, lint, commit**

```bash
npm test && forge lint
git add -A
git commit -m "TRACE-11: Add resolvers with permission and license checks"
```

---

### Task 12: Project page UI

**Files:**
- Create: `src/frontend/projectPage.jsx`
- Modify: `manifest.yml`

**Interfaces:**
- Consumes: resolver keys from Task 11.

- [ ] **Step 1: Check the CSV download capability**

```bash
grep -rln "download" node_modules/@forge/bridge/out --include=*.d.ts
```
The only download API found on 2026-09-24 was `objectStore.download` (Object Store, Preview — not usable in v1). v1 therefore shows CSV in a modal inside a `CodeBlock` with "Select all and copy" instructions. Keep this decision unless the check finds a GA file-download API.

- [ ] **Step 2: Write the page**

`src/frontend/projectPage.jsx`:
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, CodeBlock, DynamicTable, EmptyState, Form, FormFooter, Heading, Inline, Label,
  Lozenge, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition, ProgressBar, SectionMessage,
  Select, Spinner, Stack, Tab, TabList, TabPanel, Tabs, Text, Textfield, useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

function errorText(error) {
  const message = String(error?.message ?? error);
  if (message.includes('no-permission')) {
    return 'You do not have permission for this action in this project.';
  }
  if (message.includes('unlicensed')) {
    return 'ArtUp Trace license is not active on this site.';
  }
  return message;
}

function CsvModal({ csv, truncated, onClose }) {
  return (
    <ModalTransition>
      {csv !== null && (
        <Modal onClose={onClose} width="x-large">
          <ModalHeader><ModalTitle>CSV export</ModalTitle></ModalHeader>
          <ModalBody>
            <Stack space="space.100">
              {truncated && <SectionMessage appearance="warning"><Text>Only the first 5 000 rows are included.</Text></SectionMessage>}
              <Text>Copy the text below and save it as a .csv file.</Text>
              <CodeBlock language="text" text={csv} />
            </Stack>
          </ModalBody>
          <ModalFooter><Button onClick={onClose}>Close</Button></ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}

function useExport(projectId) {
  const [csv, setCsv] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const run = async (payload) => {
    const res = await invoke('exportCsv', { projectId, ...payload });
    setTruncated(res.truncated);
    setCsv(res.csv);
  };
  return { csv, truncated, run, close: () => setCsv(null) };
}

function CoverageTab({ projectId, overview }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const exporter = useExport(projectId);
  const load = useCallback(async (after) => {
    const res = await invoke('getGaps', { projectId, after });
    setRows((prev) => (after ? [...prev, ...res.rows] : res.rows));
    setNext(res.next);
  }, [projectId]);
  useEffect(() => { load(''); }, [load]);
  const c = overview.coverage;
  if (c.total === 0) {
    return <EmptyState header="No requirements found" description="No issues of the requirement types were found yet. If you just saved settings, the first sync may take up to an hour on large projects." />;
  }
  return (
    <Stack space="space.200">
      <Heading as="h3">{`${c.percent}% covered — ${c.covered} of ${c.total} requirements`}</Heading>
      <ProgressBar value={c.total ? c.covered / c.total : 0} />
      <Inline space="space.100"><Text>{`${c.uncovered} without a verification link`}</Text><Button onClick={() => exporter.run({ kind: 'gaps' })}>Export CSV</Button></Inline>
      <DynamicTable
        head={{ cells: [{ key: 'k', content: 'Requirement' }, { key: 's', content: 'Summary' }, { key: 't', content: 'Status' }] }}
        rows={rows.map((r) => ({ key: r.issueId, cells: [{ key: 'k', content: r.issueKey }, { key: 's', content: r.summary }, { key: 't', content: r.statusName }] }))}
      />
      {next && <Button onClick={() => load(next)}>Load more</Button>}
      <CsvModal csv={exporter.csv} truncated={exporter.truncated} onClose={exporter.close} />
    </Stack>
  );
}

function SuspectTab({ projectId }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const exporter = useExport(projectId);
  const load = useCallback(async (after) => {
    const res = await invoke('getSuspects', { projectId, after });
    setRows((prev) => (after ? [...prev, ...res.rows] : res.rows));
    setNext(res.next);
  }, [projectId]);
  useEffect(() => { load(''); }, [load]);
  const confirm = async (linkId) => {
    try {
      await invoke('confirmLink', { projectId, linkId });
      setRows((prev) => prev.filter((r) => r.linkId !== linkId));
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!rows.length) {
    return <EmptyState header="No suspect links" description="A link becomes suspect when its requirement's summary or description changes after the link was confirmed." />;
  }
  return (
    <Stack space="space.200">
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      <Inline space="space.100"><Text>{`${rows.length}${next ? '+' : ''} suspect links`}</Text><Button onClick={() => exporter.run({ kind: 'suspects' })}>Export CSV</Button></Inline>
      <DynamicTable
        head={{ cells: [{ key: 'r', content: 'Requirement' }, { key: 's', content: 'Summary' }, { key: 'l', content: 'Link' }, { key: 'o', content: 'Linked issue' }, { key: 'a', content: '' }] }}
        rows={rows.map((r) => ({
          key: r.linkId,
          cells: [
            { key: 'r', content: r.reqKey },
            { key: 's', content: r.reqSummary },
            { key: 'l', content: r.linkTypeName },
            { key: 'o', content: `${r.otherKey} (${r.otherStatus})` },
            { key: 'a', content: <Button onClick={() => confirm(r.linkId)}>Confirm</Button> },
          ],
        }))}
      />
      {next && <Button onClick={() => load(next)}>Load more</Button>}
      <CsvModal csv={exporter.csv} truncated={exporter.truncated} onClose={exporter.close} />
    </Stack>
  );
}

function BaselinesTab({ projectId }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);
  const exporter = useExport(projectId);
  const refresh = useCallback(async () => setList(await invoke('listBaselines', { projectId })), [projectId]);
  useEffect(() => { refresh(); }, [refresh]);
  const create = async () => {
    try {
      await invoke('createBaseline', { projectId, name });
      setName('');
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const compare = async () => setDiff(await invoke('getDiff', { projectId, leftId: left.value, rightId: right.value, after: '' }));
  const options = list.filter((b) => b.status === 'complete').map((b) => ({ label: `${b.name} — ${b.createdAt.slice(0, 10)} (${b.memberCount})`, value: b.id }));
  return (
    <Stack space="space.300">
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      <Inline space="space.100" alignBlock="end">
        <Box><Label labelFor="bl-name">New baseline name</Label><Textfield id="bl-name" value={name} onChange={(e) => setName(e.target.value)} /></Box>
        <Button appearance="primary" isDisabled={!name.trim()} onClick={create}>Create baseline</Button>
        <Button onClick={refresh}>Refresh</Button>
      </Inline>
      <DynamicTable
        head={{ cells: [{ key: 'n', content: 'Name' }, { key: 'd', content: 'Created' }, { key: 'c', content: 'Requirements' }, { key: 's', content: 'Status' }] }}
        rows={list.map((b) => ({
          key: String(b.id),
          cells: [
            { key: 'n', content: b.name },
            { key: 'd', content: b.createdAt.slice(0, 16).replace('T', ' ') },
            { key: 'c', content: String(b.memberCount) },
            { key: 's', content: <Lozenge appearance={b.status === 'complete' ? 'success' : b.status === 'failed' ? 'removed' : 'inprogress'}>{b.status}</Lozenge> },
          ],
        }))}
      />
      <Heading as="h4">Compare two baselines</Heading>
      <Inline space="space.100" alignBlock="end">
        <Box><Label labelFor="bl-left">Before</Label><Select inputId="bl-left" options={options} onChange={setLeft} /></Box>
        <Box><Label labelFor="bl-right">After</Label><Select inputId="bl-right" options={options} onChange={setRight} /></Box>
        <Button isDisabled={!left || !right || left.value === right.value} onClick={compare}>Compare</Button>
      </Inline>
      {diff && (
        <Stack space="space.100">
          <Text>{`Added ${diff.counts.added} · Removed ${diff.counts.removed} · Changed ${diff.counts.changed} · Links changed ${diff.counts.linksChanged}`}</Text>
          <Button onClick={() => exporter.run({ kind: 'diff', leftId: left.value, rightId: right.value })}>Export CSV</Button>
          <DynamicTable
            head={{ cells: [{ key: 'k', content: 'Requirement' }, { key: 's', content: 'Summary' }, { key: 'c', content: 'Change' }, { key: 'b', content: 'Status before → after' }] }}
            rows={diff.rows.map((r) => ({ key: r.issueId, cells: [{ key: 'k', content: r.issueKey }, { key: 's', content: r.summary }, { key: 'c', content: r.change }, { key: 'b', content: `${r.leftStatus || '—'} → ${r.rightStatus || '—'}` }] }))}
          />
        </Stack>
      )}
      <CsvModal csv={exporter.csv} truncated={exporter.truncated} onClose={exporter.close} />
    </Stack>
  );
}

function SettingsTab({ projectId, onSaved }) {
  const [types, setTypes] = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [config, setConfig] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        setTypes(await invoke('getIssueTypes', { projectId }));
        setLinkTypes(await invoke('getLinkTypes', { projectId }));
        setConfig(await invoke('getSettings', { projectId }));
      } catch (e) {
        setErrors([errorText(e)]);
      }
    })();
  }, [projectId]);
  if (errors.length && !config) {
    return <SectionMessage appearance="warning"><Text>{errors[0]}</Text></SectionMessage>;
  }
  if (!config) {
    return <Spinner />;
  }
  const opts = (list) => list.map((t) => ({ label: t.name, value: t.id }));
  const pick = (list, ids) => opts(list).filter((o) => ids.includes(o.value));
  const setIds = (key) => (selected) => setConfig({ ...config, [key]: (selected ?? []).map((s) => s.value) });
  const save = async () => {
    const res = await invoke('saveSettings', { projectId, config });
    setErrors(res.errors);
    setSaved(res.errors.length === 0);
    if (!res.errors.length) {
      onSaved();
    }
  };
  return (
    <Form onSubmit={save}>
      <Stack space="space.200">
        {errors.map((e) => <SectionMessage key={e} appearance="error"><Text>{e}</Text></SectionMessage>)}
        {saved && <SectionMessage appearance="success"><Text>Saved. Sync started in the background.</Text></SectionMessage>}
        <Box><Label labelFor="req-types">Requirement issue types</Label><Select inputId="req-types" isMulti options={opts(types)} value={pick(types, config.requirementTypeIds)} onChange={setIds('requirementTypeIds')} /></Box>
        <Box><Label labelFor="ver-types">Verification issue types (tests, tasks that prove a requirement)</Label><Select inputId="ver-types" isMulti options={opts(types)} value={pick(types, config.verificationTypeIds)} onChange={setIds('verificationTypeIds')} /></Box>
        <Box><Label labelFor="link-types">Link types that count (empty = any)</Label><Select inputId="link-types" isMulti options={opts(linkTypes)} value={pick(linkTypes, config.linkTypeIds)} onChange={setIds('linkTypeIds')} /></Box>
        <Text>Links become suspect when the requirement's summary or description changes.</Text>
        <FormFooter><ButtonGroup><Button type="submit" appearance="primary">Save</Button></ButtonGroup></FormFooter>
      </Stack>
    </Form>
  );
}

const App = () => {
  const context = useProductContext();
  const projectId = context?.extension?.project?.id;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      setOverview(await invoke('getOverview', { projectId }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [projectId]);
  useEffect(() => {
    if (projectId) {
      load();
    }
  }, [projectId, load]);
  if (error) {
    return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  }
  if (!overview) {
    return <Spinner />;
  }
  const job = overview.sync.job;
  return (
    <Stack space="space.200">
      {!overview.configured && <SectionMessage appearance="information" title="Configure requirement types"><Text>Open the Settings tab and choose which issue types are requirements and which verify them.</Text></SectionMessage>}
      {job && ['running', 'waiting'].includes(job.status) && <SectionMessage appearance="information"><Text>{`Sync in progress: ${job.state.pages} pages read. Results update as it runs.`}</Text></SectionMessage>}
      {job?.status === 'failed' && <SectionMessage appearance="error"><Text>{`Last sync failed: ${job.error}`}</Text></SectionMessage>}
      {overview.sync.lastSyncedAt && <Text>{`Last synced ${overview.sync.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC`}</Text>}
      <Tabs id="trace-tabs">
        <TabList>
          <Tab>Coverage</Tab>
          <Tab>Suspect links</Tab>
          <Tab>Baselines</Tab>
          <Tab>Settings</Tab>
        </TabList>
        <TabPanel>{overview.configured ? <CoverageTab projectId={projectId} overview={overview} /> : <Text>Not configured yet.</Text>}</TabPanel>
        <TabPanel>{overview.configured ? <SuspectTab projectId={projectId} /> : <Text>Not configured yet.</Text>}</TabPanel>
        <TabPanel>{overview.configured ? <BaselinesTab projectId={projectId} /> : <Text>Not configured yet.</Text>}</TabPanel>
        <TabPanel><SettingsTab projectId={projectId} onSaved={load} /></TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 3: Manifest**

Add under `modules:`:
```yaml
  jira:projectPage:
    - key: trace-project-page
      resource: project-page
      resolver:
        function: resolver
      render: native
      title: ArtUp Trace
```
Add top-level:
```yaml
resources:
  - key: project-page
    path: src/frontend/projectPage.jsx
```

- [ ] **Step 4: Deploy and verify on the dev site**

```bash
forge lint
forge deploy --non-interactive -e development
forge install --non-interactive --upgrade --site artuplabs-dev.atlassian.net --product jira --environment development
```
Manual check on `artuplabs-dev.atlassian.net` (create test data first: in a project create issue types or use Story as requirement and Task as verification; create 5 stories, link 3 of them to tasks with "relates to"):
1. Project sidebar → ArtUp Trace → banner "Configure requirement types"; Coverage tab says "Not configured yet." (Review Focus 2).
2. Settings: requirement = Story, verification = Task, Save → "Saved. Sync started".
3. Within ~2 min (`forge logs -e development`): Coverage shows `60% covered — 3 of 5`.
4. Edit the summary of a linked story → within ~5 min the link appears in Suspect links; Confirm removes it.
5. Change the story's assignee only → no new suspect link (Review Focus 1).
6. Create baseline "B1", edit one story summary, add one story, create "B2", compare → Added 1, Changed 1.
7. Export CSV on Coverage; paste into a spreadsheet; a summary starting with `=` shows as text (Review Focus 4).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "TRACE-12: Add project page with coverage, suspect links, baselines and settings"
```

---

### Task 13: Issue panel

**Files:**
- Create: `src/frontend/issuePanel.jsx`
- Modify: `manifest.yml`

- [ ] **Step 1: Write the panel**

`src/frontend/issuePanel.jsx`:
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Button, DynamicTable, Lozenge, SectionMessage, Spinner, Stack, Text, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const context = useProductContext();
  const issueId = context?.extension?.issue?.id;
  const projectId = context?.extension?.project?.id;
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      setTrace(await invoke('getIssueTrace', { issueId, projectId }));
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  }, [issueId, projectId]);
  useEffect(() => {
    if (issueId) {
      load();
    }
  }, [issueId, load]);
  if (error) {
    return <SectionMessage appearance="warning"><Text>{error}</Text></SectionMessage>;
  }
  if (!trace) {
    return <Spinner />;
  }
  if (!trace.isRequirement) {
    return <Text>This issue is not tracked as a requirement. Configure requirement types on the project's ArtUp Trace page.</Text>;
  }
  const confirm = async (linkId) => {
    await invoke('confirmLink', { projectId, linkId });
    await load();
  };
  return (
    <Stack space="space.100">
      <Lozenge appearance={trace.covered ? 'success' : 'removed'}>{trace.covered ? 'Covered' : 'Not covered'}</Lozenge>
      <DynamicTable
        head={{ cells: [{ key: 'l', content: 'Link' }, { key: 'o', content: 'Issue' }, { key: 's', content: 'State' }] }}
        rows={trace.links.map((l) => ({
          key: l.linkId,
          cells: [
            { key: 'l', content: l.linkTypeName },
            { key: 'o', content: `${l.otherKey} (${l.otherStatus})` },
            { key: 's', content: l.suspect ? <Button onClick={() => confirm(l.linkId)}>Suspect — confirm</Button> : <Lozenge appearance="success">OK</Lozenge> },
          ],
        }))}
      />
      <Text>Data refreshes within a few minutes of changes.</Text>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 2: Manifest**

Replace the scaffold `jira:issuePanel` entry with:
```yaml
  jira:issuePanel:
    - key: trace-issue-panel
      resource: issue-panel
      resolver:
        function: resolver
      render: native
      title: ArtUp Trace
      icon: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg
```
Add resource:
```yaml
  - key: issue-panel
    path: src/frontend/issuePanel.jsx
```
The icon URL is on `developer.atlassian.com` (Atlassian-hosted, not egress). If `forge eligibility` later flags it, replace with a bundled `resource:` icon.

- [ ] **Step 3: Deploy and verify**

```bash
forge lint && forge deploy --non-interactive -e development
```
Open a linked story → panel shows Covered + its links; after editing its summary, a "Suspect — confirm" button appears within minutes; clicking it returns to OK.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "TRACE-13: Add issue panel with link state and confirm"
```

---

### Task 14: Licensing, eligibility, staging load check

**Files:**
- Modify: `manifest.yml`, `README.md`

- [ ] **Step 1: Enable licensing**

Add under `app:` in `manifest.yml`:
```yaml
  licensing:
    enabled: true
```

- [ ] **Step 2: Runs on Atlassian eligibility**

```bash
forge lint
forge deploy --non-interactive -e development
forge eligibility -e development
```
Expected: eligible for Runs on Atlassian. If not, fix the reported item (most likely the remote icon URL) and re-run.

- [ ] **Step 3: Staging load check (measures the estimates in 16 §B)**

1. Deploy to staging: `forge deploy --non-interactive -e staging` and install on the dev site for staging: `forge install --non-interactive --site artuplabs-dev.atlassian.net --product jira --environment staging` (uninstall the development install first if Jira refuses two installs of the same app).
2. Create 2 000 requirement issues with a script using the Jira REST API as your user (bulk create `POST /rest/api/3/issue/bulk`, 50 per call), linking every second one to a task.
3. Configure the project, start a full sync, and record from `forge logs -e staging`: total pages, wall time, whether any 429 occurred, and SQL errors.
4. Create two baselines and compare them; record wall time of `getDiff`.
5. Write results (numbers + date) into `README.md` under "Measured on staging".

Expected: full sync of 2 000 issues completes (≈ 21 pages, ≈ 2 100 points); coverage 50%; `getDiff` responds < 5 s.

- [ ] **Step 4: README**

Replace the template `README.md` with: what the app does (4 bullets), how to run tests (`npm test`), how to deploy (the commands above), the data it stores (requirement key, summary, status, fingerprint hashes, link metadata, baselines — no descriptions), and the "Measured on staging" section.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "TRACE-14: Enable licensing and record staging measurements"
```

---

## Self-review notes

- Spec coverage (15 §4 candidate 1): coverage report → Tasks 4, 8, 11, 12; suspect links + one-click confirm → Tasks 2, 8, 11, 12, 13; baselines + compare → Task 10, 12; CSV → Tasks 6, 11, 12; zero new issue types / no Jira writes → Global Constraints; Forge SQL from v1, dedup schema, paged diff → Tasks 1, 10; points budget + checkpointed jobs + reconcile → Tasks 5, 8, 9 (16 §G 1–3). Confluence macro and Xray/Zephyr are out of scope per 15 §4 and 16 §F.
- Known open risks carried forward (not placeholders): exact product-event payload paths (Task 9 Step 3 instructs to log and adjust), `route` vs `assumeTrustedRoute` for paths with query strings (Task 7 Step 3), no GA file download (Task 12 Step 1).
