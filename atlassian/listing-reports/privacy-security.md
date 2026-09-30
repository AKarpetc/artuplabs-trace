# ArtUp Reports — Privacy & Security tab draft

Status: draft answers, by topic (the live form's exact wording was not opened). Verified against
`apps/reports/manifest.yml`, `src/resolvers.js`, `src/templates/store.js`, `src/access.js` and the
Jira calls in `static/app/src` on 2026-09-30. Nothing is submitted.

## 1. What data is stored, and where

**Only export templates, and no issue content.** Forge storage (KVS) holds:

| Key | Contents |
|---|---|
| `tpl:{scope}:{scopeId}:{id}` | template metadata: name, format (Excel/Word), scope (personal, project or site), the Excel column set and settings, size, update time, and the **Atlassian account id of the author** |
| `tplid:{id}` | index entry: scope and scope id for the template id |
| `tplbin:{id}:{n}` | the uploaded .docx template file, in parts |

- No Jira issue field, comment, attachment, work log or user name is written to storage, logs or any
  other place. Issues are read **in the user's browser** (`requestJira` from `@forge/bridge`, as the
  current user), turned into a file there, and downloaded to the user's computer. The generated file
  lives only in the user's download.
- A template file is whatever the user uploads; the app does not read Jira content into it. Users
  should not put confidential text in a template they share with a project or the site.
- The account id of a template's author is stored so the app can show the author and check who may
  edit. It is the only personal data. Author display names are read from Jira at display time and
  not stored.
- Data residency: Forge storage is hosted by Atlassian; the data stays where Atlassian keeps the
  customer's Forge app data. ArtUp Labs has no copy.

Developer console → "Does your app store personal data?": **Yes — the Atlassian account id of the
author of a template** `[OWNER: confirm the wording on the live form; the safe answer is Yes]`.

## 2. Scopes requested, and why

All read-only. No `write:*` scope.

| Scope | Used for |
|---|---|
| `read:jira-work` | Read issues (JQL search, `issue/bulkfetch`, fields, comments, work logs, links), saved filters, attachments and their thumbnails (`/rest/api/3/...`). |
| `read:jira-user` | Display names of authors, assignees and template authors (`/rest/api/3/user/bulk`, `/myself`). |
| `read:board-scope:jira-software` | Issues of a board or backlog (`/rest/agile/1.0/board/...`). |
| `read:sprint:jira-software` | Issues and details of a sprint (`/rest/agile/1.0/sprint/...`). |
| `read:board-scope.admin:jira-software` | Board configuration, to find the filter behind a board. |
| `read:project:jira` | The project list for the templates tab and project templates (`/rest/api/3/project/search`). |
| `storage:app` | Storing templates (§1). |

Because every read runs as the current user, issues the user cannot see in Jira are not exported.
The backend also calls `/rest/api/3/mypermissions` as the current user to decide who may manage a
project or site template.

## 3. Egress / outbound network calls

**None.** No `permissions.external`, no remotes, no Connect modules. Fonts (Latin, Cyrillic, CJK),
libraries and images are bundled in the app resources. Issue content never leaves Atlassian and the
user's browser. `forge eligibility -e development` → eligible (Runs on Atlassian), version 3.2.0.
`[OWNER: re-run for production after the production deploy.]`

## 4. Retention and deletion

Templates are kept until a user with permission deletes them in the app (deleting removes the
metadata, the index entry and all parts of the file). Uninstalling the app removes its Forge storage
under Atlassian's app-uninstall handling `[OWNER: confirm Atlassian's exact retention wording for
uninstall]`. Files users downloaded stay on their computers under their control.

## 5. Logging

Forge function logs (Atlassian) contain, on failure, only the resolver name and the error message
(`console.error("<resolver> failed: <message>")`). No issue content, titles or user data is logged.
Browser-side errors stay in the user's browser.

## 6. Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| Atlassian | Hosting and running the app (Forge), storage of templates, platform logs, Marketplace licensing and billing | Customer's data residency region as handled by Atlassian |

No other sub-processor receives app data. Zoho Mail only receives support email a user chooses to
send (same as Trace and Export).

## 7. Compliance / data-processing role

As for Trace and Export: the customer is the controller for data the app processes within its Jira
site; ArtUp Labs acts as a processor, processing only to provide the export, on Atlassian's
infrastructure and in the user's browser. Issue data is processed transiently in the browser and is
not stored; the only stored personal data is the template author's account id. DPA on request:
standard Bonterms DPA (as recorded for Trace in `STATE.md`).

## 8. Runs on Atlassian

Eligible: Forge-only, no egress, no Connect modules, bundled resources. Claim the badge only after
the production eligibility check (§3).

## 9. Contacts

Same as Trace (`../listing/privacy-security-tab.md` §8): hello@artuplabs.com (support, privacy),
security@artuplabs.com (vulnerabilities, acknowledged within 24 hours), ArtUp Labs — trade name of
Artyom Karpets, individual entrepreneur, Republic of Kazakhstan.

## Before submitting

- `site/privacy.html`, `site/security.html` and `site/terms.html` **do not yet mention ArtUp
  Reports** (they cover Trace and Export). Add a Reports section to each (the facts are in §1–§7
  above; note the stored account id, which differs from Export), then deploy the site before
  submitting the listing.
