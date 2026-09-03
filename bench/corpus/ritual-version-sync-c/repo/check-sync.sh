#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
CANON=$(jq -r '.version' "$ROOT/package.json")
for f in .claude-plugin/plugin.json .cursor-plugin/plugin.json gemini-extension.json; do
  v=$(jq -r '.version' "$ROOT/$f")
  if [ "$v" != "$CANON" ]; then exit 1; fi
done
mpv=$(jq -r '.plugins[0].version' "$ROOT/.claude-plugin/marketplace.json" 2>/dev/null || echo "")
if [ -n "$mpv" ] && [ "$mpv" != "$CANON" ]; then exit 1; fi
exit 0
