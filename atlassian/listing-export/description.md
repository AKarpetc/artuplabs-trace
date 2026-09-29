# ArtUp Export — listing text (English)

Status: draft for the owner. Character limits are the same unverified figures used for ArtUp Trace
(`../listing/listing.md`) — re-check each on the live "Create listing" form before pasting.

## App name

Rule: "Git" only as a description of the output (Git is a trademark of the Software Freedom
Conservancy; descriptive use such as "for Git" is allowed, a name like "GitExport" is not). The
Atlassian product name must not lead the name; "for Confluence" is the allowed form.

| # | Candidate | Chars | Note |
|---|---|---:|---|
| **1 (primary)** | **ArtUp Export – Markdown for Git & Docs Sites** | 44 | says both jobs: a git repo and a static site; brand first |
| 2 | ArtUp Export – Markdown & Docs-as-Code for Confluence | 53 | catches "docs-as-code" searches; "for Confluence" form |
| 3 | ArtUp Export – Git-ready Markdown with Front-matter | 51 | most concrete; weaker for Hugo/MkDocs searches |

(Limit found for Trace: 60 characters.)

## Tagline

**Export pages, branches or whole spaces to git-ready Markdown: full depth, stable paths, front-matter and update exports.**

(120 characters; limit found: 130.)
Shorter: **Confluence spaces as Markdown for git, Hugo, Docusaurus and MkDocs.** (67)

## Summary

Export a page, a branch or a whole space to Markdown you can commit: the full tree in Confluence
order, stable file names, YAML front-matter, attachments, and update exports with only what changed.
Runs on Atlassian.

(216 characters; limit found: 250.)

## Full description

```markdown
## Confluence to git-ready Markdown

ArtUp Export turns a Confluence page, a branch or a whole space into a zip of Markdown files you
can commit to git or publish with a static site generator. It is built for docs-as-code: the same
space exported twice gives the same files, and the next export can contain only what changed.

### Getting started

1. A Confluence administrator installs ArtUp Export from the Atlassian Marketplace. Sites with up
   to 10 users use it free; no configuration is needed.
2. In a space, open **ArtUp Export** in the space sidebar (apps section), or use **•••** →
   **Export to Markdown** on any page.
3. Pick what to export (whole space, page and children, one page), a format (Generic Markdown,
   Hugo, Docusaurus, MkDocs) and a mode (full export or update of a previous export).
4. Click **Export**. The zip downloads when the export finishes; keep its `export-manifest.json`
   for the next update export.

Full guide: https://artuplabs.com/docs/export/

### What it does

- **Full depth, Confluence order.** Every level of the page tree becomes folders — a page with
  children is a folder with an index file, a page without children is one `.md` file. Siblings
  keep the order of the Confluence sidebar, stored in front-matter or as numeric prefixes.
- **Stable paths.** File names are ASCII slugs of the titles (accents, Cyrillic, Greek and more are
  transliterated; clashing names get the page id). A page keeps its file name on later exports, and
  an unchanged space re-exports byte-identical.
- **YAML front-matter.** Every page carries its Confluence id, title, space, parent, version, last
  author, update time, labels and page URL.
- **Attachments and links.** Attachments are written next to their pages; links between pages and
  images become relative paths.
- **Update exports.** Each zip includes `export-manifest.json` (ids, versions, paths — no content).
  Drop the previous zip into "Update previous export" and get only new and changed pages, plus
  `export-deleted.txt` for renamed, moved and deleted pages. One shell command applies it, and
  `git status` shows exactly what changed.
- **Presets.** Generic Markdown, Hugo (`_index.md`, `weight`), Docusaurus (`sidebar_position`,
  `_category_.json`, MDX-safe output) and MkDocs (`.pages` for awesome-pages). Info, tip, note and
  warning panels become the generator's own admonitions.
- **Nothing dropped silently.** Macros that have no Markdown equivalent get a placeholder, and the
  result screen lists every one with its page: unknown and dynamic macros, merged-cell tables,
  missing attachments, unresolved users and more.
- **From the space or the page.** Open ArtUp Export in the space sidebar, or use ••• → Export to
  Markdown on any page.

### Private by design

The export runs in your browser. ArtUp Export reads Confluence with your permissions, converts and
zips the pages locally and downloads the zip. Page content is never sent to the app's backend or to
ArtUp Labs, nothing is stored, and the app makes no outbound calls — it runs on Atlassian.

### Tested at 1,000 pages

On a test space of 1,001 pages (tree depth 6) with 200 attachments, a full export took about
4 minutes (201 MB zip), and an unchanged re-export was byte-identical.

### Interface

26 languages following the Confluence language setting, light and dark theme.

### What it is not

A one-way export: it does not import Markdown into Confluence and does not push to a git server —
you commit the files yourself or in CI. Confluence Cloud only.

### Links

- Product page: https://artuplabs.com/export/
- Documentation: https://artuplabs.com/docs/export/
- Support: https://artuplabs.com/support (hello@artuplabs.com)
- Privacy: https://artuplabs.com/privacy · Security: https://artuplabs.com/security
- Terms: https://artuplabs.com/terms
```

The privacy (§5), security (§1.1, §2) and terms pages cover ArtUp Export since 2026-09-29; they go
live with the next site deploy.

## Categories

`[TODO]` pick from the live list. Best guesses: primary **Document management** (or "Content
management"), secondary **Developer tools** if offered for Confluence, otherwise **Integrations**.

## Keywords

markdown export, confluence to markdown, docs as code, git, static site, hugo, docusaurus, mkdocs,
front-matter, incremental export

## Data residency statement

> ArtUp Export is an Atlassian Forge app with no external servers and no outbound network calls.
> Page content is read and converted in the user's browser and downloaded as a zip; it is not sent
> to the app's backend and not stored by the app. The app stores no customer data, so there is no
> app data to locate — Confluence content stays in the customer's Confluence site.

## Runs on Atlassian

`forge eligibility -e development` returned eligible on 2026-09-29 (version 2.2.0, per
`../20_app2_markdown_export.md` §11). `[TODO]` re-run after `forge deploy -e production`.

## Languages

cs-CZ, da-DK, de-DE, en-GB, en-US, es-ES, et-EE, fi-FI, fr-FR, hu-HU, is-IS, it-IT, ja-JP, ko-KR,
nl-NL, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, sv-SE, tr-TR, zh-CN, zh-TW (fallback en-US).
