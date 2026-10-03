#!/usr/bin/env bash
# Однократная настройка AR XR на Pages-проекте artuplabs: бакет R2, привязка ARXR и секрет ARXR_ADMIN_TOKEN.
# Идемпотентно: существующий бакет не пересоздаётся, привязка и секрет перезаписываются.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?нужен токен: Pages Edit + Workers R2 Storage Edit}"
: "${ARXR_ADMIN_TOKEN:?нужен ARXR_ADMIN_TOKEN}"
ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-f29eee344264b6bfda92414789aed0a8}"
BUCKET="${ARXR_BUCKET:-artuplabs-ar-xr}"
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

ok() { python3 -c 'import sys,json;d=json.load(sys.stdin);print("ok" if d.get("success") else d.get("errors"))'; }

echo "R2 bucket $BUCKET:"
if curl -fsS "${AUTH[@]}" "$API/r2/buckets/$BUCKET" >/dev/null 2>&1; then echo exists
else curl -sS "${AUTH[@]}" -X POST "$API/r2/buckets" -d "{\"name\":\"$BUCKET\"}" | ok; fi

echo "Pages bindings:"
BODY=$(python3 - "$BUCKET" "$ARXR_ADMIN_TOKEN" <<'PY'
import json,sys
b,t=sys.argv[1],sys.argv[2]
cfg={"r2_buckets":{"ARXR":{"name":b}},"env_vars":{"ARXR_ADMIN_TOKEN":{"type":"secret_text","value":t}}}
print(json.dumps({"deployment_configs":{"production":cfg,"preview":cfg}}))
PY
)
curl -sS "${AUTH[@]}" -X PATCH "$API/pages/projects/artuplabs" -d "$BODY" | ok
