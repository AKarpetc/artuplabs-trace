# ArtUp Trace — Marketplace listing draft (English)

Status: draft for the owner to review before pasting into the Marketplace
partner portal. Character limits below are taken from a WebFetch summary of
developer.atlassian.com pages, not a verbatim quote of the submission form —
**re-check every limit against the live "Create listing" form before pasting**
(see Sources at the end). Every unverifiable fact is marked `[TODO]`.

## App name

**ArtUp Trace**

(Limit found: 60 characters. Used: 11.)

## Tagline

**See which requirements have no test — and which links went stale.**

(Limit found: 130 characters. Used: 71.)
Alternative, shorter: **Requirements coverage, suspect links and baselines for Jira Cloud.** (72 chars)

## Summary

Track requirements coverage from Jira's own issue links, catch links that go
stale when a requirement changes, and compare point-in-time baselines — all
read-only, with CSV export and zero new issue types. Runs on Atlassian.

(Limit found: 250 characters. Used: 236.)

## Full description ("More details" / long description body)

> Note: the WebFetch summary listed a 1000-character "More details" field
> separate from a richer markdown "Description" field. Atlassian's own listing
> pages (e.g. Trace Gap, Links Explorer) show long-form Markdown descriptions
> well past 1000 characters, so this longer text below is written for the
> Marketplace's rich-text Description editor. **`[TODO]` confirm in the
> partner portal which field takes this text, and trim to fit if the portal
> enforces a hard 1000-character cap.**

```markdown
## Requirements traceability without a new data model

ArtUp Trace turns issue types you already use into a lightweight
requirements-traceability view — no new issue types, no custom fields, no
writes to your issues. Point it at a project, choose which issue types count
as "requirements" and which count as "verification" (tests, tasks, or
whatever your team links back to a requirement), and it starts computing
coverage from the issue links already in Jira.

### What it does

- **Coverage.** See what percentage of your requirements have a linked
  verification issue, and drill into the ones that don't.
- **Suspect links.** When a requirement's summary or description changes
  after a link to it was confirmed, the link is flagged suspect — the
  confirmation may be stale. One click re-confirms it against the
  requirement's current content.
- **Baselines.** Capture a point-in-time snapshot of a project's requirements
  and their links. Compare any two baselines to see what was added, removed,
  or changed, including link changes — paged, and exportable to CSV for an
  audit trail.
- **Issue panel.** A panel on each requirement issue shows its coverage and
  suspect status inline, without leaving the issue.
- **Read-only.** ArtUp Trace never writes to your issues. It reads only what
  the viewing user can already see in Jira, and every action re-checks Jira
  permissions.

### Built for Jira Cloud, not ported from Server/DC

ArtUp Trace is a native Atlassian Forge app carrying the **Runs on Atlassian**
designation: no external servers, no outbound network calls, no Connect
modules. All of its own data (project settings, requirement and link records,
baselines, sync bookkeeping) stays in Forge SQL and Forge storage, in your
site's data residency region as handled by Atlassian.

### How data stays current

Issue deletions are applied immediately. Other issue and link changes reach
ArtUp Trace through an incremental sync that starts about a minute after the
Jira event, backed by an hourly reconcile and a weekly full sync — so the
view self-heals even if an event is ever missed.

### Interface

The UI is Custom UI (React + Atlaskit design tokens), works in Jira's light
and dark themes, and follows the viewer's Jira language across 26 locales
(falling back to English for any missing string). CSV exports for gaps,
suspect links, and baseline diffs download straight to the browser.

### What it is not

ArtUp Trace is not a full requirements-management or test-management suite —
there are no test runs, no risk registers, no Confluence macro (yet), and the
fingerprint used to detect a stale link is fixed to summary + description in
v1. If you need Xray- or Zephyr-level test execution, or DOORS-style
requirement authoring, this is not that. If you need "did this requirement
get verified, did that verification go stale, and what changed between two
points in time" on the issue links you already have, this is built for
exactly that.

### Runs on Atlassian

- No external servers, no outbound network calls (no egress).
- No Connect modules; bundled resources only.
- Data residency follows your Jira site, as handled by Atlassian.

### Scopes requested

`read:jira-work`, `read:jira-user`, `storage:app` — no write scopes for Jira
issues. See the Privacy & Security tab for what each scope is used for.

### Supported languages

26 locales, following the viewer's Jira language setting: cs-CZ, da-DK,
de-DE, en-GB, en-US, es-ES, et-EE, fi-FI, fr-FR, hu-HU, is-IS, it-IT, ja-JP,
ko-KR, nl-NL, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, sv-SE, tr-TR,
zh-CN, zh-TW. English is the fallback for any string not yet translated by a
native reviewer — **`[TODO]`** several locales (ja, ko, zh-CN, zh-TW, is, et,
fi, cs, sk, hu, ro, tr, pt-PT) are machine-translated and marked in STATE.md
as "show a native speaker before release."

### Links

- Website: https://artuplabs.com
- Documentation: **`[TODO]`** — support.html currently says "Setup guides and
  feature documentation are coming soon."
- Support: https://artuplabs.com/support (hello@artuplabs.com)
- Privacy Policy: https://artuplabs.com/privacy
- Security: https://artuplabs.com/security
- Terms / EULA: https://artuplabs.com/terms (site marks this **Draft until
  reviewed by a lawyer** — do not treat as final for the listing submission)
```

