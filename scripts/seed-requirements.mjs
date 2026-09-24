#!/usr/bin/env node
/**
 * Seeds a Jira project with requirement and verification issues for a manual load check.
 * Node 22+, no dependencies. Do not run automatically; see README "Load check (pending)".
 *
 * Env vars:
 *   JIRA_SITE   Jira Cloud site host (default artuplabs-dev.atlassian.net)
 *   JIRA_EMAIL  Atlassian account email (required)
 *   JIRA_TOKEN  Atlassian API token (required)
 *   PROJECT_KEY Jira project key to seed into (required)
 *   COUNT       Number of requirement issues to create (default 300)
 *   REQ_TYPE    Issue type name for requirements (default "Story")
 *   VERIFY_TYPE Issue type name for verification issues (default "Task")
 *   LINK_TYPE   Issue link type name (default "Relates")
 */

const site = process.env.JIRA_SITE ?? 'artuplabs-dev.atlassian.net';
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_TOKEN;
const projectKey = process.env.PROJECT_KEY;
const count = Number(process.env.COUNT ?? 300);
const reqType = process.env.REQ_TYPE ?? 'Story';
const verifyType = process.env.VERIFY_TYPE ?? 'Task';
const linkType = process.env.LINK_TYPE ?? 'Relates';

const BATCH_SIZE = 50;
const MAX_RETRIES = 10;
const BASE_URL = `https://${site}`;

if (!email || !token || !projectKey) {
  console.error('Missing required env vars: JIRA_EMAIL, JIRA_TOKEN, PROJECT_KEY are required.');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

/** Resolves after the given number of milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Issues a Jira REST request, honouring HTTP 429 by sleeping for Retry-After seconds and retrying, up to MAX_RETRIES times before throwing. */
async function jiraFetch(path, options) {
  let attempt = 0;
  for (;;) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (res.status !== 429) {
      return res;
    }
    attempt += 1;
    if (attempt > MAX_RETRIES) {
      throw new Error(`Exceeded ${MAX_RETRIES} retries for ${path} after repeated HTTP 429 responses.`);
    }
    const retryAfterSeconds = Number(res.headers.get('retry-after') ?? '5');
    console.log(`429 received, sleeping ${retryAfterSeconds}s before retry (attempt ${attempt}/${MAX_RETRIES})...`);
    await sleep(retryAfterSeconds * 1000);
  }
}

/** Builds a bulk-create issueUpdates payload for the given issue type and summaries. */
function buildIssueUpdates(typeName, summaries) {
  return summaries.map((summary) => ({
    fields: {
      project: { key: projectKey },
      issuetype: { name: typeName },
      summary,
    },
  }));
}

/** Creates issues in batches of BATCH_SIZE via POST /rest/api/3/issue/bulk; returns created issue keys in input order. */
async function bulkCreate(typeName, summaries) {
  const keys = [];
  for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
    const batch = summaries.slice(i, i + BATCH_SIZE);
    const res = await jiraFetch('/rest/api/3/issue/bulk', {
      method: 'POST',
      body: JSON.stringify({ issueUpdates: buildIssueUpdates(typeName, batch) }),
    });
    if (res.status !== 201) {
      const body = await res.text();
      throw new Error(`Bulk create failed (${res.status}): ${body}`);
    }
    const json = await res.json();
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      console.error(`Bulk create returned ${json.errors.length} error(s):`);
      console.error(JSON.stringify(json.errors, null, 2));
      process.exit(1);
    }
    for (const issue of json.issues) {
      keys.push(issue.key);
    }
    console.log(`Created ${keys.length}/${summaries.length} ${typeName} issues...`);
  }
  return keys;
}

/** Links two issues with the configured link type via POST /rest/api/3/issueLink. */
async function linkIssues(inwardKey, outwardKey) {
  const res = await jiraFetch('/rest/api/3/issueLink', {
    method: 'POST',
    body: JSON.stringify({
      type: { name: linkType },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    }),
  });
  if (res.status !== 201) {
    const body = await res.text();
    throw new Error(`Link failed for ${inwardKey} -> ${outwardKey} (${res.status}): ${body}`);
  }
}

/** Seeds COUNT requirement issues, one verification issue per even-numbered requirement, and links each pair. */
async function main() {
  console.log(`Seeding ${count} requirement issues (${reqType}) into ${projectKey} on ${site}...`);
  const reqSummaries = Array.from({ length: count }, (_, i) => `Seed requirement ${i + 1}`);
  const reqKeys = await bulkCreate(reqType, reqSummaries);

  const evenIndices = reqKeys.map((_, i) => i).filter((i) => (i + 1) % 2 === 0);
  const verifySummaries = evenIndices.map((i) => `Seed verification for ${reqKeys[i]}`);
  console.log(`Seeding ${verifySummaries.length} verification issues (${verifyType})...`);
  const verifyKeys = await bulkCreate(verifyType, verifySummaries);

  console.log(`Linking ${verifyKeys.length} pairs with link type "${linkType}"...`);
  let linked = 0;
  for (let i = 0; i < evenIndices.length; i += 1) {
    const reqKey = reqKeys[evenIndices[i]];
    const verifyKey = verifyKeys[i];
    await linkIssues(reqKey, verifyKey);
    linked += 1;
    if (linked % 20 === 0 || linked === verifyKeys.length) {
      console.log(`Linked ${linked}/${verifyKeys.length}...`);
    }
  }

  console.log('--- Summary ---');
  console.log(`Requirements created: ${reqKeys.length}`);
  console.log(`Verification issues created: ${verifyKeys.length}`);
  console.log(`Links created: ${linked}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
