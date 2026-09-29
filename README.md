# ArtUp Labs Forge apps

This repository holds the two Atlassian Forge apps published by ArtUp Labs.

| App | Folder | Product | Details |
| --- | --- | --- | --- |
| ArtUp Trace | [`apps/trace`](apps/trace) | Jira | [`apps/trace/README.md`](apps/trace/README.md) |
| ArtUp Export | [`apps/export`](apps/export) | Confluence | [`apps/export/README.md`](apps/export/README.md) |

## Layout

```
apps/trace/     ArtUp Trace: manifest.yml, src/ (resolvers), static/app/ (Custom UI), test/, scripts/
apps/export/    ArtUp Export: same shape, plus locales/
.github/        CI and Dependabot for both apps
```

Each app is self-contained: its own `package.json`, lockfiles, `manifest.yml` and Forge app id.
There is no root `package.json`; every command runs from the app folder.

## Test and build

```bash
cd apps/<app>
npm ci
npm ci --prefix static/app
npm run lint
npm test
npm run test:ui
npm run build:ui
```

CI (`.github/workflows/ci.yml`) runs these steps plus `npm audit --omit=dev --audit-level=high`
for both apps in one job named `test`, on every pull request and on pushes to `main`.

## Deploy

Forge CLI commands run from the app folder, because that is where `manifest.yml` lives:

```bash
cd apps/<app>
npm run build:ui
forge lint
forge deploy -e development --non-interactive
```

## Releases

Tags carry the app name: `trace-vX.Y.Z` for ArtUp Trace, `export-vX.Y.Z` for ArtUp Export.
