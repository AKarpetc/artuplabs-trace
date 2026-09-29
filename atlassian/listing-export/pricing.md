# ArtUp Export — pricing draft

Status: **decided 2026-09-29 — option B ($165 @ 200 users, up to 10 users free).** Numbers to enter in the partner portal's pricing tool; nothing
is submitted. The final price entry is the owner's.

## Anchor

From the brief ([`../20_app2_markdown_export.md`](../20_app2_markdown_export.md) §2, source
[`../12_markdown_export_niche.md`](../12_markdown_export_niche.md)):

| App | $/month at 200 users | Note |
|---|---:|---|
| Markdown Exporter for Confluence (leader) | $75 | 2 220 installs, ~3.5★; one level of children, alphabetical order |
| Git for Confluence | $175 | 1 078 installs; 0 price complaints in 22 reviews (gate G3) |
| **ArtUp Export target** | **$150–175** | 1–10 users free; cheaper than the leader is the wrong move (brief §2) |

## Tier model — same as ArtUp Trace

Graduated per-user pricing, as decided for Trace on 2026-09-28 ([`../listing/pricing.md`](../listing/pricing.md)):
each user is priced at the rate of its tier, per user per month, single = multi-instance, **sites up
to 10 users free**. The Export rates below are Trace's rates scaled so that 200 users land on the
target, rounded to cents.

| Users (tier) | Trace (for reference) | A — $150 @200 | **B — $165 @200** | C — $175 @200 |
|---|---:|---:|---:|---:|
| up to 10 users | Free | Free | **Free** | Free |
| 1–100 | $0.70 | $0.81 | **$0.90** | $0.95 |
| 101–250 | $0.59 | $0.69 | **$0.75** | $0.80 |
| 251–1 000 | $0.49 | $0.57 | **$0.63** | $0.66 |
| 1 001–2 500 | $0.45 | $0.52 | **$0.58** | $0.61 |
| 2 501–5 000 | $0.42 | $0.49 | **$0.54** | $0.57 |
| 5 001–7 500 | $0.39 | $0.45 | **$0.50** | $0.53 |
| 7 501–10 000 | $0.37 | $0.43 | **$0.47** | $0.50 |
| 10 001–15 000 | $0.32 | $0.37 | **$0.41** | $0.43 |
| 15 001–20 000 | $0.29 | $0.34 | **$0.37** | $0.39 |
| 20 001–25 000 | $0.27 | $0.31 | **$0.35** | $0.37 |
| 25 001–30 000 | $0.26 | $0.30 | **$0.33** | $0.35 |
| 30 001–40 000 | $0.20 | $0.23 | **$0.26** | $0.27 |
| 40 001–45 000 | $0.19 | $0.22 | **$0.24** | $0.26 |
| higher | ≈ Atlassian default × 0.155 | same factor × 1.16 | same factor × 1.28 | same factor × 1.36 |

Resulting monthly totals (graduated; computed, not from the portal):

| Users | A | **B** | C | Trace |
|---:|---:|---:|---:|---:|
| 11 | $9 | **$10** | $10 | $8 |
| 50 | $40 | **$45** | $48 | $35 |
| 100 | $81 | **$90** | $95 | $70 |
| 200 | $150 | **$165** | $175 | $129 |
| 500 | $327 | **$360** | $380 | $281 |
| 1 000 | $612 | **$675** | $710 | — |
| 2 000 | $1 132 | **$1 255** | $1 320 | — |
| 5 000 | $2 617 | **$2 895** | $3 050 | — |

Annual = 10× monthly (Marketplace-wide, as for Trace).

Confluence apps are priced by Confluence users of the site, so a 200-user Confluence site pays the
200-user price even if only a few people export.

## Recommendation (owner decision)

**B — $165 at 200 users.** The middle of the brief's $150–175 range:

1. Git for Confluence holds $175 with 1 078 installs and no price complaints (G3), so the top of the
   range is proven for this buyer; ArtUp Export has no reviews yet, so start a step below it.
2. The leader is $75 but lacks what this app sells (depth, order, stable paths, front-matter,
   updates); the brief rules out undercutting — the small segment rarely crosses the threshold on
   price anyway (brief §2, 09 §4.1).
3. Free up to 10 users keeps trials frictionless for a self-serve app without sales calls, the same
   as Trace.

Marketplace prices can be changed after publishing; moving to C after the first reviews is the
natural next step.

## Unverified

- Exact tier breakpoints in the live pricing tool (the Trace entry used the ones above).
- The "higher" tiers: Trace used ≈ Atlassian default × 0.155; the Export factor assumes the same
  default curve.
