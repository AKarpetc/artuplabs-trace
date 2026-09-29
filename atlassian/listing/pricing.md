> **Decision 2026-09-28: Option B — set in the partner portal.** Atlassian uses graduated per-user pricing (each user priced at the rate of its tier). Entered per user/month (single = multi-instance): up to 10 users Free; 1–100 $0.70; 101–250 $0.59; 251–1000 $0.49; 1001–2500 $0.45; 2501–5000 $0.42; 5001–7500 $0.39; 7501–10000 $0.37; 10001–15000 $0.32; 15001–20000 $0.29; 20001–25000 $0.27; 25001–30000 $0.26; 30001–40000 $0.20; 40001–45000 $0.19; higher tiers ≈ Atlassian default × 0.155. Resulting totals: 50 users $35/mo, 200 users $129/mo, 500 users $281/mo. The tier grid below is the original draft and is superseded.

# ArtUp Trace — pricing draft

Status: **decision for the owner.** This is a starting grid to paste into the
Marketplace partner portal's pricing tool and adjust, not a final price.
Nothing here has been submitted or published.

## Where the competitor numbers came from

Per `~/DistributB2B/atlassian/15_traceability_gaps.md` §1 ("15 листингов
темы"): the `$/200` column is each app's cloud price in USD/month at 200
seats, read from Atlassian's public cloud pricing endpoint
(`/pricing/cloud/live`) on 2026-09-24, the same method used in
`04_market_measurement.md`/`14_domain_scan.md`.

| App | Vendor | $/month at 200 users | Notes |
|---|---|---:|---|
| **Links Explorer Traceability** | Optimizory | **$82** | Coverage-only ("which requirements have no verification"), Runs on Atlassian, 231 installs, 4.93★ |
| **Trace Gap** | Bobook | **$184** | Same simple coverage-only positioning as Links Explorer, Runs on Atlassian, released 2026-09-08, 2 installs, no reviews yet |
| R4J (easeRequirements) | Ease Solutions | $282 | Full requirements-management suite, 1,964 installs — not a direct positioning match, cited for context |

These two ($82 / $184) are the direct positioning comparables: both are
"coverage from native Jira links, zero setup" apps, which is the same
starting point as ArtUp Trace's v1 coverage tab. ArtUp Trace adds two things
neither of them has — suspect links and baselines — which is the paid
differentiation the market research recommended building (`15_traceability_gaps.md`
§4, "Кандидат 1").

## Standard Atlassian per-user tier grid

**`[TODO]`** the exact tier breakpoints are configurable per app through
Atlassian's Commerce Pricing API/partner portal (confirmed via WebSearch of
https://developer.atlassian.com/platform/marketplace/marketplace-app-pricing-api/
— tier floors/ceilings are vendor-configurable, e.g. 1-10, 11-15, 16-25, 26-50,
51-100, 101-200, etc.), so there is no single universal table. The rows below
use the tier set commonly offered by the portal's default picker; confirm the
exact list in the partner portal before submitting, and adjust to match
whatever bracket actually contains "200 users" there (it may be "101-200" or
"101-250" depending on the picker).

Three options, each calibrated so the bracket containing 200 users lands on
the reference price (A = Links Explorer, B = midpoint, C = Trace Gap). Other
tiers are extrapolated using a typical Marketplace degression curve (roughly
the shape seen across comparable apps in the research data) — **these
in-between numbers are illustrative, not scraped from any competitor's actual
tier table**, since the research only captured the single $/200 reference
point per app, not full tier grids.

| User tier | A — match Links Explorer | B — middle | C — match Trace Gap |
|---|---:|---:|---:|
| 1–10 | $0 (free) | $0 (free) | $0 (free) |
| 11–100 | $41 | $65 | $92 |
| 101–250 (200 users lands here) | **$82** | **$130** | **$184** |
| 251–500 | $131 | $208 | $294 |
| 501–1,000 | $189 | $299 | $423 |
| 1,001–2,000 | $262 | $416 | $589 |
| 2,001–3,000 | $312 | $494 | $699 |
| 3,001–4,000 | $353 | $559 | $791 |
| 4,001–5,000 | $385 | $611 | $865 |
| 5,001–10,000 | $492 | $780 | $1,104 |
| 10,001+ | Contact us | Contact us | Contact us |

Annual price: per
https://developer.atlassian.com/platform/marketplace/pricing-payment-and-billing/,
Atlassian bills annual subscriptions at 10× the monthly tier price (an
effective two-months-free discount) — this is Marketplace-wide and not a
per-vendor choice, so it applies automatically to whichever option is picked.

## Free tier for 1–10 users

Per WebSearch of Atlassian's own docs: **a $0 price at the 1–10 user tier is
an option Atlassian gives vendors, not a mandatory rule** ("Apps are free
under 10 users" is not a platform requirement — many vendors opt in, some
don't). All three options above default it to free because:
- every competitor in the direct comparison set (Links Explorer, Trace Gap)
  is Runs on Atlassian and self-serve, same as ArtUp Trace, and a free small
  tier is the norm for that class of app;
- ArtUp Trace has no sales calls and no live support (per `site/support.html`),
  so a free small-team tier is the cheapest way to let a prospect try it
  without friction.

**`[TODO]`** the owner should confirm whether to keep the 1–10 tier free or
charge a nominal amount — this changes nothing about the 200-user reference
price above, only how a trial-sized site is treated.

## Recommendation (owner decision)

**Lean toward Option B (~$130 at 200 users), with room to move to C after the
first reviews land.** Reasoning:

1. ArtUp Trace's v1 is not the same product as Links Explorer or Trace Gap —
   it adds suspect-link detection and baseline diffing, which
   `15_traceability_gaps.md` identifies as the one thing cloud reviewers ask
   for that no Forge-native competitor offers (Requirement Yogi and R4J
   customers ask for baselines as a DC feature missing from Cloud). That
   argues for pricing **above** the coverage-only apps, not matching them —
   Option A would under-price a genuinely bigger feature set.
2. Trace Gap's own price ($184) belongs to a two-install, zero-review
   listing 16 days old — it's not yet a proven price point, and matching it
   outright (Option C) on day one, with zero installs and zero reviews of
   our own, adds price risk on top of adoption risk.
3. The research also documents that **support is the most-praised trait in
   this category** (39% of text reviews) and ArtUp Trace explicitly has no
   phone/live-chat support (`site/support.html` §1) — a self-serve app
   without a support motion converts better as a self-serve app: read
   reviews, install, decide. A mid-point price keeps the friction low while
   the differentiated features (suspect links, baselines) do the
   convincing, and it leaves headroom to raise toward Trace Gap's $184 once
   there is review evidence to support it — Marketplace pricing can be
   changed after publishing.

This is explicitly the owner's call, not a resolved decision — the market
evidence behind "suspect links + baselines" itself is called "слабые–средние"
(weak-to-moderate) in `15_traceability_gaps.md` §4, so there's a real
argument for starting at A instead and buying installs with price if the
differentiation doesn't convert on its own.

## What's unverified here

- Exact tier breakpoints as they'll appear in the live partner portal picker.
- Whether annual billing terms have changed since the pricing-payment-and-billing
  page was last updated (fetched via WebFetch summary, not read directly).
- The in-between tier numbers (251–500 through 10,000+) are modeled, not
  measured against any competitor's real tier table — only the $82/$184
  reference points are sourced from `15_traceability_gaps.md`.
