> **2026-09-28:** the app stores no personal data (account ids removed, TRACE-30). Developer console → Distribution → "Does your app store personal data?" = **No**.

# ArtUp Trace — Privacy & Security tab draft

Status: draft answers for the Marketplace listing's Privacy & Security tab.
Built to be consistent with `~/DistributB2B/site/privacy.html` and
`~/DistributB2B/site/security.html` (last updated 2026-09-25) and verified
against `~/Projects/My/artuplabs-trace/manifest.yml` and `README.md`. Where
the listing form's exact question wording differs from what's assumed here,
adjust the wording but keep the facts — do not add anything not backed by
those four sources.

## 1. What data is stored, and where

Source: `manifest.yml` (`sql: engine: mysql` under Forge SQL, `permissions.scopes: storage:app`),
`README.md` § "Data stored", `site/privacy.html` §4.2, `site/security.html` §1.

All app data lives in **Forge SQL** (app-owned MySQL-compatible database) and
**Forge storage / KVS**, both provided by Atlassian, scoped per installation,
in the customer's data residency region as handled by Atlassian. ArtUp Labs
operates no servers of its own and never receives a copy.

| Table / store | Contents |
|---|---|
| `req_issue` (Forge SQL) | Issue id, issue key, project id, issue type id, summary, status name, a SHA-256 fingerprint hash of summary+description (never the field values), a SHA-256 links hash, per-field hashes for any extra fingerprint fields (always empty in v1), sync bookkeeping. |
| `trace_link` (Forge SQL) | Link id, requirement issue id, linked issue id/key/type/status, link type, direction, the fingerprint hash the link was last confirmed against, the time it was last confirmed, whether it is currently suspect. No account id of who confirmed it. |
| `issue_version` (Forge SQL) | One row per distinct fingerprint seen for an issue: issue id, issue key, summary, status name, the fingerprint hash, per-field hashes — used only so a baseline can point at the version it captured. |
| `baseline` / `baseline_member` (Forge SQL) | A named, timestamped snapshot of a project's requirements (issue id, version id, links hash, status name) plus a checksum. |
| `job` (Forge SQL) | Checkpointed state for full-sync, incremental-sync and baseline-capture background jobs. Finished jobs are deleted after 7 days. |
| Project config (Forge KVS) | Which issue types count as requirements/verification, which link types count as coverage; the fingerprint field list (fixed to summary+description in v1). |

**Not stored:** full issue description text (only a hash of it), names,
email addresses or Atlassian account ids (no personal data at all), passwords, access tokens, payment data. CSV exports are generated and
downloaded directly to the requesting user's browser — ArtUp Labs never
receives a copy (`site/privacy.html` §4.3).

## 2. Scopes requested, and why

Source: `manifest.yml` lines 62–66 (`permissions.scopes: [read:jira-work,
read:jira-user, storage:app]`) — verified: the manifest requests exactly
these three scopes and no others (in particular, no `write:*` scope; STATE.md
2026-09-25 notes a prior `write:jira-work` scope was removed because the app
never writes to Jira).

| Scope | Justification |
|---|---|
| `read:jira-work` | Read issues, issue links, issue types, link types and project data needed to compute coverage, detect suspect links, and build baselines. Used by every resolver that reads Jira (`getIssueTypes`, `getLinkTypes`, and the sync/reconcile jobs reading issues and links). |
| `read:jira-user` | Read basic information about the current user, used for the Jira permission check (`/rest/api/3/mypermissions`) that runs before every action. |
| `storage:app` | Store the app's own settings, requirement/link records, issue versions, baselines and job bookkeeping in Forge SQL and Forge KVS — the tables listed in §1. |

