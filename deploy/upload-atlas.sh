#!/usr/bin/env bash
# Upload the generated atlas (public/atlas) to Cloudflare R2 with rclone.
#
#   R2_BUCKET=<bucket> ./deploy/upload-atlas.sh [extra rclone flags, e.g. --dry-run]
#
# Environment:
#   R2_BUCKET      name of the R2 bucket (required)
#   RCLONE_REMOTE  name of the rclone remote that points at R2 (default: r2)
#   ATLAS_PREFIX   key prefix inside the bucket (default: atlas/v1)
#
# Credentials stay in the rclone remote (rclone.conf or RCLONE_CONFIG_* variables),
# never in this repo. See deploy/README.md.
set -euo pipefail

: "${R2_BUCKET:?Set R2_BUCKET to the name of the R2 bucket}"
REMOTE="${RCLONE_REMOTE:-r2}"
PREFIX="${ATLAS_PREFIX:-atlas/v1}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/public/atlas"
DEST="$REMOTE:$R2_BUCKET/$PREFIX"

if ! command -v rclone >/dev/null; then
  echo "rclone is not installed, see https://rclone.org/install/" >&2
  exit 1
fi
if [ ! -f "$SRC/meta.json" ]; then
  echo "No atlas at $SRC, build it with pipeline/build_atlas.py first" >&2
  exit 1
fi

echo "Uploading $SRC -> $DEST"
# Objects are served as immutable for a year, so never overwrite a published
# prefix with different content: upload a rebuilt atlas under a new ATLAS_PREFIX.
# --checksum compares by MD5 from the bucket listing, which makes re-runs cheap.
# --s3-no-check-bucket is needed for API tokens scoped to a single bucket.
rclone copy "$SRC" "$DEST" \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --exclude ".DS_Store" \
  --checksum \
  --transfers 32 \
  --checkers 32 \
  --s3-no-check-bucket \
  --progress \
  "$@"
