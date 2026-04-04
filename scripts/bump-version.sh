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

CANONICAL_VERSION=$(jq -r '.version' "$REPO_ROOT/package.json")

apply_version_jq() {
  local full_path="$1"
  local new_version="$2"
  local sel="$3"
  local tmp
  tmp=$(mktemp)
  if [ "$sel" = ".version" ]; then
    jq --arg v "$new_version" '.version = $v' "$full_path" >"$tmp"
  elif [ "$sel" = ".plugins[0].version" ]; then
    jq --arg v "$new_version" '.plugins[0].version = $v' "$full_path" >"$tmp"
  else
    echo "ERROR: unsupported versionSelector: $sel (extend scripts/bump-version.sh)" >&2
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$full_path"
}

read_version() {
  local full_path="$1"
  local sel="$2"
  jq -r "$sel" "$full_path"
}

cmd_check() {
  echo "Canonical version (package.json): $CANONICAL_VERSION"
  echo ""
  local drift=0
  local n
  n=$(jq '.files | length' "$CONFIG")
  local i
  for ((i = 0; i < n; i++)); do
    local file sel
    file=$(jq -r ".files[$i].path" "$CONFIG")
    sel=$(jq -r '.files['"$i"'].versionSelector // ".version"' "$CONFIG")
    local full_path="$REPO_ROOT/$file"
    if [ ! -f "$full_path" ]; then
      echo "  MISSING: $file"
      drift=1
      continue
    fi
    local ver
    ver=$(read_version "$full_path" "$sel")
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
  local n
  n=$(jq '.files | length' "$CONFIG")
  local i
  for ((i = 0; i < n; i++)); do
    local file sel
    file=$(jq -r ".files[$i].path" "$CONFIG")
    sel=$(jq -r '.files['"$i"'].versionSelector // ".version"' "$CONFIG")
    local full_path="$REPO_ROOT/$file"
    if [ ! -f "$full_path" ]; then
      echo "  SKIP: $file (not found)"
      continue
    fi
    apply_version_jq "$full_path" "$new_version" "$sel"
    echo "  DONE: $file -> $new_version"
  done
  echo ""
  echo "All manifests updated. Verify with: $0 check"
}

case "${1:-check}" in
check) cmd_check ;;
bump) cmd_bump "${2:-}" ;;
*)
  echo "Usage: $0 {check|bump <version>}" >&2
  exit 1
  ;;
esac
