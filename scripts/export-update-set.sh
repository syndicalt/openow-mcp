#!/usr/bin/env bash
# Export the built sn_headless update set to a ServiceNow instance via the
# classic xmlimport.do endpoint (System Update Sets -> Load XML).
#
# Usage:
#   SNOW_INSTANCE=https://dev123456.service-now.com \
#   SNOW_USER=admin SNOW_PASSWORD=... \
#   bash scripts/export-update-set.sh
set -euo pipefail

if [ ! -f "dist/sn_headless/update-set.xml" ]; then
  echo "dist/sn_headless/update-set.xml not found — run \`bun run build:app\` first" >&2
  exit 1
fi

: "${SNOW_INSTANCE:?SNOW_INSTANCE is required (e.g. https://dev123456.service-now.com)}"
: "${SNOW_USER:?SNOW_USER is required}"
: "${SNOW_PASSWORD:?SNOW_PASSWORD is required}"

curl -sS -u "$SNOW_USER:$SNOW_PASSWORD" \
  -F "file=@dist/sn_headless/update-set.xml" \
  "${SNOW_INSTANCE%/}/xmlimport.do?sysparm_import_set_url=false"

echo "done"
