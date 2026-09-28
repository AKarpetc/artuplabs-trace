# ArtUp Export

A Forge app for Confluence Cloud that exports a page, a branch or a whole space to a git-ready
Markdown zip: one `.md` file per page with YAML front-matter, the page tree kept as folders,
attachments next to their pages, stable file names between exports and an update mode that
contains only what changed.

## Usage

- **Whole space:** in a space, open **ArtUp Export** in the space sidebar (apps section). Pick the
  scope (whole space, page and children, one page), the output preset and the options, then
  export. The zip downloads when the export finishes; keep the tab open until then.
- **One page or a branch:** on a page, open **•••** → **Export to Markdown** and choose
  "This page" or "This page and its subpages".

Every zip contains `export-manifest.json` (page ids, versions, paths, options — no page content).
Keep it with the exported files: it is what makes the next export an update.

### Front-matter

Every page starts with YAML front-matter in this order (no export time, so repeated exports are identical):

| Key | Value |
|---|---|
| `title` | Page title |
| `confluence_id` | Page id |
| `space` | Space key |
| `parent_id` | Parent page id (omitted for a top-level page) |
| `version` | Page version number |
| `author` | Display name of the last editor (omitted when unknown) |
| `updated` | Time of the last edit (ISO 8601) |
| `weight` / `sidebar_position` | Order among siblings (Generic and Hugo / Docusaurus; none for MkDocs) |
| `labels` | Page labels, sorted (`[]` when none) |
| `confluence_url` | URL of the page in Confluence |

### Presets

| Preset | Index file | Order | Extra files |
|---|---|---|---|
| Generic Markdown | `index.md` | `weight` in front-matter | — |
| Hugo | `_index.md` | `weight` | — |
| Docusaurus | `index.md` | `sidebar_position` | `_category_.json` per folder (label, position) |
| MkDocs | `index.md` | — | `.pages` per folder (for `mkdocs-awesome-pages-plugin`) |

What each preset writes into the page bodies:

| Preset | Info / tip / note / warning panels | Placeholder for a dynamic or unknown macro |
|---|---|---|
| Generic Markdown, Hugo | GitHub alerts: `> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!CAUTION]` | `<!-- confluence:NAME -->` |
| Docusaurus | `:::note[Title]` … `:::` (`note`, `tip`, `warning`, `danger`); a panel nested in a panel gets a longer outer fence (`::::`) | `{/* confluence:NAME */}` |
| MkDocs | `!!! note "Title"` with the body indented by 4 spaces (`note`, `tip`, `warning`, `danger`) | `<!-- confluence:NAME -->` |

- A plain `panel` macro is a blockquote in every preset. Code blocks and inline code are never escaped.
- **Docusaurus** builds the export with its default `markdown.format: 'mdx'`: braces in text are
  escaped (`\{`, `\}`), void tags are self-closed (`<br />`), merged-cell tables use
  `colSpan`/`rowSpan` and `<tbody>`, and a text line that MDX would read as `import`/`export` or
  as a directive fence (`:::`) is escaped.
