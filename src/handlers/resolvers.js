import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import * as repo from '../infra/repo';
import * as baselineRepo from '../infra/baselineRepo';
import * as settings from '../infra/settings';
import { createJira, asUserRequest } from '../infra/jira';
import { decide, isJiraId, isBaselineId, isLicenseActive } from '../core/access';
import { coverageSummary } from '../core/coverage';
import { normalizeConfig, validateConfig, diffConfig } from '../core/config';
import { capCsv } from '../core/csv';
import { runMigrations } from '../infra/schema';
import { startSync, startBaseline } from './worker';

const PAGE = 200;
const CSV_MAX = 5000;
const CSV_MAX_CHARS = 4_000_000;
const resolver = new Resolver();
const jira = createJira(() => { throw new Error('app requests are not used in resolvers'); });

/** Validates a required Jira id (issue or link id) coming from the UI; throws bad-request when malformed. */
function requireJiraId(value) {
  if (!isJiraId(value)) {
    throw new Error('bad-request');
  }
  return String(value);
}

/** Validates an optional paging cursor as a Jira id; returns null when absent so callers can pass it straight to SQL. */
function optionalJiraId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requireJiraId(value);
}

/** Validates a required baseline id coming from the UI; throws bad-request when malformed. */
function requireBaselineId(value) {
  if (!isBaselineId(value)) {
    throw new Error('bad-request');
  }
  return Number(value);
}

/** Confirms both baseline ids belong to the given project; throws bad-request otherwise. */
async function requireBaselinesInProject(projectId, leftId, rightId) {
  const [leftProject, rightProject] = await Promise.all([baselineRepo.baselineProject(leftId), baselineRepo.baselineProject(rightId)]);
  if (leftProject !== projectId || rightProject !== projectId) {
    throw new Error('bad-request');
  }
}

/** Jira permission first, then license in production; the license may carry `active` or `isActive`, decide() expects `isActive`. */
async function guard(req, projectId, permission) {
  const havePermission = await jira.hasPermission(asUserRequest, projectId, permission);
  const license = req.context.license ? { isActive: isLicenseActive(req.context.license) } : undefined;
  const verdict = decide({ environmentType: req.context.environmentType, license, havePermission });
  if (!verdict.allowed) {
    throw new Error(verdict.reason);
  }
}

/** Registers a resolver that rejects a non-numeric project id, authorizes the call, then runs fn with the resolved payload and context. */
function define(key, permission, fn) {
  resolver.define(key, async (req) => {
    const projectId = String(req.payload?.projectId ?? req.context.extension?.project?.id ?? '');
    if (!isJiraId(projectId)) {
      throw new Error('bad-request');
    }
    await guard(req, projectId, permission);
    return fn({ ...req.payload, projectId }, req.context);
  });
}

/** Pages through fetchPage until exhausted or CSV_MAX rows collected. */
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
  await runMigrations();
  const config = await settings.getConfig(projectId);
  const configured = validateConfig(config).length === 0;
  const counts = await repo.coverageCounts(projectId);
  const meta = await settings.getSyncMeta(projectId);
  const job = (await repo.latestJob(projectId, 'full-sync')) ?? null;
  return { configured, config, sync: { lastSyncedAt: meta?.lastSyncedAt ?? null, job }, coverage: coverageSummary(counts.total, counts.covered) };
});

define('getGaps', 'BROWSE_PROJECTS', async ({ projectId, after }) => {
  const cursor = optionalJiraId(after);
  const rows = await repo.gapsPage(projectId, cursor, PAGE);
  return { rows, next: rows.length === PAGE ? rows[rows.length - 1].issueId : null };
});

define('getSuspects', 'BROWSE_PROJECTS', async ({ projectId, after }) => {
  const cursor = optionalJiraId(after);
  const rows = await repo.suspectsPage(projectId, cursor, PAGE);
  return { rows, next: rows.length === PAGE ? rows[rows.length - 1].linkId : null };
});

define('confirmLink', 'EDIT_ISSUES', async ({ projectId, linkId }, context) => {
  const affected = await repo.confirmLink(projectId, requireJiraId(linkId), context.accountId, new Date().toISOString());
  return { ok: affected > 0 };
});

define('getIssueTrace', 'BROWSE_PROJECTS', async ({ issueId, projectId }, context) => repo.issueTrace(requireJiraId(issueId ?? context.extension?.issue?.id), projectId));

