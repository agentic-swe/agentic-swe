#!/usr/bin/env bash
set -euo pipefail

# A release sets DEFAULT_REF to its tag and DEFAULT_SHA256 to that tag's .tar.gz checksum together.
DEFAULT_REF="main"
DEFAULT_SHA256=""

REPO="${AGENTIC_SWE_REPO:-agentic-swe/agentic-swe}"
REF="${AGENTIC_SWE_REF:-$DEFAULT_REF}"
INSTALL_DIR="${AGENTIC_SWE_HOME:-$HOME/.local/share/agentic-swe}"
BIN_DIR="${AGENTIC_SWE_BIN_DIR:-$HOME/.local/bin}"
ARCHIVE_URL="${AGENTIC_SWE_ARCHIVE_URL:-https://github.com/${REPO}/archive/${REF}.tar.gz}"
if [[ -n "${AGENTIC_SWE_SHA256:-}" ]]; then
  EXPECTED_SHA256="$AGENTIC_SWE_SHA256"
elif [[ "$REF" == "$DEFAULT_REF" && "$REPO" == "agentic-swe/agentic-swe" && -z "${AGENTIC_SWE_ARCHIVE_URL:-}" ]]; then
  EXPECTED_SHA256="$DEFAULT_SHA256"
else
  EXPECTED_SHA256=""
fi

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

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else return 1
  fi
}

echo "Downloading Agentic SWE (${REF})..."
curl -fsSL -o "$TMP/archive.tar.gz" "$ARCHIVE_URL"

if [[ -n "$EXPECTED_SHA256" ]]; then
  if ! ACTUAL_SHA256="$(sha256_of "$TMP/archive.tar.gz")"; then
    echo "error: sha256sum or shasum is required to verify the download" >&2
    exit 1
  fi
  EXPECTED_LOWER="$(printf '%s' "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]')"
  if [[ "$ACTUAL_SHA256" != "$EXPECTED_LOWER" ]]; then
    echo "error: SHA-256 mismatch for $ARCHIVE_URL" >&2
    echo "  expected $EXPECTED_LOWER" >&2
    echo "  actual   $ACTUAL_SHA256" >&2
    exit 1
  fi
  echo "Verified SHA-256 $ACTUAL_SHA256"
else
  echo "warning: download not verified; set AGENTIC_SWE_SHA256 to the archive's SHA-256 to check it" >&2
fi

tar -xzf "$TMP/archive.tar.gz" --strip-components=1 -C "$TMP/pack"

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