## Highlights (exactly 3 required; title ≤ 50 chars, summary ≤ 220 chars each)

### Highlight 1 — Coverage at a glance

**Title:** Requirements coverage at a glance (33 chars)

**Summary:** See what percentage of your requirements have a linked
verification issue, and jump straight to the ones that don't — computed from
the issue links you already use, no new issue types. (211 chars)

**Screenshot:** Coverage tab, project REQ (see `screenshots.md` #1).

### Highlight 2 — Suspect links

**Title:** Catch links that went stale (25 chars)

**Summary:** When a requirement changes after its link was confirmed, ArtUp
Trace flags the link suspect. One click re-confirms it against the
requirement's current content. (170 chars)

**Screenshot:** Suspect links tab, project REQ (see `screenshots.md` #3).

### Highlight 3 — Baselines and diff

**Title:** Compare requirements over time (30 chars)

**Summary:** Capture a point-in-time baseline of your requirements and their
links, then diff any two baselines to see what was added, removed, or
changed — exportable to CSV for an audit trail. (198 chars)

**Screenshot:** Baseline diff view, project REQ (see `screenshots.md` #5).

## Categories

**`[TODO]`** — pick from the live Marketplace category list at submission
time; it was not fetched in this pass. Best-fit guesses based on how
competitors (Trace Gap, Links Explorer, R4J) are categorised per
`atlassian/15_traceability_gaps.md`:
- Primary: Application Lifecycle Management (or "Reports & Analytics" if ALM
  is not offered for Jira Cloud apps at submission time)
- Secondary: Testing & QA **`[TODO]`** verify this category exists for Jira

## Keywords

requirements traceability, traceability matrix, requirements coverage,
suspect links, baseline comparison, audit export, verification tracking,
Jira Cloud

**`[TODO]`** the exact keyword field limit (count / total characters) was not
confirmed from the fetched pages; the search result warned Atlassian favours
"quality content ... rather than keyword stuffing" — keep this list short and
literal rather than padding it.

## Data residency statement

Consistent with `site/privacy.html` §6 and `site/security.html` §1:

> ArtUp Trace is an Atlassian Forge app with the "Runs on Atlassian"
> designation. It has no external servers and makes no outbound network
> calls. All of its data (project settings, requirement and link records,
> baselines, sync job metadata) is stored only in Forge SQL and Forge
> storage, on Atlassian's infrastructure, in the customer's data residency
> region as handled by Atlassian. ArtUp Labs does not copy app data to its
> own systems.

## "Runs on Atlassian" note

Confirmed in `manifest.yml` (no external egress scopes, no Connect modules,
`resources` are all bundled paths under `static/app/dist/...`) and in
`README.md`: "`forge eligibility` checks the deployed version against the
Runs on Atlassian program (no external egress, no remotes/Connect modules,
bundled resources only)." Per `README.md`, eligibility was confirmed on the
development environment as of 2026-09-25 (v4.0.0) — **`[TODO]`** re-run
`forge eligibility -e production` after the first production deploy, as the
README's own outstanding item says, before claiming the badge on the live
listing.

## Sources consulted for field limits (cite before trusting a number above)

- https://developer.atlassian.com/platform/marketplace/creating-a-marketplace-listing/
- https://developer.atlassian.com/platform/marketplace/building-your-presence-on-marketplace/
- https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- https://developer.atlassian.com/platform/marketplace/pricing-payment-and-billing/
- https://support.atlassian.com/subscriptions-and-billing/docs/manage-users-and-user-tiers/

All of the above were read through an automated fetch-and-summarize tool, not
by opening the page directly — treat every specific number here as
provisional until the owner confirms it on the live page or submission form.
