#!/usr/bin/env bash
# Synchronize version strings across all manifests listed in .version-bump.json.
# Usage:
#   ./scripts/bump-version.sh check          # audit for drift
#   ./scripts/bump-version.sh bump <version> # set all files to <version>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$REPO_ROOT/.version-bump.json"

if [ ! -f "$CONFIG" ]; then
  echo "ERROR: .version-bump.json not found at repo root" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install it: brew install jq / apt install jq" >&2
  exit 1
fi

FILES=$(jq -r '.files[].path' "$CONFIG")
CANONICAL_VERSION=$(jq -r '.version' "$REPO_ROOT/package.json")

cmd_check() {
  echo "Canonical version (package.json): $CANONICAL_VERSION"
  echo ""
  local drift=0
  for file in $FILES; do
    local full_path="$REPO_ROOT/$file"
    if [ ! -f "$full_path" ]; then
      echo "  MISSING: $file"
      drift=1
      continue
    fi
    local ver
    ver=$(jq -r '.version' "$full_path")
    if [ "$ver" = "$CANONICAL_VERSION" ]; then
      echo "  OK:      $file ($ver)"
    else
      echo "  DRIFT:   $file ($ver != $CANONICAL_VERSION)"
      drift=1
    fi
  done
  echo ""
  if [ "$drift" -eq 1 ]; then
    echo "Version drift detected. Run: $0 bump $CANONICAL_VERSION"
    exit 1
  else
    echo "All versions in sync."
  fi
}

cmd_bump() {
  local new_version="$1"
  if [ -z "$new_version" ]; then
    echo "Usage: $0 bump <version>" >&2
    exit 1
  fi
  echo "Bumping all manifests to $new_version"
  echo ""
  for file in $FILES; do
    local full_path="$REPO_ROOT/$file"
    if [ ! -f "$full_path" ]; then
      echo "  SKIP: $file (not found)"
      continue
    fi
    local tmp
    tmp=$(mktemp)
    jq --arg v "$new_version" '.version = $v' "$full_path" > "$tmp"
    mv "$tmp" "$full_path"
    echo "  DONE: $file -> $new_version"
  done
  echo ""
  echo "All manifests updated. Verify with: $0 check"
}

case "${1:-check}" in
  check) cmd_check ;;
  bump)  cmd_bump "${2:-}" ;;
  *)
    echo "Usage: $0 {check|bump <version>}" >&2
    exit 1
    ;;
esac
