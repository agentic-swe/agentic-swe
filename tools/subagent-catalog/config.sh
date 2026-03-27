#!/usr/bin/env bash
# subagent-catalog configuration
# Works with local agents/subagents/ directory

set -euo pipefail

# --- CONFIG ---
# Resolve the pipeline root (source repo = repo root, target repo = .claude/)
_resolve_subagent_dir() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # Walk up to find the pipeline root
  local candidate="$script_dir"
  while [ "$candidate" != "/" ]; do
    if [ -d "$candidate/agents/subagents" ]; then
      echo "$candidate/agents/subagents"
      return 0
    fi
    candidate="$(dirname "$candidate")"
  done

  # Fallback: check .claude/ in git root
  local git_root
  git_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
  if [ -n "$git_root" ] && [ -d "$git_root/.claude/agents/subagents" ]; then
    echo "$git_root/.claude/agents/subagents"
    return 0
  fi

  echo ""
  return 1
}

readonly SUBAGENT_DIR="$(_resolve_subagent_dir)"
export SUBAGENT_DIR

# --- HELPERS ---

subagent_catalog_log_info() { echo "$1"; }
subagent_catalog_log_error() { echo "ERROR: $1" >&2; }

# List all categories (directory names under subagents/)
subagent_catalog_list_categories() {
  if [ -z "$SUBAGENT_DIR" ] || [ ! -d "$SUBAGENT_DIR" ]; then
    subagent_catalog_log_error "subagent directory not found"
    return 1
  fi
  ls -1d "$SUBAGENT_DIR"/*/ 2>/dev/null | xargs -I{} basename {} | sort
}

# List all agent files in a category
subagent_catalog_list_agents_in() {
  local category="$1"
  if [ -d "$SUBAGENT_DIR/$category" ]; then
    ls -1 "$SUBAGENT_DIR/$category"/*.md 2>/dev/null | xargs -I{} basename {} .md | sort
  fi
}

# Find agent file by name (returns full path)
subagent_catalog_find() {
  local name="$1"
  local result
  result=$(find "$SUBAGENT_DIR" -name "${name}.md" -type f 2>/dev/null | head -1)
  if [ -n "$result" ]; then
    echo "$result"
    return 0
  fi
  # Try partial match
  result=$(find "$SUBAGENT_DIR" -name "*${name}*.md" -type f 2>/dev/null)
  echo "$result"
}

# Search agents by keyword in name or frontmatter description
subagent_catalog_search() {
  local query="$1"
  find "$SUBAGENT_DIR" -name "*.md" -type f 2>/dev/null | while read -r f; do
    if grep -qil "$query" "$f" 2>/dev/null; then
      local category
      category=$(basename "$(dirname "$f")")
      local agent
      agent=$(basename "$f" .md)
      local desc
      desc=$(grep -m1 '^description:' "$f" 2>/dev/null | sed 's/^description: *"*//;s/"*$//' || echo "")
      echo "$category/$agent|$desc"
    fi
  done
}
