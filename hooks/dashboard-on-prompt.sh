#!/usr/bin/env bash
# UserPromptSubmit (async): when the user submits /swe-dashboard, ensure the local
# dashboard HTTP server is running (idempotent). Claude Code only.
set -euo pipefail

INPUT=$(cat || true)
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null || echo "")
PROMPT_TRIMMED="${PROMPT#"${PROMPT%%[![:space:]]*}"}"

if [[ ! "$PROMPT_TRIMMED" =~ ^/[Ss]we-dashboard($|[[:space:]]) ]]; then
  exit 0
fi

ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$ROOT" ]] || [[ ! -d "$ROOT" ]]; then
  exit 0
fi

PORT="${SWE_DASHBOARD_PORT:-47822}"
if (echo >/dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1; then
  exit 0
fi

# Start from the user's project cwd when the hook provides it (Claude Code JSON).
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")
if [[ -z "$CWD" ]]; then
  CWD="$(pwd)"
fi

nohup env AGENTIC_SWE_DASHBOARD_CWD="$CWD" node "$ROOT/scripts/swe-dashboard-server.cjs" --no-open >/dev/null 2>&1 &
exit 0
