#!/usr/bin/env bash
# Stop brainstorm server on BRAINSTORM_PORT (default 47821).
set -euo pipefail
PORT="${BRAINSTORM_PORT:-47821}"
if command -v lsof >/dev/null 2>&1; then
  lsof -ti ":$PORT" | xargs kill -TERM 2>/dev/null || true
else
  echo "Install lsof or kill the node process listening on port $PORT manually."
fi
