#!/usr/bin/env bash
set -euo pipefail

# Agentic SWE — copies .claude/ from this checkout into a target repository.
# For the published package, use: npx agentic-swe /path/to/project

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_CLAUDE="$SCRIPT_DIR/.claude"
TARGET_DIR="${1:-.}"

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo "=== Agentic SWE Pipeline Installer ==="
echo ""
echo "Source:  $SOURCE_CLAUDE"
echo "Target:  $TARGET_DIR/.claude/"
echo ""

# Verify source
if [ ! -d "$SOURCE_CLAUDE/phases" ] || [ ! -d "$SOURCE_CLAUDE/commands" ]; then
  echo "ERROR: Could not find .claude/phases/ or .claude/commands/ in $SCRIPT_DIR"
  echo "       Run this script from a development checkout of agentic-swe, or use: npx agentic-swe /path/to/your/project"
  exit 1
fi

# Don't install into self
if [ "$TARGET_DIR" = "$SCRIPT_DIR" ]; then
  echo "ERROR: Target is the same as source. Point this at your project directory:"
  echo "       $0 /path/to/your/project"
  exit 1
fi

# Verify target is a git repo
if ! git -C "$TARGET_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "WARNING: $TARGET_DIR is not a git repository."
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Create target .claude/ and copy everything
echo "Copying pipeline files..."
mkdir -p "$TARGET_DIR/.claude"

# Copy all subdirectories (commands, phases, agents, templates, references, tools)
for dir in commands phases agents templates references tools; do
  if [ -d "$SOURCE_CLAUDE/$dir" ]; then
    cp -r "$SOURCE_CLAUDE/$dir" "$TARGET_DIR/.claude/"
  fi
done

# Create runtime state directory
mkdir -p "$TARGET_DIR/.claude/.work"
touch "$TARGET_DIR/.claude/.work/.gitkeep"

# Preserve existing settings.local.json if it exists in target
if [ -f "$TARGET_DIR/.claude/settings.local.json" ]; then
  echo "  Preserving existing settings.local.json"
fi

# Count installed items
agent_count=$(find "$TARGET_DIR/.claude/agents/subagents" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')

# Handle CLAUDE.md
echo "Setting up CLAUDE.md..."
DELIMITER="<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->"

if [ -f "$TARGET_DIR/CLAUDE.md" ]; then
  if grep -q "BEGIN autonomous-swe-pipeline policy" "$TARGET_DIR/CLAUDE.md"; then
    echo "  Updating existing pipeline policy..."
    # Extract content before delimiter, strip trailing blank lines and ---
    sed "/$DELIMITER/,\$d" "$TARGET_DIR/CLAUDE.md" | sed -e :a -e '/^[[:space:]]*$/{ $d; N; ba; }' -e '/^---$/{ $d; N; ba; }' > "$TARGET_DIR/CLAUDE.md.tmp"
    { echo ""; echo "---"; echo ""; echo "$DELIMITER"; echo ""; cat "$SCRIPT_DIR/CLAUDE.md"; } >> "$TARGET_DIR/CLAUDE.md.tmp"
    mv "$TARGET_DIR/CLAUDE.md.tmp" "$TARGET_DIR/CLAUDE.md"
  else
    echo "  Appending pipeline policy to existing CLAUDE.md..."
    { echo ""; echo "---"; echo ""; echo "$DELIMITER"; echo ""; cat "$SCRIPT_DIR/CLAUDE.md"; } >> "$TARGET_DIR/CLAUDE.md"
  fi
else
  echo "  Creating CLAUDE.md..."
  cp "$SCRIPT_DIR/CLAUDE.md" "$TARGET_DIR/CLAUDE.md"
fi

# Add .work/ to .gitignore
if [ -f "$TARGET_DIR/.gitignore" ]; then
  if ! grep -q ".claude/.work/" "$TARGET_DIR/.gitignore"; then
    echo ".claude/.work/" >> "$TARGET_DIR/.gitignore"
    echo "Added .claude/.work/ to .gitignore"
  fi
else
  echo ".claude/.work/" > "$TARGET_DIR/.gitignore"
  echo "Created .gitignore with .claude/.work/"
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "  Commands:   $(ls "$TARGET_DIR/.claude/commands/"*.md 2>/dev/null | wc -l | tr -d ' ') slash commands"
echo "  Phases:     $(ls "$TARGET_DIR/.claude/phases/"*.md 2>/dev/null | wc -l | tr -d ' ') phase prompts"
echo "  Agents:     $(ls "$TARGET_DIR/.claude/agents/"*.md 2>/dev/null | wc -l | tr -d ' ') core + $(ls "$TARGET_DIR/.claude/agents/panel/"*.md 2>/dev/null | wc -l | tr -d ' ') panel"
echo "  Subagents:  $agent_count specialized subagents"
echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR && claude"
echo "  /work <your task description>"
echo ""