- **MkDocs** output is written for Python-Markdown: nested list items are indented by 4 spaces,
  items of a list with multi-paragraph items are separated by blank lines, braces in text are
  escaped (so `attr_list` cannot take `{#id}` or `{: .x }` from page text), and `<details>` and
  merged-cell tables carry `markdown="1"` (cells `markdown="block"`) so `md_in_html` renders
  their Markdown. Hard breaks stay `\` + newline. Install
  `pip install mkdocs mkdocs-awesome-pages-plugin pymdown-extensions` and use in `mkdocs.yml`:

  ```yaml
  plugins:
    - awesome-pages
  markdown_extensions:
    - admonition
    - pymdownx.tasklist
    - tables
    - attr_list
    - md_in_html
    - pymdownx.superfences      # code blocks inside panels and list items
    - pymdownx.tilde            # ~~strikethrough~~
    - pymdownx.escapeall:       # every \-escape, and \ + newline as a line break
        hardbreak: true
  ```
- **Hugo** renders the alerts as styled blocks only with a blockquote render hook
  (`layouts/_markup/render-blockquote.html` that checks `.Type "alert"`; many themes ship one),
  merged-cell tables and `<details>` only with `markup.goldmark.renderer.unsafe = true`, and
  resolves links between `.md` files with `markup.goldmark.renderHooks.link.enableDefault = true`.

A page with children becomes a folder with the index file; a page without children is `<name>.md`.
File names are ASCII slugs of the titles; sibling collisions (including ones that differ only by
case or accents) get the page id appended, and a page keeps its file name on later exports.

### Update workflow

1. Run a full export once and commit the unzipped tree, for example into `docs/`.
2. Later, choose **Update previous export** and drop in the previous zip (or its
   `export-manifest.json`). The new zip holds only new and changed pages, their attachments, the
   new manifest and `export-deleted.txt` with the paths to remove (renamed, moved and deleted pages).
3. Apply it over the tree:

```sh
unzip -o <zip> -d docs && cd docs && if [ -f export-deleted.txt ]; then while IFS= read -r f; do rm -f -- "$f"; done < export-deleted.txt; rm -f export-deleted.txt; fi
```

4. `git status` shows the pages that changed in Confluence. Exporting again without changes in
   Confluence gives byte-identical files, so `git status` stays clean.

If the space, root page or path options differ from the previous manifest, the app says so and runs
a full export instead.

## Data handling

- Content is read with the permissions of the user who runs the export, through
  `requestConfluence` in the user's browser. Pages the user cannot see are not exported.
- Conversion and zip packing happen in the user's browser. Page content is not sent to the app's
  backend, not stored by the app and does not leave Atlassian and the user's machine: the app has
  no external egress (Runs on Atlassian).
- No server storage of content or personal data. Author names are fetched at export time and
  written only into the user's zip.
- Scopes are read-only: pages, spaces, attachments, labels, hierarchy, users, search, app storage.

## Development

```sh
npm test                 # backend tests
npm run test:ui          # Custom UI tests
npm run lint
npm run build:ui         # builds static/app/dist for both Custom UI resources
forge deploy -e development --non-interactive
forge eligibility -e development --non-interactive
```

Backend resolvers are in `src/`; the Custom UI (React 18 + Atlaskit) is in `static/app`. Pure
conversion and planning logic is in `static/app/src/core`, Confluence and zip I/O in
`static/app/src/infra`, orchestration in `static/app/src/export`.

### Load check scripts

```sh
set -a && . /path/to/.env && set +a        # FORGE_EMAIL, FORGE_API_TOKEN
node scripts/acceptance.mjs full --space EXPT --preset generic --out data/full-1.zip
node scripts/acceptance.mjs update --space EXPT --previous data/full-1.zip --out data/update.zip
node scripts/acceptance.mjs edit --space EXPT          # edits the dev test space
node scripts/verify-zero-diff.mjs data/full-1.zip data/full-2.zip
node scripts/verify-zero-diff.mjs data/full-1.zip data/full-2.zip data/update.zip data/full-3.zip
node scripts/verify-sites.mjs data/full-docusaurus.zip --preset docusaurus --workdir /tmp/sites
node scripts/verify-sites.mjs data/full-mkdocs.zip --preset mkdocs --workdir /tmp/sites
node scripts/verify-sites.mjs data/full-hugo.zip --preset hugo --workdir /tmp/sites
```

`verify-sites.mjs` builds a real site from an export zip, installing everything under
`--workdir` (a Docusaurus 3 classic site, a Python venv with MkDocs, the `hugo-extended` npm
package when `hugo` is not on `PATH`; prints `hugo: not run` when neither works). It exits
non-zero when the build fails, prints the sidebar/nav order of the top levels next to the
Confluence tree from `export-manifest.json` (`--depth`, default 2), and counts built pages with
styled admonitions and pages that show literal markers such as `[!NOTE]`. The Hugo check uses a
bare site with no theme and no render hooks.

`acceptance.mjs` runs the same pipeline as the app (`static/app/src/export/pipeline.js`) in
Node 22 with a fetch adapter and basic auth instead of the Forge bridge. `edit` needs the seed
file written by `scripts/seed-space.mjs` in `data/`.

## Load check

Measured on 2026-09-29 on the development site, space EXPT: 1 001 pages (home + 1 000 seeded,
tree depth 6), 200 attachments (100 × 68 B PNG, 100 × 2 MiB binary), request concurrency 6,
run from a MacBook over the public REST API (the same calls the app makes through the bridge).

| Run | Time | Pages written | Attachments | Zip | Requests | 429 |
|---|---|---|---|---|---|---|
| Full, generic (1) | 258 s | 1 001 | 200 | 201.3 MB | 3 216 | 0 |
| Full, generic (2) | 245 s | 1 001 | 200 | 201.3 MB | 3 216 | 0 |
| Update after edits | 137 s | 22 | 2 | 2.1 MB | 2 032 | 0 |
| Full, generic (3) | 244 s | 1 000 | 200 | 201.3 MB | 3 211 | 0 |

- Time split of a full run: tree scan with attachment lists 116–131 s, page bodies and labels
  55–58 s, attachment download 65–69 s, pack under 1 s.
- Warnings in a full run: 3 000 — `complex-table` 1 000, `dynamic-macro` (toc) 1 000,
  `missing-attachment` 1 000. All three come from the seeded page body (a colspan table, a TOC
  macro and an image of `image.png` that the seed never uploaded).
- Zero diff: two full exports without changes → `IDENTICAL` (1 202 files); the two zips are
  byte-identical as well.
- Update round-trip: 3 body edits, 1 rename, 1 move, 1 delete. The update zip had 22 pages
  (3 edited, 2 at new paths, 14 whose front-matter `weight` or relative links changed because of
  the move, rename or delete, 3 parents rewritten with unchanged bytes), 2 attachments and 3 paths
  in `export-deleted.txt`. Applying it over the first full export → `IDENTICAL` to a fresh full
  export (1 201 files).
