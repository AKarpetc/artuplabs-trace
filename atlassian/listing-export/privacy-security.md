# ArtUp Export — Privacy & Security tab draft

Status: draft answers, by topic (the live form's exact wording was not opened). Verified against
`~/Projects/My/artuplabs-export/manifest.yml`, `src/resolvers.js`, `src/access.js`,
`static/app/src/infra/confluence.js` and `README.md` (§ Data handling) on 2026-09-29.

Developer console → Distribution → "Does your app store personal data?" = **No**.

## 1. What data is stored, and where

**Nothing.** ArtUp Export v1 stores no data: no Forge storage (KVS/SQL/Custom Entities) is read or
written, and the backend has a single resolver (`getAccess`) that returns only the licence status
and environment type from the Forge context.

- Page content, attachments, labels and user display names are fetched **in the user's browser**
  (`requestConfluence` from `@forge/bridge`, as the current user), converted and zipped there, and
  downloaded as a file to the user's computer.
- `export-manifest.json` inside the zip (page ids, versions, paths, options, warnings — no content)
  lives only in the user's download. For an update export the user drops it back in; it is read in
  the browser and not uploaded anywhere.
- Author names are read at export time and written only into the user's zip.

The `storage:app` scope is declared in the manifest **for future versions** (adding a scope later
forces a major version and re-consent). v1 does not use it — say so plainly if the form asks.

## 2. Scopes requested, and why

All read-only. No write scope for Confluence.

| Scope | Used for |
|---|---|
| `read:page:confluence` | Page tree, bodies (storage format), versions and titles (`/wiki/api/v2/pages…`). |
| `read:space:confluence` | Resolve the space key to its id and list the space's root pages (`/wiki/api/v2/spaces…`). |
| `read:hierarchical-content:confluence` | Children of a page, in Confluence order, to rebuild the tree to full depth. |
| `read:attachment:confluence` | List and download page attachments written next to the pages. |
| `read:label:confluence` | Page labels for the `labels` front-matter key. |
| `read:confluence-user` | Display names of last editors and mentioned users (`/wiki/rest/api/user/bulk`) for the `author` key and `@mentions`. |
| `search:confluence` | Page picker (search pages by title) and page count for the export button (`/wiki/rest/api/search`). |
| `storage:app` | Declared for future versions; **not used in v1** (see §1). |

Because every read runs as the current user, pages the user cannot see in Confluence are not
exported.

## 3. Egress / outbound network calls

**None.** No `external` fetch permissions, no remotes, no Connect modules; resources are bundled
(`static/app/dist/...`, `resources/`). Content never leaves Atlassian and the user's browser.
`forge eligibility -e development` → eligible (Runs on Atlassian) on 2026-09-29, version 2.2.0.
`[TODO]` re-run for production after the production deploy.

## 4. Retention and deletion

Nothing to retain or delete: the app keeps no data. Uninstalling removes the app; the zips users
downloaded stay on their machines under their control.

## 5. Logging

Forge function logs (Atlassian) cover only the `getAccess` resolver, which receives the Forge
context and returns `{ licensed, environmentType }`. No page content, titles or user data pass
through the backend, so logs contain none. Browser-side errors stay in the user's browser.

## 6. Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| Atlassian | Hosting and running the app (Forge), platform logs, Marketplace licensing and billing | Customer's data residency region as handled by Atlassian |

No other sub-processor receives app data. Zoho Mail only receives support email a user chooses to
send (same as Trace).

## 7. Compliance / data-processing role

As for Trace: the customer is the controller for data the app processes within its Confluence site;
ArtUp Labs acts as a processor, processing only to provide the export, on Atlassian's
infrastructure and in the user's browser. Since the app neither stores nor transmits data, the
processing is transient. DPA on request: standard Bonterms DPA (as recorded for Trace in `STATE.md`).

## 8. Runs on Atlassian

Eligible: Forge-only, no egress, no Connect modules, bundled resources. Claim the badge only after
the production eligibility check (§3).

## 9. Contacts

Same as Trace (`../listing/privacy-security-tab.md` §8): hello@artuplabs.com (support, privacy),
security@artuplabs.com (vulnerabilities, acknowledged within 24 hours), ArtUp Labs — trade name of
Artyom Karpets, individual entrepreneur, Republic of Kazakhstan.

## Before submitting

- `site/privacy.html` §5 and `site/security.html` §1.1, §2 carry these facts for ArtUp Export
  (added 2026-09-29); deploy the site before submitting the listing.
