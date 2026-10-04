# ArtUp Query — Privacy & Security tab draft

Status: draft answers by topic (the live form's exact wording was not opened). Verified against
`apps/query/manifest.yml`, `src/core/catalog.js`, the rulings Q-R14 and Q-R48 to Q-R51 and
`apps/query/docs/live-checks.md` on 2026-10-04. Nothing is submitted.

## 1. What data is read, and what is stored

**Read** (as the app, `asApp`, through Atlassian's REST API): work items (key, project, type, status,
dates, parent, epic), issue links, the hierarchy, the changelog of Sprint and status, and the metadata
of comments and attachments (author account id, dates, visibility type, file extension).

**Stored** in Forge SQL and Forge storage:

| What | Contents |
|---|---|
| Issue index | issue ids, project ids, hierarchy and link edges, status categories, dates |
| Sprint history | sprint ids, board ids, changelog entry ids, the moves of a work item into and out of a sprint with dates |
| Comments and attachments | comment and attachment ids, **account id of the author**, dates, comment visibility type (restricted comments are ignored by every function), file extension |
| Results | cached result ids of functions, per query, and the queue of pending updates |
| Settings | the excluded projects, the state of the index |
| Error log | function name, time and error message; **never the arguments** (they hold the customer's JQL) — Q-R14 |

**Never stored:** issue summaries, descriptions, comment bodies, attachment content or names, custom
field values, user names or email addresses.

**Personal data:** the Atlassian account id of the authors of comments and attachments is the only
personal data. Display names are not read or stored.

Developer console → "Does your app store personal data?": **Yes — Atlassian account ids of comment and
attachment authors** `[OWNER: confirm the wording on the live form; the safe answer is Yes]`.

## 2. Scopes requested, and why

| Scope | Used for |
|---|---|
| `read:jira-work` | Read work items, links, the hierarchy, the changelog (Sprint, status), comment and attachment metadata, JQL search. |
| `read:jira-user` | Look up the account ids that `by` and `inRole` conditions mean. |
| `read:board-scope:jira-software` | Find boards and the sprints of a board for the sprint functions. |
| `read:sprint:jira-software` | Read sprint ids, names and states. |
| `read:project:jira` | The project list for the settings page (excluded projects, reindex) and for checking keys. |
| `read:group:jira`, `read:user:jira` | Expand a group into its members for `inGroup`. |
| `read:avatar:jira` | Required together with the user and group reads. |
| `read:app-data:jira` | Read the state of the app's JQL function precomputations. |
| `write:app-data:jira` | **Write the app's JQL function precomputations only.** It is not a write to work items. |
| `storage:app` | The app's own storage (the queue, settings, logs). |

There is no `write:jira-work`, no `manage:*` scope and no write to issues, comments or issue properties.

## 3. Egress / outbound network calls

**None.** No `permissions.external`, no remotes, no Connect modules. `[OWNER: run forge eligibility
after the production deploy and record the result here.]`

## 4. Exclusion of projects

Administrators can exclude projects. Their rows are removed from the index; under `in` their work
items never match a function the app computes; under `not in` the result is the exact complement of
`in`. A few functions are answered by Jira itself and are not filtered: `previousSprint`,
`nextSprint`, `hasAttachments()` without an extension, `hasComments("-n")` and, in most cases,
`hasLinks` and `hasLinkType` (Q-R50, Q-R51).

## 5. Retention and deletion

Data is deleted when a work item, comment or attachment is deleted (the app receives the delete
events). On uninstall, Atlassian removes the app's Forge storage and SQL data under its
app-uninstall handling `[OWNER: confirm Atlassian's exact retention wording for uninstall]`. A
project excluded by an administrator is purged from the index.

## 6. Logging

Forge function logs and the app's error log contain the function name, the time and the error
message. Not the arguments, no issue content, no user data.

## 7. Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| Atlassian | Running the app (Forge), Forge SQL and Forge storage, platform logs, Marketplace licensing and billing | Customer's data residency region as handled by Atlassian |

No other sub-processor receives app data. Zoho Mail only receives a support email a user chooses to send.

## 8. Compliance / data-processing role

The customer is the controller of data in its Jira site; ArtUp Labs is a processor, processing only
to answer JQL functions, on Atlassian's infrastructure. DPA on request: standard Bonterms DPA
(as recorded for Trace in `STATE.md`).

## 9. Contacts

hello@artuplabs.com (support, privacy), security@artuplabs.com (vulnerabilities, acknowledged within
24 hours). ArtUp Labs — trade name of Artyom Karpets, individual entrepreneur, Republic of Kazakhstan.

## Before submitting

- `site/privacy.html`, `site/security.html`, `site/terms.html` and `site/support.html` cover ArtUp
  Query in this repo (Task 34); deploy the site before submitting the listing.