define('listBaselines', 'BROWSE_PROJECTS', async ({ projectId }) => baselineRepo.listBaselines(projectId));

define('createBaseline', 'EDIT_ISSUES', async ({ projectId, name }, context) => {
  const clean = String(name ?? '').trim().slice(0, 200);
  if (!clean) {
    throw new Error('Baseline name is required.');
  }
  return { baselineId: await startBaseline(projectId, clean, context.accountId) };
});

define('getDiff', 'BROWSE_PROJECTS', async ({ projectId, leftId, rightId, after }) => {
  const left = requireBaselineId(leftId);
  const right = requireBaselineId(rightId);
  await requireBaselinesInProject(projectId, left, right);
  const cursor = optionalJiraId(after);
  const counts = await baselineRepo.diffCounts(left, right);
  const rows = await baselineRepo.diffPage(left, right, cursor, PAGE);
  return { counts, rows, next: rows.length === PAGE ? rows[rows.length - 1].issueId : null };
});

define('exportCsv', 'BROWSE_PROJECTS', async ({ projectId, kind, leftId, rightId }) => {
  if (kind === 'gaps') {
    const { rows, truncated } = await pageAll((a) => repo.gapsPage(projectId, a, 500), (r) => r.issueId);
    const capped = capCsv([{ key: 'issueKey', title: 'Requirement' }, { key: 'summary', title: 'Summary' }, { key: 'statusName', title: 'Status' }], rows, CSV_MAX_CHARS);
    return { csv: capped.csv, truncated: truncated || capped.truncated };
  }
  if (kind === 'suspects') {
    const { rows, truncated } = await pageAll((a) => repo.suspectsPage(projectId, a, 500), (r) => r.linkId);
    const capped = capCsv([{ key: 'reqKey', title: 'Requirement' }, { key: 'reqSummary', title: 'Summary' }, { key: 'linkTypeName', title: 'Link' }, { key: 'otherKey', title: 'Linked issue' }, { key: 'otherStatus', title: 'Linked status' }], rows, CSV_MAX_CHARS);
    return { csv: capped.csv, truncated: truncated || capped.truncated };
  }
  const left = requireBaselineId(leftId);
  const right = requireBaselineId(rightId);
  await requireBaselinesInProject(projectId, left, right);
  const { rows, truncated } = await pageAll((a) => baselineRepo.diffPage(left, right, a, 500), (r) => r.issueId);
  const capped = capCsv([{ key: 'issueKey', title: 'Requirement' }, { key: 'summary', title: 'Summary' }, { key: 'change', title: 'Change' }, { key: 'leftStatus', title: 'Status before' }, { key: 'rightStatus', title: 'Status after' }], rows, CSV_MAX_CHARS);
  return { csv: capped.csv, truncated: truncated || capped.truncated };
});

define('getIssueTypes', 'BROWSE_PROJECTS', async ({ projectId }) => {
  const res = await asUserRequest(`/rest/api/3/issuetype/project?projectId=${encodeURIComponent(projectId)}`);
  if (res.status !== 200) {
    throw new Error(`Jira request failed (${res.status})`);
  }
  const types = await res.json();
  return types.filter((t) => !t.subtask).map((t) => ({ id: String(t.id), name: t.name }));
});

define('getLinkTypes', 'BROWSE_PROJECTS', async () => {
  const res = await asUserRequest('/rest/api/3/issueLinkType');
  if (res.status !== 200) {
    throw new Error(`Jira request failed (${res.status})`);
  }
  const json = await res.json();
  return (json.issueLinkTypes ?? []).map((t) => ({ id: String(t.id), name: t.name }));
});

define('getSettings', 'ADMINISTER_PROJECTS', async ({ projectId }) => settings.getConfig(projectId));

/** Saves project config; fingerprint fields are not editable in v1 (R26), so the stored ones are always kept and no re-anchor is ever requested. */
define('saveSettings', 'ADMINISTER_PROJECTS', async ({ projectId, config }) => {
  const previous = await settings.getConfig(projectId);
  const next = normalizeConfig({ ...config, fingerprintFieldIds: previous.fingerprintFieldIds });
  const errors = validateConfig(next);
  if (errors.length) {
    return { errors };
  }
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
