# ArtUp Trace — screenshot plan

Status: **captured 2026-09-28** — sources `screenshots/1.png`…`6.png`; ready files `screenshots/draft/N-920x450.png` (all six) and `N-highlight-580x330.png` (1, 3, 5). Jira chrome, Rovo button and the "DEV" badge are cropped/masked. Retina 1840×900 not produced (sources ≈1430 px wide). Shot 5 shows the new "Status changed" diff kind. All steps target
**https://artuplabs-dev.atlassian.net**, project **REQ**, with Jira set to
**English (US)** UI language and the **light** theme. Project REQ has
requirement issues REQ-1..5 and REQ-9 (issue type named **«История»** — this
is the literal configured type name on this project, it will show in
English UI too since issue type names aren't translated) and verification
issues REQ-6..8 (issue type named **«Задача»**), per the task brief. Do not
rename these types for the screenshots — they're real project data and the
Russian names are expected to appear in the type badges.

Required image sizes, from a WebFetch summary of
https://developer.atlassian.com/platform/marketplace/building-your-presence-on-marketplace/
(re-verify directly before final export — see caveat in `listing.md`):
- Standard screenshot: **920×450px**, PNG or JPG.
- High-resolution / retina screenshot: **1840×900px**, PNG or JPG.
- If used as a highlight screenshot, it also needs a **580×330px** cropped
  variant (crop the same shot, don't create a different one).
- Caption limit: **220 characters** each.

Capture at browser width ≥1280px so the full-width Custom UI layout renders
without wrapping, then export/crop to the sizes above.

## Prepared demo data (2026-09-28, via REST)

Project REQ now has English data. Issue types are really **Story** (requirement) and **Task** (verification) — they only looked Russian because the Jira profile language was ru_RU; switch the profile to English before capturing.
- Requirements (Story): REQ-1, 2, 3, 4, 5, 9, 10, 12, 14, 16, 18 → 11 total.
- Tests (Task): REQ-6, 7, 8, 11, 13, 15, 17, linked with "Relates".
- Covered: REQ-1, 2, 3, 10, 12, 14, 16 → 7 of 11 (≈64%). Without verification: REQ-4, 5, 9, 18.
- Suspect: REQ-1, 2, 3 (their summaries were rewritten after the links were confirmed).
- Statuses varied: REQ-2 In Progress, REQ-3 Done, REQ-7 Done, REQ-8 In Progress.
- Baselines: create "Release 1.0" → controller makes a few changes → create "Release 1.1" → compare.

## Before capturing anything

1. Confirm project REQ's ArtUp Trace settings are saved: requirement type =
   «История», verification type = «Задача», at least one link type checked.
   (Settings tab — see shot 6 below; do this first so shots 1–5 show real
   coverage numbers, not the onboarding empty state.)
2. Confirm at least one suspect link exists before shot 3: open one
   already-linked requirement (e.g. REQ-1), edit its **Summary** or
   **Description**, save. Its confirmed link should flip to suspect within a
   few minutes (per README: "confirmation may be stale" logic) — refresh the
   Suspect links tab until it shows.
3. Create two baselines before shots 4–5 (see STATE.md: "comparison срезов
   B1/B2" was left pending) — capture "B1" first, make one visible change
   (e.g. add a new requirement, or change a status), then capture "B2", so
   the diff in shot 5 has non-empty Added/Changed rows instead of "No
   differences between these baselines."

## Shot 1 — Coverage overview

**Steps:**
1. Go to `https://artuplabs-dev.atlassian.net/jira/software/projects/REQ`
   (or the project's summary page) and open **ArtUp Trace** in the project
   sidebar.
2. Land on the default **Coverage** tab.
3. Make sure the coverage cards (Coverage %, Without verification, Suspect
   links, Requirements) and the "Without verification" table below them are
   both visible without scrolling, if possible.

**Must be visible:** the coverage percentage headline (e.g. "X% covered — Y
of Z requirements"), the four summary cards, and at least 2–3 rows of the
requirements table with their «История» type badge and status.

**Caption:** "Coverage is computed from the issue links you already use —
no new issue types, no custom fields. See exactly which requirements still
need a verification link." (163 chars)

## Shot 2 — Issue panel on a requirement

**Steps:**
1. Open issue **REQ-1** (or any «История» issue with a link) directly:
   `https://artuplabs-dev.atlassian.net/browse/REQ-1`.
2. Scroll the issue view to the **ArtUp Trace** panel in the right-hand
   panel stack (or below the description, depending on issue layout).
3. Capture the panel showing its Covered/Not covered (or Suspect) badge.

**Must be visible:** the issue key/summary at the top of the screenshot for
context, and the ArtUp Trace panel with its coverage/suspect status text.

**Caption:** "See a requirement's traceability status right on the issue —
covered, not covered, or a suspect link that needs re-confirming." (128
chars)

## Shot 3 — Suspect links, with one flagged and Confirm visible

**Steps:**
1. In ArtUp Trace on project REQ, open the **Suspect links** tab.
2. Make sure the row created in "Before capturing" step 2 is visible (the
   requirement whose summary/description was edited after its link was
   confirmed).
3. Do not click Confirm yet for this shot — the goal is to show the suspect
   state and the button together.

**Must be visible:** at least one row with a visible "suspect" indicator,
its linked issue («Задача» type), and the **Confirm** button/action for
that row.

**Caption:** "A link is flagged suspect the moment its requirement's summary
or description changes after confirmation — one click re-confirms it."
(140 chars)

## Shot 4 — Baselines list with two captured baselines

**Steps:**
1. Open the **Baselines** tab.
2. Ensure both baselines from "Before capturing" step 3 ("B1" and "B2") are
   listed with status **Complete**, their creation timestamps, and
   requirement counts.

**Must be visible:** at least 2 baseline rows (name, created date,
requirement count, status), and the "Compare two baselines" control
(Before/After pickers) below or above the list.

**Caption:** "Capture a point-in-time baseline of your requirements and
their links, then pick any two to compare." (108 chars)

## Shot 5 — Baseline diff

**Steps:**
1. Still on the **Baselines** tab, select "B1" as Before and "B2" as After
   in the compare control, then click **Compare**.
2. Wait for the diff table to load.
3. Capture the counts line (Added/Removed/Changed/Links changed) together
   with a few diff rows showing a status-before → status-after change or an
   Added/Changed badge.

**Must be visible:** the counts summary line and at least 2–3 diff rows with
their change badge (Added/Removed/Changed/Links changed) and the
before→after status text.

**Caption:** "Diff any two baselines to see exactly what changed — added,
removed, or modified requirements and links — exportable to CSV for an
audit trail." (156 chars)

## Shot 6 — Settings

**Steps:**
1. Open the **Settings** tab (requires project admin permission —
   `ADMINISTER_PROJECTS`, per `src/handlers/resolvers.js`'s `getSettings`
   resolver).
2. Show the three configuration groups: Requirement issue types
   («История» checked), Verification issue types («Задача» checked), and
   Link types that count.

**Must be visible:** all three selector groups with their current selection,
and the **Save** button.

**Caption:** "Choose which issue types count as requirements and
verifications, and which link types count as coverage — takes one minute to
set up." (139 chars)

## Optional 7th shot (only if 6 feels thin for the highlight crops)

The three highlights in `listing.md` map to shots 1 (Coverage), 3 (Suspect
links), and 5 (Baseline diff) — those three need the 1840×900 + 580×330
crops. Shots 2, 4, 6 only need the standard 920×450 (or 1840×900) size, not
the highlight crop, since they are not referenced by a highlight.

## Unverified

- The exact screenshot count limit for the general listing gallery (beyond
  the "up to 5 per highlight" figure surfaced by WebFetch, which reads oddly
  for a gallery-wide limit and should be re-checked on the live submission
  form).
- Whether Jira's project-sidebar entry is literally labelled "ArtUp Trace"
  or "Trace" in the current deployed build — `manifest.yml` sets
  `title: ArtUp Trace` for both `jira:projectPage` and `jira:issuePanel`
  modules, so "ArtUp Trace" is what should appear, but this was not
  re-confirmed against a live screenshot in this pass.
