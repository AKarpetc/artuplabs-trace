# ArtUp Reports — highlights and screenshot captions

Exactly 3 highlights; title ≤ 50 characters, summary ≤ 220 (limits as found for Trace — re-check).
Each maps to a criterion of brief §4 (`../22_app3_jira_reports.md`).

## Highlight 1 — Volume

**Title:** 10,000 issues to Excel in seconds

**Summary:** A test export of 10,003 issues took 11.8 seconds, with real dates and numbers, issue
links, a frozen header and filters. No vendor server, no issue limit in Excel.

**Source:** acceptance file, part A, row 1 (Node run with the app's pipeline, not a browser run).
**Screenshot:** `screenshots/draft/2-excel-preview.png`

## Highlight 2 — Templates without code

**Title:** Word templates made in Word, no code

**Summary:** Write {{summary}} in an ordinary .docx and the app fills it, with images, tables and
repeating table headers. Mistyped placeholders are caught on upload. Excel columns: pick with the mouse.

**Source:** brief §4 row "Groovy/FreeMarker"; acceptance rows 3 and 5.
**Screenshot:** `screenshots/draft/4-templates.png`

## Highlight 3 — Runs on Atlassian

**Title:** Nothing leaves Atlassian

**Summary:** Files are built in your browser with your Jira permissions. The app has no external
servers and no egress, and stores only your templates, never issue content.

**Source:** manifest (no external permissions), `src/resolvers.js`, eligibility in acceptance file.
**Screenshot:** `screenshots/draft/3-result.png`

## Gallery captions (≤ 220 characters)

| # | File | Caption |
|---|---|---|
| 1 | `1-wizard.png` | Choose issues by filter or JQL, then Excel, Word or PDF, then a built-in layout or one of your own templates. Each layout has a preview. |
| 2 | `2-excel-preview.png` | Excel with the columns you choose and a preview of the first issues before you export. Names and issues in Latin, Cyrillic and Chinese. |
| 3 | `3-result.png` | The result screen shows issues, time, skipped issues and missing images, and lists every warning. |
| 4 | `4-templates.png` | Personal, project and site templates: Excel column sets and Word templates made in Word. |
| 5 | `5-pdf-page.png` | A built-in PDF layout on A4: JQL, export time and author on top, tables inside the margins, page numbers. |

## Screenshots

1840×900 PNG (920×450 at device scale 2, the same as ArtUp Export's `screenshots/draft/`), en-US, light
theme, 1280 px app width from the Task 21 matrix (`apps/reports/static/app/screenshots/`,
gitignored). Frames are composed by `screenshots/compose.mjs`
(`node compose.mjs <out-dir> [name-prefix] [pdf-page.png]`); the PDF page is page 1 of
`data/matrix/pdf-sprint_A4_latin.pdf` rendered at 150 dpi. Data is the preview fixture (issues RPT-1…,
"Ann Lee", "Борис Петров"), not a customer. The PDF page shows the export author "Artyom Karpets"
(the publisher) from the acceptance run. If the portal asks for 920×450 or 580×330, downscale or
crop — do not reshoot.

Known visual imperfection: the PDF sprint layout gives equal widths to all columns, so long
summaries wrap into tall rows (recorded in the acceptance file as a v1.1 item). Nothing is cut off.
