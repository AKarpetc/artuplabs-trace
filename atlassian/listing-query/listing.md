# ArtUp Query — listing text (English)

Status: draft for the owner. Nothing is submitted. Character limits are the unverified figures used for
the other ArtUp apps (name 60, tagline 130, summary 250) — re-check each on the live "Create listing"
form before pasting. Numbers come from the acceptance runs on the dev site `artuplabs-dev` (50,000
issues); each carries `<!-- refresh after acceptance -->` so it can be updated after Tasks 30 and 32.
Items in `[OWNER: …]` are decisions or checks that are not mine to make.

## App name

**ArtUp Query — JQL functions for subtasks, links, sprints and comments**

The Atlassian product name does not lead the name. Characters: 69 — over the unverified limit of 60.
`[OWNER: if the live form enforces 60, use the fallback "ArtUp Query — JQL functions for Jira" (36
characters) and keep the long form as the first line of the description.]`

## Tagline

**JQL functions that stay fresh: subtasks, links, sprint history, comments. Nothing leaves Atlassian.**

(99 characters; limit found for other apps: 130.)

## Summary

Add the JQL functions Jira lacks: subtasks and links of a query, sprint history, comments,
attachments, date and field math. Results update within seconds of an edit, stay complete on 50,000
issues and never write to your issues. Runs on Atlassian.

(248 characters; limit 250.)

## Full description

```markdown
## JQL functions for Jira Cloud that stay fresh

ArtUp Query adds 24 JQL functions to the Jira search box, saved filters, boards and dashboards. Write
`issue in subtasksOf("project = DEMO AND status = Done")` and get the subtasks of every work item the
subquery returns — in company-managed and team-managed projects, with any JQL, a saved filter or a list
of keys as the argument. No separate search screen: the functions work in the ordinary Jira search.

### Three things that set it apart

1. **Fresh within seconds of an edit.** Change a work item and the result follows. On a test site with
   50,000 issues the 90th percentile was 24.7 seconds for the subtask and link functions and 7.1 seconds
   for board sprints (30 edits each); comments and attachments took 11.4 and 12 seconds (10 edits each);
   sprint history stayed under a minute. <!-- refresh after acceptance -->
2. **Complete at any size.** On the same 50,000-issue site every function matched a reference
   computed by walking the Jira REST API: 24 of 24 checks of the functions computed on request, 85 of 85 checks of the site index
   (links, hierarchy and sprint history, including a sprint of 1,093 issues) and 17 of 17 checks of
   comments, attachments and field comparison. <!-- refresh after acceptance -->
   Where a result cannot be returned in full, you get an explicit error with the number — never a
   silently truncated list.
3. **Runs on Atlassian, writes nothing to your issues.** No external servers, no egress. The app only
   reads work items and stores its own index in Atlassian's Forge storage. It never edits an issue, adds
   no properties to issues and does not ask for `write:jira-work`.

### Functions

**Work items of a query** — `subtasksOf`, `parentsOf`, `epicsOf`, `issuesInEpics`, `childIssuesOf`
(with an optional depth), `linkedIssuesOf`, `linkedIssuesOfRecursive`, `linkedIssuesOfRecursiveLimited`.

**Links and subtasks across the site** — `hasLinks`, `hasLinkType`, `hasSubtasks`.

**Board sprints** — `previousSprint`, `nextSprint`.

**Sprint history** — `addedAfterSprintStart`, `removedAfterSprintStart`, `completeInSprint`,
`incompleteInSprint`.

**Comments** — `commented` (by, after, before, on, inRole, inGroup), `lastComment`, `hasComments`
(exactly n, more than n, fewer than n).

**Attachments** — `fileAttached` (by, after, before, on, ext), `hasAttachments` (optionally one file
extension).

**Compare fields** — `dateCompare` (for example `resolutiondate > duedate`) and `expression` (for
example `timespent > originalestimate * 1.2`).

Every function works with `in` and with `not in`. Functions nest: the argument of one function can be
another.

### Coming from ScriptRunner?

Function names and arguments are the same. Write `issue in` instead of `issueFunction in`:
`issue in subtasksOf("project = DEMO")`. ScriptRunner Enhanced Search on Cloud works only on its own
search screen; ArtUp Query works in the standard Jira search, filters and boards. Differences are
listed in the documentation.

### Clear errors instead of empty results

A wrong argument, an unknown board or sprint, a missing licence or a result too large to return
produces a message in the JQL editor that says what to fix — not an empty list.

### Be honest about timing

Seconds for ordinary edits. Bulk imports and bulk edits can take minutes to show up, because Jira
delivers the change events to the app in a queue. A new site builds its index once — about
half a minute to a minute for 50,000 issues — and until then the sprint, comment and attachment
functions answer "Index is building: n of m issues". <!-- refresh after acceptance -->

### Getting started

1. A Jira administrator installs ArtUp Query from the Atlassian Marketplace. Sites with up to 10 users
   use it free.
2. Open **Apps → ArtUp Query** for the reference: every function with its arguments, an example you
   can copy and the state of the index.
3. In the Jira search, switch to JQL and type `issue in` followed by a function. Save it as a filter,
   use it on a board or a dashboard.

### Administration

Jira administrators can exclude projects from the index (Apps → ArtUp Query settings), reindex one
project or rebuild the whole index. Excluded projects never match a function the app computes; under
`not in` they are simply outside the result. A few functions are answered by Jira itself and are not
filtered — the settings page lists them.

### Private by design

The app reads work items, links, the hierarchy, Sprint and status history, and comment and attachment
metadata as the app. It stores ids, dates and metadata — never issue text, comment bodies or
attachment content. It makes no outbound calls. The error log never stores function arguments.

### Dates and time

Dates in conditions (`after`, `on`, `-7d`, `startOfWeek()`) are in UTC and weeks start on Monday. In
`expression`, 1d of work time is 8h and 1w is 5d. Comments with restricted visibility (role or group)
are not counted by any function.

### Interface

26 languages following the Jira language setting on the app pages, light and dark theme. Messages
in the JQL editor are in English: Jira does not tell a function the language of the user.

### What it is not

Not a Jira Data Center app: Jira Cloud only. Not a replacement for the full ScriptRunner
scripting platform: it provides JQL functions only, with no scripts, listeners or workflow
extensions. It does not search the text of comments or attachments.

### Links

- Product page: https://artuplabs.com/query/
- Documentation: https://artuplabs.com/docs/query/
- Support: https://artuplabs.com/support (hello@artuplabs.com)
- Privacy: https://artuplabs.com/privacy · Security: https://artuplabs.com/security
- Terms: https://artuplabs.com/terms
```

