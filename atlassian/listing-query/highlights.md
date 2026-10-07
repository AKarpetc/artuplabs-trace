# ArtUp Query — highlights and screenshot captions

Exactly 3 highlights; title ≤ 50 characters, summary ≤ 220 (limits as found for the other apps —
re-check). Each maps to a row of brief §4 (`../25_app5_jql.md`). Wording follows the live site (Tier 1).
Only measured numbers appear (second run of the points budget gates, 2026-10-07, Tier 1).

## Highlight 1 — Complete

**Title:** Complete, or an error that explains

**Summary:** Every function matched a REST reference on 50,000 issues: 24/24, 85/85 (a sprint of 1,093
issues included) and 17/17. A result too large for Jira's API allowance is an error with the numbers,
never a cut-off list.

**Source:** brief §4 rows "childrenOfEpicsInQuery doesn't always show all" and "none of the functions
return any values"; completeness runs M1, M2, M3. **Screenshot:** error in the JQL editor.

## Highlight 2 — Kept up to date

**Title:** Kept up to date from Jira events

**Summary:** With room in the hourly allowance a label or link change showed in about 15 s; with about 100 functions in use the 90th percentile was about 277 s. Bulk edits over the hour's allowance wait for the next half hour.

**Source:** brief §4 row "30+ minutes for a filter to synch"; gates run 2 (2026-10-07, G5a/G5b). **Screenshot:** `screenshots/` status page.

## Highlight 3 — Runs on Atlassian

**Title:** Nothing leaves Atlassian, nothing is written

**Summary:** No external servers and no egress. The app reads work items and keeps only ids, dates,
metadata and the arguments of the functions in use in Forge storage; it never writes to your issues and
never stores issue text.

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