No scope grants write access to Jira issues, comments, or attachments. Every
resolver additionally re-checks the calling user's Jira project permission
(`BROWSE_PROJECTS`, `EDIT_ISSUES`, or `ADMINISTER_PROJECTS` depending on the
action — see `src/handlers/resolvers.js`'s `define()`/`guard()` helpers)
before it runs, so a scope grant alone never lets a user see or change
something their own Jira permissions would not already allow.

## 3. Egress / outbound network calls

**None.** Source: `README.md` ("`forge eligibility` checks the deployed
version against the Runs on Atlassian program (no external egress, no
remotes/Connect modules, bundled resources only)"), `manifest.yml` (no
`remote` module, no external fetch permissions declared), `site/security.html`
§1 ("no outbound network calls (no egress). It cannot send Jira data anywhere
outside Atlassian").

`forge eligibility` was confirmed against the **development** environment as
of 2026-09-25 (v4.0.0, per STATE.md). **`[TODO]`** re-run
`forge eligibility -e production` after the first production deploy — the
README lists this as still outstanding — before asserting Runs on Atlassian
eligibility on the live listing.

## 4. Data retention and deletion on uninstall

Source: `site/privacy.html` §7, consistent with Atlassian's own Forge storage
lifecycle (linked from that page: https://developer.atlassian.com/platform/forge/storage/).

- App data is kept for as long as the app stays installed, so coverage,
  confirmations and baselines remain available.
- On uninstall, Atlassian deletes the app's Forge-stored data (Forge SQL and
  Forge storage/KVS) according to Atlassian's own Forge data retention
  policy. ArtUp Labs does not separately retain a copy, because it never
  receives one.
- Finished background jobs (`job` table) are deleted after 7 days regardless
  of uninstall, per the app's own housekeeping.
- Platform logs (see §6 below) are retained by Atlassian under Atlassian's
  own policies, not ArtUp Labs'.

**`[TODO]`** if the listing form asks for an exact retention *duration* after
uninstall (some Marketplace privacy-tab forms ask for a number of days),
Atlassian's Forge storage documentation should be the source for that number
— it was not independently re-verified in this pass beyond the link already
cited on the privacy page.

## 5. Sub-processors

Source: `site/privacy.html` §8 (table, verbatim facts reused here).

| Sub-processor | Purpose | Location |
|---|---|---|
| Atlassian | Hosting and running the app (Forge), storage (Forge SQL and Forge storage), platform logs, Marketplace licensing and billing | Customer's data residency region as handled by Atlassian |

No other sub-processors process App data. (Zoho Mail, named in
`privacy.html` §10, only ever receives support-email correspondence sent
voluntarily by a user to hello@/security@artuplabs.com — it never receives
Jira app data, and should not be listed as an App-data sub-processor.)

## 6. Logging

Source: `site/privacy.html` §4.4, `site/security.html` §3.

The Atlassian Forge platform keeps logs of errors raised by the app. By
design the app does not log issue content — logs contain error messages
only. ArtUp Labs can view these logs in the Atlassian developer console
(`forge logs`) to diagnose problems; it does not export or copy them
elsewhere.

## 7. Compliance / data-processing role

Source: `site/privacy.html` §3.

For data the app processes within a customer's Jira site, the customer
(the organisation that installed the app) is the data controller and ArtUp
Labs acts as a processor, processing data only to provide the app's
features, on Atlassian's infrastructure. **`[TODO]`** whether a signed Data
Processing Addendum (DPA) is needed for this listing: per
https://developer.atlassian.com/platform/marketplace/listing-forge-apps/ , a
DPA is required if the vendor is a data processor under GDPR — confirm with
Atlassian Partner support whether Atlassian's standard end-user agreement
already covers this for a Runs on Atlassian app with no egress, or whether a
separate DPA must be drafted.

## 8. Contacts

Source: `site/security.html` §6, §8; `site/support.html` §1, §5;
`site/privacy.html` §1, §16.

- General / support: hello@artuplabs.com (target: 2 business days,
  Almaty time UTC+5, Monday–Friday excluding Kazakhstan public holidays —
  not a guaranteed SLA)
- Security / vulnerability reports: security@artuplabs.com (acknowledged
  within 24 hours per the published incident response plan)
- Data controller / privacy contact: hello@artuplabs.com (responses to
  correspondence within one month, per `site/privacy.html` §13)
- Registered entity: ArtUp Labs, trade name of Artyom Karpets, individual
  entrepreneur (sole proprietor), Republic of Kazakhstan. Registered
  address: 32 E. P. Slavsky Embankment, apt. 132, Ust-Kamenogorsk
  (Oskemen), 070004, East Kazakhstan Region, Republic of Kazakhstan.

## What is intentionally left out here (owner to decide)

- Whether the listing needs a formal DPA document attached, beyond Atlassian's
  standard end-user agreement (`[TODO]` above).
- The exact wording the Marketplace privacy-tab form uses for each question —
  this draft answers by topic, not by exact form field, since the live form
  was not opened in this pass.
- `site/terms.html` is marked **Draft** on the site pending legal review; do
  not present its EULA content as final in the listing submission until the
  owner confirms it has been reviewed.
