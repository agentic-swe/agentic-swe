#!/usr/bin/env bash
# Deploy docs/ to S3 and invalidate CloudFront cache.
# Set S3_STATIC_BUCKET and CLOUDFRONT_DISTRIBUTION_ID (e.g. in infra/.env — see infra/.env.example).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/infra/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

BUCKET="${S3_STATIC_BUCKET:-}"
DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
REGION="${AWS_REGION:-us-east-1}"
SITE_URL="${CLOUDFRONT_SITE_URL:-}"

if [[ -z "$BUCKET" || -z "$DIST_ID" ]]; then
  echo "Missing S3_STATIC_BUCKET or CLOUDFRONT_DISTRIBUTION_ID." >&2
  echo "Copy infra/.env.example to infra/.env and set values, or export those variables." >&2
  exit 1
fi

echo "Syncing ${ROOT}/docs/ -> s3://${BUCKET}/"
aws s3 sync "${ROOT}/docs/" "s3://${BUCKET}/" --delete --region "${REGION}"

echo "Creating invalidation for /* on distribution ${DIST_ID}"
aws cloudfront create-invalidation --distribution-id "${DIST_ID}" --paths "/*" --output text

if [[ -n "$SITE_URL" ]]; then
  echo "Done. Site: ${SITE_URL}"
else
  echo "Done. (Set CLOUDFRONT_SITE_URL in infra/.env to print the URL here.)"
fi
