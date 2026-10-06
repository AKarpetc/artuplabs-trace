# ArtUp Query — Privacy & Security tab draft

Status: draft answers by topic (the live form's exact wording was not opened). Verified against
`apps/query/manifest.yml`, `src/core/catalog.js`, the rulings Q-R14 and Q-R48 to Q-R51 and
`apps/query/docs/live-checks.md` on 2026-10-04. Nothing is submitted.

## 1. What data is read, and what is stored

**Read** (as the app, `asApp`, through Atlassian's REST API): work items (key, project, type, status,
dates, parent, epic), issue links, the hierarchy, the changelog of Sprint and status, sprints and
boards, and the metadata of comments and attachments (author account id, dates, visibility type and
the role or group it names, file extension).

**Stored** in Forge SQL and Forge storage:

| What | Contents |
|---|---|
| Status and sprint index (Forge SQL) | issue ids and project ids with status changes (date, old and new status category); sprint ids, board ids, **sprint names**, states and dates; the moves of a work item into and out of a sprint with dates and changelog entry ids. **No copy of the hierarchy or the links** (read from Jira at computation time) |
| Comments and attachments (Forge SQL) | comment and attachment ids, **account id of the author**, dates, comment visibility: type and the **name or id of the role or group** (restricted comments are ignored by every function), file extension |
| Results (KVS) | cached result ids of functions, per query, and the queue of pending updates |
| **Arguments of functions in use (KVS)** | the JQL of subqueries, a **user name or email address given to `by`**, dates and expressions. In the update queue about ten minutes after the last call; in the queue of large results until computed (at most six hours); in a cached copy of the list of function calls that Jira keeps, rewritten about hourly. Jira itself keeps the arguments and the result of each call |
| Settings (KVS) | the excluded projects, the state of the index, the list of Jira field ids and names (one hour) |
| Error log (KVS) | function name, time and a fixed message without values; **never the arguments** — Q-R14 |

**Never stored:** issue summaries, descriptions, comment bodies, attachment content or names, custom
field values. Display names and avatars returned by Jira are not stored (display names are read from
`user/search` only to resolve an id).

**Personal data:** the Atlassian account id of the authors of comments and attachments, and any user
name or email address a person types as an argument of `by` (kept while the function is in use).

Developer console → "Does your app store personal data?": **Yes — Atlassian account ids of comment and
attachment authors, and a user name or email address given as a function argument**
`[OWNER: confirm the wording on the live form; the safe answer is Yes]`.

### Access of a subquery (for the security questionnaire) `[OWNER: confirm Q-R3 with this wording]`

A subquery is evaluated with the app's access, not the user's (Forge gives a JQL function no other
option; precomputations are shared by all users). Jira applies the result to each user's search and
removes work items the user cannot see, so a hidden work item is never returned. But the functions that
follow links or the hierarchy (`linkedIssuesOf` and its recursive forms, `subtasksOf`, `parentsOf`,
`epicsOf`, `issuesInEpics`, `childIssuesOf`) read their subquery across all projects. A work item the
user can see is returned when it is linked to, or is the parent, child or epic of, a matching work item
in a project the user cannot browse. A user who can write JQL can vary the condition and learn whether
a hidden matching work item exists; the message for an invalid subquery can show whether a project
exists. Excluding a project removes its own work items from results but does not stop them from being
the source of a subquery. This is published in the site's security page, documentation and here.

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

Rows are deleted when a work item, comment or attachment is deleted (the app receives the delete
events; normally within seconds, and a project reindex removes rows left by a lost event). Function
arguments are kept only while the function is in use (see the table above). On uninstall, Atlassian removes the app's Forge storage and SQL data under its
app-uninstall handling `[OWNER: confirm Atlassian's exact retention wording for uninstall]`. A
project excluded by an administrator is purged from the index.

## 6. Logging

Forge function logs and the app's error log contain the function name, the time and a fixed error
message without values. Not the arguments, no issue content, no user data.

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
