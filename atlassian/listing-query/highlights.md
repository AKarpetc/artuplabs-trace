# ArtUp Query — highlights and screenshot captions

Exactly 3 highlights; title ≤ 50 characters, summary ≤ 220 (limits as found for the other apps —
re-check). Each maps to a row of brief §4 (`../25_app5_jql.md`). Numbers are from the acceptance
runs on `artuplabs-dev` (50,000 issues); each carries a refresh marker for after Tasks 30 and 32.

## Highlight 1 — Fresh

**Title:** Results update within seconds of an edit

**Summary:** On a 50,000-issue site the 90th percentile was 24.7 s for subtask and link functions and
7.1 s for board sprints. Sprint history stays under a minute. Bulk imports can take minutes.
<!-- refresh after acceptance -->

**Source:** brief §4 row "30+ minutes for a filter to synch"; freshness run, n = 30 (query, board);
sprint run n = 5, full run in progress. **Screenshot:** `screenshots/` status page.

## Highlight 2 — Complete

**Title:** Complete at any size, errors that explain

**Summary:** Every function matched a REST reference on 50,000 issues: 24/24, 85/85 (a sprint of 1,093
issues included) and 17/17. A wrong argument gives a message in the JQL editor, never an empty list.
<!-- refresh after acceptance -->

**Source:** brief §4 rows "childrenOfEpicsInQuery doesn't always show all" and "none of the functions
return any values"; completeness runs M1, M2, M3. **Screenshot:** error in the JQL editor.

## Highlight 3 — Runs on Atlassian

**Title:** Nothing leaves Atlassian, nothing is written

**Summary:** No external servers and no egress. The app reads work items and keeps only ids, dates and
metadata in Forge storage; it never writes to your issues and never stores issue text.

**Source:** manifest (no external permissions, one write scope: `write:app-data:jira`, used only for
JQL function precomputations), brief §4 row "Appfire spams Jira Cloud". **Screenshot:** the admin page.

## Gallery captions (≤ 220 characters)

`[Step 2 of Task 34 — screenshots are not taken yet; captions are proposed for the planned frames.]`

| # | Planned file | Caption |
|---|---|---|
| 1 | `1-reference.png` | Every function with its arguments, a copyable example and a ScriptRunner migration note. Search by name; 26 languages, light and dark. |
| 2 | `2-status.png` | The state of the app: updates in the queue, the index fill and recent errors without function arguments. |
| 3 | `3-search.png` | A function in the ordinary Jira search: issue in subtasksOf("…"). Works in filters, boards and dashboards. |
| 4 | `4-admin.png` | Administrators exclude projects, reindex one project or rebuild the index. The page lists the few functions Jira answers itself. |
| 5 | `5-error.png` | A mistake in an argument is explained in the JQL editor, with what to fix. |
