#!/usr/bin/env bash
# One-step install for Cursor: clone or symlink agentic-swe into ~/.cursor/plugins/local/
# so Cursor loads commands, agents, and hooks after a window reload.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
# Or from a checkout:
#   bash scripts/install-cursor-plugin.sh
#
# Optional — same shell:
#   AGENTIC_SWE_TARGET_REPO=/path/to/your-app  — run scripts/merge-claude-policy.js after install (needs node)
#   AGENTIC_SWE_AUTO_GITIGNORE=1              — with TARGET_REPO, append .worklogs/ to .gitignore if missing
#
# Other overrides:
#   AGENTIC_SWE_PACK_ROOT=/path/to/agentic-swe  — symlink this checkout instead of cloning
#   AGENTIC_SWE_REPO_URL=…  AGENTIC_SWE_REF=main  — clone source and branch/ref
#   CURSOR_LOCAL_PLUGINS_DIR=~/.cursor/plugins/local  — target parent directory
set -euo pipefail

LOCAL_ROOT="${CURSOR_LOCAL_PLUGINS_DIR:-$HOME/.cursor/plugins/local}"
DEST="${LOCAL_ROOT}/agentic-swe"

if [[ -n "${AGENTIC_SWE_PACK_ROOT:-}" ]]; then
  SRC="$(cd "$AGENTIC_SWE_PACK_ROOT" && pwd)"
  if [[ ! -f "$SRC/.cursor-plugin/plugin.json" ]]; then
    echo "error: AGENTIC_SWE_PACK_ROOT must point to an agentic-swe checkout (missing .cursor-plugin/plugin.json)" >&2
    exit 1
  fi
  mkdir -p "$LOCAL_ROOT"
  ln -sfn "$SRC" "$DEST"
  echo "Symlinked: $DEST -> $SRC"
else
  REPO_URL="${AGENTIC_SWE_REPO_URL:-https://github.com/agentic-swe/agentic-swe.git}"
  REF="${AGENTIC_SWE_REF:-main}"
  mkdir -p "$LOCAL_ROOT"
  if [[ -d "$DEST/.git" ]]; then
    echo "Updating existing clone: $DEST"
    git -C "$DEST" fetch --depth 1 origin "$REF"
    git -C "$DEST" reset --hard "origin/$REF"
  elif [[ -e "$DEST" ]]; then
    echo "error: $DEST exists and is not a git clone. Remove it, or set AGENTIC_SWE_PACK_ROOT to symlink a checkout." >&2
    exit 1
  else
    git clone --depth 1 --branch "$REF" "$REPO_URL" "$DEST"
  fi
  echo "Installed pack at: $DEST"
fi

PACK="$(cd "$DEST" && pwd)"
MERGE_JS="$PACK/scripts/merge-claude-policy.js"

if [[ -n "${AGENTIC_SWE_TARGET_REPO:-}" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "error: node is required to merge CLAUDE.md (AGENTIC_SWE_TARGET_REPO is set)" >&2
    exit 1
  fi
  if [[ ! -f "$MERGE_JS" ]]; then
    echo "error: merge script missing: $MERGE_JS" >&2
    exit 1
  fi
  TGT="$(cd "$AGENTIC_SWE_TARGET_REPO" && pwd)"
  GI_ARGS=()
  if [[ -n "${AGENTIC_SWE_AUTO_GITIGNORE:-}" ]]; then
    GI_ARGS=(--gitignore)
  fi
  node "$MERGE_JS" --pack "$PACK" --target "$TGT" "${GI_ARGS[@]}"
  echo "Merged Hypervisor policy into $TGT/CLAUDE.md"
fi

echo "Next: restart Cursor or run “Developer: Reload Window”."
if [[ -z "${AGENTIC_SWE_TARGET_REPO:-}" ]]; then
  echo "Optional: AGENTIC_SWE_TARGET_REPO=/path/to/your-app on the same command auto-merges CLAUDE.md (requires node). Add AGENTIC_SWE_AUTO_GITIGNORE=1 to append .worklogs/ to .gitignore."
fi
echo "Docs: https://agentic-swe.github.io/agentic-swe-site/docs/cursor-plugin"
