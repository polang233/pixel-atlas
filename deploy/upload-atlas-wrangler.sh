#!/usr/bin/env bash
# Upload the streaming atlas to R2 with Wrangler (no S3 API token needed;
# uses the account you are logged in to with `npx wrangler login`).
#
#   R2_BUCKET=pixel-atlas ./deploy/upload-atlas-wrangler.sh
#
# Optional: ATLAS_PREFIX (default atlas/v1), ATLAS_DIR (default public/atlas),
# JOBS (parallel uploads, default 8). Re-running overwrites existing objects.
set -euo pipefail
: "${R2_BUCKET:?set R2_BUCKET}"
PREFIX="${ATLAS_PREFIX:-atlas/v1}"
SRC="${ATLAS_DIR:-public/atlas}"
JOBS="${JOBS:-8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRANGLER="$ROOT/node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || { echo "run npm install first" >&2; exit 1; }
cd "$ROOT/$SRC"
export R2_BUCKET PREFIX WRANGLER
find . -type f ! -name '.*' | sed 's#^\./##' | sort | xargs -P "$JOBS" -I{} sh -c '
  f="$1"
  case "$f" in
    *.webp) t=image/webp ;;
    *.png) t=image/png ;;
    *.json) t=application/json ;;
    *) t=application/octet-stream ;;
  esac
  for try in 1 2 3; do
    if "$WRANGLER" r2 object put "$R2_BUCKET/$PREFIX/$f" --file "$f" --remote \
        --content-type "$t" --cache-control "public, max-age=31536000, immutable" >/dev/null 2>&1; then
      echo "ok $f"; exit 0
    fi
    sleep $try
  done
  echo "FAILED $f" >&2; exit 1
' _ {}
