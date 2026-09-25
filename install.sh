#!/usr/bin/env bash
set -euo pipefail

REPO="${AGENTIC_SWE_REPO:-agentic-swe/agentic-swe}"
REF="${AGENTIC_SWE_REF:-main}"
INSTALL_DIR="${AGENTIC_SWE_HOME:-$HOME/.local/share/agentic-swe}"
BIN_DIR="${AGENTIC_SWE_BIN_DIR:-$HOME/.local/bin}"
ARCHIVE_URL="${AGENTIC_SWE_ARCHIVE_URL:-https://github.com/${REPO}/archive/${REF}.tar.gz}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Agentic SWE requires Node.js 18 or newer: https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  echo "error: Agentic SWE requires Node.js 18 or newer (found $(node --version))" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  echo "error: curl and tar are required" >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/agentic-swe.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/pack"

echo "Downloading Agentic SWE (${REF})..."
curl -fsSL "$ARCHIVE_URL" | tar -xz --strip-components=1 -C "$TMP/pack"

if [[ ! -f "$TMP/pack/bin/agentic-swe.cjs" ]]; then
  echo "error: downloaded archive is not an Agentic SWE tool release" >&2
  exit 1
fi

echo "Installing runtime dependencies..."
npm install --prefix "$TMP/pack" --omit=dev --ignore-scripts --no-audit --no-fund

mkdir -p "$(dirname "$INSTALL_DIR")" "$BIN_DIR"
BACKUP="${INSTALL_DIR}.previous"
rm -rf "$BACKUP"
if [[ -e "$INSTALL_DIR" ]]; then mv "$INSTALL_DIR" "$BACKUP"; fi
if ! mv "$TMP/pack" "$INSTALL_DIR"; then
  [[ -e "$BACKUP" ]] && mv "$BACKUP" "$INSTALL_DIR"
  exit 1
fi
rm -rf "$BACKUP"

chmod +x "$INSTALL_DIR/bin/agentic-swe.cjs"
ln -sfn "$INSTALL_DIR/bin/agentic-swe.cjs" "$BIN_DIR/agentic-swe"

echo "Installed: $BIN_DIR/agentic-swe"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add this directory to PATH:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi
echo "Next: agentic-swe setup"
