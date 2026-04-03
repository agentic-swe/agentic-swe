#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
PASS=0
FAIL=0

if ! command -v claude &>/dev/null; then
  echo "ERROR: 'claude' CLI not found. Install Claude Code first."
  exit 1
fi

run_prompt() {
  local prompt_file="$1"
  local name
  name="$(basename "$prompt_file" .txt)"
  local prompt
  prompt="$(cat "$prompt_file")"

  echo "--- Running: $name ---"
  local output
  output="$(claude -p "$prompt" --output-format stream-json 2>&1 || true)"

  case "$name" in
    fast-path-bug-fix)
      if echo "$output" | grep -q "fast-path-implementation"; then
        echo "  PASS: fast-path-implementation phase detected"
        PASS=$((PASS + 1))
      else
        echo "  FAIL: expected fast-path-implementation phase"
        FAIL=$((FAIL + 1))
      fi
      ;;
    full-path-new-feature)
      local ok=true
      for phase in design test-strategy implementation; do
        if echo "$output" | grep -q "$phase"; then
          echo "  PASS: $phase phase detected"
        else
          echo "  FAIL: expected $phase phase"
          ok=false
        fi
      done
      if $ok; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
      ;;
    *)
      echo "  SKIP: no assertions defined for $name"
      ;;
  esac
  echo ""
}

for prompt_file in "$PROMPTS_DIR"/*.txt; do
  run_prompt "$prompt_file"
done

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
