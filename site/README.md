# ArtUp Labs website — draft static site

Plain HTML/CSS static site for `artuplabs.com` (ArtUp Trace for Jira Cloud). No build step, no
external fonts/CDNs/scripts/trackers. Shared styling lives in `style.css`; supports light and dark
mode via `prefers-color-scheme`. All pages carry "Last updated: 2026-09-25".

Pages: `index.html`, `support.html`, `security.html`, `privacy.html`, `terms.html`.
ArtUp Export (2026-09-29): `export/index.html` (product page, WebP screenshots and `icon.svg` next to it)
and `docs/export/index.html` (served at `/docs/export/`, the app's Help link). `/docs` still serves
`docs.html` (Trace docs) — checked with `wrangler pages dev`.

## Before publishing — legal review

`terms.html` (End User License Agreement) and `privacy.html` (Privacy Policy) are **drafts** and
have **not been reviewed by a lawyer**. Do not publish either page (or remove the "Draft" notice at
the top of `terms.html`) before a lawyer qualified in the Republic of Kazakhstan — and, if you sell
to customers in the EU/EEA or elsewhere, ideally one familiar with GDPR and the Atlassian Marketplace
partner requirements — has reviewed both documents, including the governing-law and liability
clauses in `terms.html`.

## Outstanding `[TODO: …]` items

Find them all with:

```
grep -rn "TODO" *.html
```

Resolved 2026-09-27: registered address and IIN, email retention (24 months), no Cloudflare Web Analytics, email provider Zoho Mail, no bug bounty, Kazakhstan public holidays.

| File | Location | What the owner must fill in |
|---|---|---|
| `index.html` | Hero CTA link + caption | The live Atlassian Marketplace listing URL for ArtUp Trace, once the listing is published. |
| `terms.html` | Draft notice | Remove only after a lawyer has reviewed the Agreement; see "Before publishing" above. |
| `terms.html` | §12 Governing law | Confirm governing law (Kazakhstan is used as a placeholder) and choose competent courts or an arbitration venue. |
| `support.html` | §4 Documentation | The real documentation/user-guide URL (currently unset). |

None of the above facts were invented — each is marked `[TODO: …]` in the page itself with a
highlighted style (`.todo` class in `style.css`) until the owner supplies the real value.

## Deployment (Cloudflare Pages)

No build step is required; this is a static folder. Two options:

1. **Dashboard upload** — in the Cloudflare dashboard, create a Pages project and use "Direct
   Upload" to upload the contents of this `site/` folder (no framework/build command needed).
2. **CLI deploy** with Wrangler, from the parent directory of `site/`:

   ```
   npx wrangler pages deploy site --project-name artuplabs
   ```

   This publishes the folder as-is to the `artuplabs` Pages project. Re-run the same command to
   push updates.

This README does not perform any deployment — it only documents the two supported methods for
whoever runs them.
