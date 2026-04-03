#!/usr/bin/env bash
# Start brainstorm companion (default port 47821).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [ ! -d node_modules/ws ]; then
  npm install --omit=dev
fi
exec node server.cjs "${1:-}"
