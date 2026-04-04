#!/usr/bin/env bash
set -euo pipefail

# Deprecated in v3 — the npm CLI and this shell installer are retired.
# Use the Claude Code plugin (marketplace + /plugin install) and /install in the target repo.
# See README.md and commands/install.md.

echo "install.sh is deprecated (agentic-swe v3+)." >&2
echo "Install the Claude Code plugin instead; run /install in your project for CLAUDE.md + .worklogs/." >&2
echo "Docs: https://github.com/surajSFDC/agentic-swe#quick-start" >&2
exit 1
