# ArtUp Reports — listing text (English)

Status: draft for the owner. Nothing is submitted. Character limits are the same unverified figures
used for ArtUp Trace and ArtUp Export (name 60, tagline 130, summary 250) — re-check each on the live
"Create listing" form before pasting. Every number below is measured (source in
[`../plans/2026-09-29-artup-reports-acceptance.md`](../plans/2026-09-29-artup-reports-acceptance.md), part A)
or stated as a design fact from the manifest and the code. Items in `[OWNER: …]` are decisions or
checks that are not mine to make.

## App name

**ArtUp Reports — Excel, Word & PDF export for Jira**

Rule as for Export: the Atlassian product name must not lead the name; "for Jira" is the allowed form.
Characters: 49 (limit found: 60).

## Tagline

**Export Jira issues to Excel, Word and PDF: thousands of issues, your own Word templates, nothing leaves Atlassian.**

(114 characters; limit found: 130.)

## Summary

Export issues from a search, board, sprint or one issue to real .xlsx, .docx and PDF files. Pick
columns with the mouse or fill a Word template you made in Word — no code. The file is built in your
browser. Runs on Atlassian.

(225 characters; limit found: 250.)

## Full description

```markdown
## Jira issues to Excel, Word and PDF

ArtUp Reports turns Jira issues into real files: an .xlsx workbook, a .docx document or a PDF. Start
from a search, a board, a backlog, a sprint or a single issue, pick a format and a template, and
download. The file is built in your browser, so your issue data never passes through a vendor server.

### Getting started

1. A Jira administrator installs ArtUp Reports from the Atlassian Marketplace. Sites with up to 10
   users use it free; no configuration is needed.
2. Open an export from where you work: **Apps → Export to Excel, Word or PDF** on the issue search,
   the export action on a board, backlog or sprint, **Export to Word or PDF** on an issue — or open
   the **ArtUp Reports** page from the Apps menu.
3. Choose the issues (a saved filter or JQL), a format (Excel, Word or PDF) and a template.
4. Click **Export**. The file downloads when it is ready; the result screen shows issues, time,
   skipped issues, missing images and every warning.

### Excel

- Choose any fields as columns, including custom fields, comments, work logs, links and sub-tasks;
  add, remove and reorder them with the mouse.
- Real data types: dates are dates, numbers are numbers, issue keys are links to the issues.
- Frozen header row, filters on the header, column widths that fit the data.
- One row per issue, per work log or per comment; split into sheets by a field; a Summary sheet with
  counts by status, assignee and priority, plus the JQL, the export time, the author and the issue count.
- Four built-in column sets: issue list, work logs, comments, sprint summary.
- A preview of the first issues before you export.

### Word

- Four built-in layouts: single issue, issue list, sprint report, release notes.
- Or upload your own .docx template, made in Word, with placeholders such as `{{summary}}`. No
  scripting language. Mistyped placeholders are caught when you upload the template ("Did you mean
  summary?") and the template cannot be saved until they are fixed.
- Images from descriptions and attachments are placed inside the document, and description
  formatting (headings, lists, tables, code) is kept.
- Table headers repeat on every page, page numbers in the footer, and the JQL, export time, author
  and issue count in the header.

### PDF

- The same four layouts as Word, on A4 or Letter.
- Fonts for Latin, Cyrillic and CJK text are bundled in the app.
- Tables and code blocks are sized to the page, so long identifiers and URLs stay inside the margins.
- Images from descriptions and attachments are embedded.

### Templates and sharing

Save Excel column sets and Word templates as personal, project or site templates. Project templates
are visible to people who can use that project. File names follow a pattern you set, for example
`{project}-{date}-{filter}`.

### Private by design

The export runs in your browser. ArtUp Reports reads Jira with your permissions, builds the file
locally and downloads it. Issue content is never sent to ArtUp Labs and never stored: the app's
storage holds only your templates (names, settings and uploaded .docx template files). The app makes
no outbound calls — it runs on Atlassian.

### Tested at volume

Measured with the app's own export pipeline against a test Jira site, including reading the
generated files back:

- **Excel:** 10,003 issues in 11.8 seconds; the file has 10,003 data rows and 10,003 issue links.
- **Word:** 500 issues with 500 images in 58–80 seconds (two runs); no image lost.
- **PDF:** 500 issues with images in 57–72 seconds (at least three runs), 1,000 pages; Chinese and Japanese text on page 1.
- **Layouts:** 4 layouts × Word and PDF × A4 and Letter × Latin, Cyrillic and CJK — 203 pages
  checked for text running past the margins after the last fix: none.

Times depend on your site, network and attachment sizes. `[OWNER: add the Word/PDF maximum issue
count here once the memory limit is decided — Ruling R23. Until then do not state one.]`

### Interface

26 languages following the Jira language setting, light and dark theme.

### What it is not

A one-way export: it does not import a spreadsheet back into Jira, does not schedule or email
exports, and does not export from Jira Data Center. Jira Cloud only.

### Links

- Product page: https://artuplabs.com/reports/
- Support: https://artuplabs.com/support (hello@artuplabs.com)
- Privacy: https://artuplabs.com/privacy · Security: https://artuplabs.com/security
- Terms: https://artuplabs.com/terms
```

`[OWNER: privacy, security and terms pages on the site do not yet cover ArtUp Reports — see
NEXT_STEPS.md; deploy them before submitting.]`

## Pricing note

Free for sites with up to 10 users. No watermark was found in the generated
Word, PDF and Excel files (checked in the acceptance runs; the behaviour for a site with
no licence can only be verified after the listing exists). Larger sites: per-user pricing through the
Marketplace. Details in the Pricing section below.

## Pricing

- Free up to 10 users, as decided in the brief (§4 row "watermark", §5 item 6).
- Anchor from the brief (§2, source: `../04_market_measurement.md` snapshot): median of the topic
  **$319 per month at 200 users**; leaders Better Excel Exporter $437, Better PDF Exporter $437,
  Xporter $370, BigTemplate $319, Exporter for Jira $148.
- `[OWNER: price not decided. The tier model of Trace and Export (graduated per user, single =
  multi-instance, up to 10 users free) is the pattern in ../listing-export/pricing.md; rates for
  Reports are not set anywhere in the brief or spec — enter them in the partner portal after you
  decide. Nothing here is a price.]`

## Categories

`[OWNER: pick from the live list.]` Best guesses for Jira: **Reporting**, secondary **Import & export**
or **Document management** if offered.

## Keywords

jira export, jira to excel, jira to word, jira to pdf, export issues, xlsx, docx, report template,
sprint report, release notes, jql export

## Data residency statement

> ArtUp Reports is an Atlassian Forge app with no external servers and no outbound network calls.
> Issue data is read and converted in the user's browser and downloaded as a file; it is not sent to
> the app's backend and not stored by the app. The app stores only export templates (names, settings
> and uploaded .docx template files) in Forge storage, which Atlassian hosts in the customer's
> Forge data residency region.

## Runs on Atlassian

`forge eligibility -e development` returned eligible for version 3.2.0 (acceptance file, part A).
`[OWNER: re-run after forge deploy -e production; claim the badge only after that.]`

## Languages

cs-CZ, da-DK, de-DE, en-GB, en-US, es-ES, et-EE, fi-FI, fr-FR, hu-HU, is-IS, it-IT, ja-JP, ko-KR,
nl-NL, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, sv-SE, tr-TR, zh-CN, zh-TW (fallback en-US).
`[OWNER: ko, is, et, hu translations still need a native-speaker check.]`
