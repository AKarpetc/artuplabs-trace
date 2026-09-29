# ArtUp Labs — Security Incident Response Plan

Applies to: ArtUp Trace for Jira Cloud and every other ArtUp Labs Marketplace app.
Owner and security contact: Artyom Karpets, security@artuplabs.com.
Last reviewed: 2026-09-25. Reviewed at least once a year and after every incident.

## 1. What counts as an incident

- Unauthorised access to customer data held by an app (Forge SQL, Forge storage).
- A vulnerability in an app that exposes customer data or lets a user act beyond their Jira permissions.
- Compromise of a developer account, workstation, source repository or deployment credentials (Atlassian account, Forge token, GitHub, domain/DNS, email).
- A report from Atlassian (AMS ticket, bug bounty) or from a customer about any of the above.

## 2. Detection and reporting channels

- security@artuplabs.com and hello@artuplabs.com (checked daily on business days).
- Atlassian Marketplace Security (AMS) Jira tickets on ecosystem.atlassian.net.
- Forge developer console: app logs, invocation errors, alerts.
- Dependency alerts (npm audit, Dependabot).

## 3. Response steps

| Step | Target time | Action |
|---|---|---|
| Acknowledge | 24 hours | Confirm receipt to the reporter; open an internal incident record (date, source, affected apps, versions). |
| Triage | 24 hours | Rate severity (Critical / High / Medium / Low, CVSS where possible); decide if customer data is affected. |
| Notify Atlassian | within 24 hours of becoming aware of an incident affecting customers | Raise a P1 incident ticket with Atlassian Marketplace Security; keep it updated until closed. |
| Contain | as soon as possible | Rotate compromised credentials (Atlassian API tokens, Forge credentials, GitHub, Cloudflare, email); revoke sessions; if needed deploy a version that disables the affected feature, or ask Atlassian to pause the app. |
| Fix | Within the Marketplace Security Bug Fix Policy due dates for the severity | Patch, test, deploy to production, confirm the fix with the reporter/Atlassian. |
| Notify customers | within 72 hours of identification, when their data is affected | Email the technical and billing contacts of affected installations using Atlassian's app security incident communication template: what happened, what data, what we did, what they should do. |
| Close | after fix is verified | Write a short post-incident review: root cause, timeline, what changes prevent a repeat. |

## 4. Preventive controls

- Full-disk encryption and automatic OS updates on the development workstation.
- Multi-factor authentication on the Atlassian, source control, email, DNS and app-store accounts.
- Unique passwords in a password manager.
- Secrets are kept out of source control and rotated every 90 days and immediately after any suspected exposure.
- Apps run on Atlassian (Forge) with no external egress, least-privilege scopes, and a permission check on every user-facing operation.
- Dependencies are checked for known vulnerabilities before every release.

## 5. Contacts

- ArtUp Labs security contact: security@artuplabs.com
- Atlassian Marketplace Security: P1 ticket via ecosystem.atlassian.net
