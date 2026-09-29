# ArtUp Export — Marketplace listing drafts

Draft content for the Atlassian Marketplace listing of **ArtUp Export** (Confluence Cloud Forge
app `com.artuplabs.export`, publisher ArtUp Labs). Nothing here has been submitted — these files
are for the owner to review and paste into the partner portal. Structure and tone follow the
ArtUp Trace drafts in [`../listing/`](../listing/).

## Files

| File | Contents |
|---|---|
| [`description.md`](description.md) | three name candidates (primary chosen), tagline, summary, full description, categories, keywords, links |
| [`highlights.md`](highlights.md) | the 3 highlights (title, summary, screenshot) and captions for every gallery screenshot |
| [`pricing.md`](pricing.md) | graduated per-user tier table in the Trace format, three options, recommendation — **final price is the owner's** |
| [`privacy-security.md`](privacy-security.md) | Privacy & Security tab answers: storage (none), each scope, egress (none), logs, Runs on Atlassian, GDPR role |
| `screenshots/draft/*.png` | 6 gallery frames, 1840×900 (en-US; five light, one dark) |
| `screenshots/compose.mjs` | the Playwright script that composed them from the product's preview harness |

## Screenshots

| # | File | Shows |
|---|---|---|
| 1 | `screenshots/draft/1-studio-form.png` | space page: what to export, format presets, output preview (highlight 1) |
| 2 | `screenshots/draft/2-update-mode.png` | update result: changed/unchanged/deleted and the apply command (highlight 3) |
| 3 | `screenshots/draft/3-progress.png` | export running in the browser |
| 4 | `screenshots/draft/4-result-warnings.png` | result with the warnings list |
| 5 | `screenshots/draft/5-page-action.png` | page menu dialog, “This page and 10 subpages” |
| 6 | `screenshots/draft/6-studio-form-dark.png` | dark theme, options and front-matter preview (highlight 2) |

Each frame is a 920×450 composition rendered at device scale 2 (so 1840×900): caption band on top,
the app at 65% of its 1280 px layout (87% for the 960 px page dialog) in a browser-style window.
Data comes from the preview harness's showcase fixture (`?fixture=showcase`: space DOCS
"Engineering Handbook", English titles plus one Cyrillic and one French branch), not from a real
customer. The fixture lives in `~/Projects/My/artuplabs-export/static/app/preview/fixtures.js`.
Shots 1–5 show the app from its top or from a card boundary; shot 6 is scrolled past the header to
the options and the front-matter preview. To regenerate: start the harness (`cd ~/Projects/My/artuplabs-export/static/app && npx vite
--mode preview --port 5391`), then `node screenshots/compose.mjs <out-dir> [name-prefix]`.

If the portal asks for 920×450 or for 580×330 highlight crops, downscale or crop these frames — do
not reshoot.

## Sources

- Product facts: `~/Projects/My/artuplabs-export/README.md`, `manifest.yml`,
  `static/app/src/i18n/locales/en-US.json`, `static/app/src/core/*`, `src/resolvers.js`.
- Positioning and price: [`../20_app2_markdown_export.md`](../20_app2_markdown_export.md) §2, §11
  (phase 0 and acceptance numbers), [`../12_markdown_export_niche.md`](../12_markdown_export_niche.md).
- Tier model: [`../listing/pricing.md`](../listing/pricing.md) (Trace decision 2026-09-28).
- Marketplace field limits: same unverified figures as the Trace drafts (name 60, tagline 130,
  summary 250, highlight title 50 / summary 220) — re-check on the live form.

## Decisions left for the owner

1. **Name** — primary "ArtUp Export – Markdown for Git & Docs Sites" or one of the two alternatives
   (`description.md`).
2. **Price** — option A/B/C in `pricing.md` (draft recommendation: B, $165 at 200 users).
3. **Legal pages** — `site/privacy.html` (§5), `security.html` (§1.1, §2) and `terms.html` now cover
   ArtUp Export (2026-09-29); review them together with the Trace text before the site deploy.
4. **Categories** — pick on the live form (`description.md` has guesses).
5. **Production** — `forge deploy -e production` and `forge eligibility -e production` before the
   listing claims Runs on Atlassian.
