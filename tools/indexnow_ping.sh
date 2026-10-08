#!/usr/bin/env bash
# Tell IndexNow (Bing, Yandex, Seznam, Naver …) about the new artuplabs.com pages.
# Run ONLY after the site is deployed and the key file answers 200:
#   curl -s https://artuplabs.com/31b505ae9ee9a3577f6a85e55411d778.txt
# Usage: tools/indexnow_ping.sh            # POST the URL list below
#        tools/indexnow_ping.sh --dry-run  # print the JSON body, send nothing
# The key is public by design (it sits in site/<key>.txt); it is not a secret.
set -euo pipefail

HOST="artuplabs.com"
KEY="31b505ae9ee9a3577f6a85e55411d778"
URLS=(
  "https://artuplabs.com/tools/photo-to-3d/"
  "https://artuplabs.com/guides/"
  "https://artuplabs.com/guides/how-to-add-3d-models-and-ar-to-shopify/"
  "https://artuplabs.com/guides/photo-to-3d-furniture-what-works/"
  "https://artuplabs.com/guides/ar-for-furniture-stores-shopify-cost/"
  "https://artuplabs.com/guides/photo-to-3d-vs-3d-artist-vs-scan-apps/"
  "https://artuplabs.com/guides/shopify-3d-ar-apps-compared/"
  "https://artuplabs.com/guides/free-3d-preview-from-a-photo/"
  "https://artuplabs.com/guides/shopify-theme-compatibility/"
  "https://artuplabs.com/shopify/"
  "https://artuplabs.com/"
)

list=""
for u in "${URLS[@]}"; do list+="${list:+,}\"$u\""; done
body="{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":[$list]}"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "$body"
  exit 0
fi

code=$(curl -sS -o /dev/stderr -w '%{http_code}' -X POST "https://api.indexnow.org/indexnow" \
  -H 'Content-Type: application/json; charset=utf-8' --data "$body")
echo
echo "IndexNow HTTP $code (200/202 = accepted; 403 = key file not reachable; 422 = URL not on this host)"
[[ "$code" == "200" || "$code" == "202" ]]