`[OWNER: privacy, security and terms pages on the site now cover ArtUp Query in the repo's site/
(Task 34); the live site must be deployed (and merged with the newer worktree) before submitting.]`

## Pricing

- Free for up to 10 users (design §7; the app reads the licence from the function and page context).
- **$175 per month for 200 users** — the listing price from brief §2 (gate J-G3: do not lower).
- `[OWNER: enter the tier model in the partner portal; only the 200-user price is set in the brief.]`

## Categories

`[OWNER: pick from the live list.]` Best guesses for Jira: **Search & navigation** or **Reporting**,
secondary **Admin tools** if offered.

## Keywords

jql functions, jira jql, subtasksOf, linkedIssuesOf, sprint history, added after sprint start,
scriptrunner alternative, jql comments, jql attachments, hasSubtasks, expression, dateCompare

## Data residency statement

> ArtUp Query is an Atlassian Forge app with no external servers and no outbound network calls. It
> reads Jira work items as the app and keeps its index — ids, dates, status categories and comment and
> attachment metadata — in Forge SQL and Forge storage, which Atlassian hosts in the customer's Forge
> data residency region. Issue text, comment bodies and attachment content are not stored.

## Runs on Atlassian

`[OWNER: run forge eligibility for the app after the production deploy; claim the badge only then.
Not yet checked for ArtUp Query.]`

## Languages

cs-CZ, da-DK, de-DE, en-GB, en-US, es-ES, et-EE, fi-FI, fr-FR, hu-HU, is-IS, it-IT, ja-JP, ko-KR,
nl-NL, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, sv-SE, tr-TR, zh-CN, zh-TW (fallback en-US).
`[OWNER: ko, is, et, hu translations still need a native-speaker check, as for the other apps.]`

## Screenshots

`[Step 2 of Task 34, not done yet: five 1280 px light en-US frames — reference, status, a search with a
function, the admin page, an error in the JQL editor. See screenshots/.]`
