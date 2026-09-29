# ArtUp Trace — Marketplace listing drafts

Draft content for the Atlassian Marketplace listing of **ArtUp Trace**
(paid Jira Cloud Forge app, requirements traceability, publisher ArtUp Labs).
Nothing here has been submitted or published — these are files to review,
edit, and paste into the Marketplace partner portal.

## Files

- **`listing.md`** — app name, tagline, summary, full description, 3
  highlights (title/summary/screenshot), categories, keywords, links,
  "Runs on Atlassian" note, 26 supported languages, data residency statement.
- **`privacy-security-tab.md`** — answers for the listing's Privacy &
  Security tab: what's stored and where, each requested scope with its
  justification (verified against `manifest.yml`), egress (none),
  retention/deletion on uninstall, sub-processors (Atlassian only), logging,
  contacts.
- **`pricing.md`** — a per-user monthly tier grid for three options (A ≈
  Links Explorer $82@200, B ≈ midpoint $130@200, C ≈ Trace Gap $184@200),
  the free-for-10-users note, and a one-paragraph recommendation.
- **`screenshots.md`** — 5–6 screenshots in order, each with exact capture
  steps on `artuplabs-dev.atlassian.net` project REQ, what must be visible,
  and caption text.

## Sources used

- Code/facts: `~/Projects/My/artuplabs-trace/README.md`, `manifest.yml`,
  `static/app/src/i18n/locales/en-US.json`, `src/handlers/resolvers.js`.
- Market research: `~/DistributB2B/atlassian/15_traceability_gaps.md` (this
  is where the $82 / $184 competitor reference prices and the
  suspect-links/baselines differentiation rationale come from) and
  `~/DistributB2B/STATE.md` (sections "Отличие v1 (В2)" and the ArtUp Trace
  build/acceptance log).
- Site wording: `~/DistributB2B/site/privacy.html`, `security.html`,
  `support.html` — the privacy/security-tab draft and the data-residency
  statement are written to stay consistent with these, not to introduce new
  claims.
- Marketplace field requirements: fetched from developer.atlassian.com and
  support.atlassian.com pages via WebSearch/WebFetch (URLs cited inline in
  `listing.md` and `pricing.md`). These were read through an
  automated summarizing fetch, **not opened directly** — every specific
  number (character limits, image sizes, tier breakpoints) should be
  re-checked against the live submission form before anything is pasted in.

## Decisions left for the owner

1. **Pricing tier (`pricing.md`).** Option A/B/C, or a different number.
   Draft recommendation leans toward B (~$130@200) as an entry price with
   room to move toward Trace Gap's $184 once reviews exist, but the
   evidence behind the suspect-links/baselines differentiation is itself
   called "weak-to-moderate" in the research — this is not a settled call.
2. **Documentation link.** `listing.md` and `site/support.html` both note
   "Setup guides ... coming soon" — a docs URL is `[TODO]` everywhere it's
   referenced.
3. **Terms/EULA.** `site/terms.html` is marked **Draft** pending legal
   review; do not treat its content as final for the listing submission
   until the owner confirms a lawyer has reviewed it.
4. **Categories** in `listing.md` are best-guess placeholders — the live
   Marketplace category dropdown wasn't opened in this pass.
5. **DPA question** in `privacy-security-tab.md` §7 — whether a separate
   Data Processing Addendum is needed beyond Atlassian's standard end-user
   agreement.
6. Whether to keep the 1–10 user tier free (all three pricing options
   default to free; this is configurable independently of the 200-user
   reference price).

## What's still unverified before publishing

- Exact Marketplace field character limits and image dimensions (fetched
  indirectly; re-check on the live form — see caveats repeated in
  `listing.md` and `screenshots.md`).
- Exact tier breakpoints in the live pricing picker (`pricing.md`).
- Whether `forge eligibility -e production` has been re-run after the first
  production deploy — the app's own `README.md` lists this as outstanding,
  and `listing.md`/`privacy-security-tab.md` both flag it before the "Runs
  on Atlassian" badge is asserted publicly.
- All six screenshots in `screenshots.md` are planned, not captured — some
  require setting up data on artuplabs-dev first (a suspect link, two
  baselines) per that file's "Before capturing anything" section.
