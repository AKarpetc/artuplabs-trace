#!/usr/bin/env bash
# Выкладка artuplabs.com (Cloudflare Pages, проект artuplabs): статический site/ + Pages Functions из functions/.
# Токен и аккаунт: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID в окружении или в файле ENV_FILE.
# Функции (functions/ar-xr/**) обслуживают только /ar-xr/api/* и /ar-xr/library/*; остальное — статика.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${ENV_FILE:-}" ]]; then
  CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$(grep -E '^CLOUDFLARE_DEPLOY_TOKEN=' "$ENV_FILE" | cut -d= -f2-)}"
fi
: "${CLOUDFLARE_API_TOKEN:?нужен CLOUDFLARE_API_TOKEN (права Cloudflare Pages: Edit)}"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-f29eee344264b6bfda92414789aed0a8}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
rsync -a --exclude README.md --exclude .DS_Store site/ "$STAGE/"

npx --yes wrangler@4 pages deploy "$STAGE" --project-name artuplabs --branch main --commit-dirty=true
