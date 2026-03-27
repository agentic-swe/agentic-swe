# Installation Guide

## Prerequisites

- **Claude Code** CLI, desktop app, or IDE extension ([install guide](https://docs.anthropic.com/en/docs/claude-code))
- **Git** installed and configured
- **GitHub CLI** (`gh`) installed and authenticated (for PR creation)
- A git repository where you want to use the pipeline

---

## Quick Install (Recommended)

The fastest way to get started. Clone this repo, open Claude Code in your target project, and run the install command.

**Step 1: Clone agentic-swe**

```bash
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe
```

**Step 2: Open Claude Code in your project**

```bash
cd /path/to/your/project
claude
```

**Step 3: Run the install command**

```
/install
```

This automatically:
- Creates the `.claude/` directory structure
- Copies all pipeline files (phases, commands, agents, templates, references)
- Copies all 135+ subagents into `.claude/agents/subagents/`
- Copies the subagent catalog tool into `.claude/tools/`
- Handles existing `CLAUDE.md` files (appends, doesn't overwrite)
- Creates `.claude/.work/` for runtime state

Done. You can now use `/work`, `/subagent`, and all other commands.

---

## Manual Install

If you prefer to set things up yourself:

**Step 1: Clone the repository**

```bash
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe
```

**Step 2: Create the directory structure in your project**

```bash
cd /path/to/your/project

# Core directories
mkdir -p .claude/.work
mkdir -p .claude/commands
mkdir -p .claude/phases
mkdir -p .claude/agents/panel
mkdir -p .claude/templates
mkdir -p .claude/references
mkdir -p .claude/tools/subagent-catalog

# Subagent category directories
for i in 01-core-development 02-language-specialists 03-infrastructure \
         04-quality-security 05-data-ai 06-developer-experience \
         07-specialized-domains 08-business-product 09-meta-orchestration \
         10-research-analysis; do
  mkdir -p ".claude/agents/subagents/$i"
done
```

**Step 3: Copy all pipeline files**

```bash
# Core pipeline
cp /tmp/agentic-swe/commands/*.md       .claude/commands/
cp /tmp/agentic-swe/phases/*.md         .claude/phases/
cp /tmp/agentic-swe/agents/*.md         .claude/agents/
cp /tmp/agentic-swe/agents/panel/*.md   .claude/agents/panel/
cp /tmp/agentic-swe/templates/*         .claude/templates/
cp /tmp/agentic-swe/references/*.md     .claude/references/

# Subagent catalog tool
cp /tmp/agentic-swe/tools/subagent-catalog/* .claude/tools/subagent-catalog/

# All 135+ specialized subagents
for dir in /tmp/agentic-swe/agents/subagents/*/; do
  category=$(basename "$dir")
  cp "$dir"*.md ".claude/agents/subagents/$category/" 2>/dev/null
done

# Runtime state placeholder
touch .claude/.work/.gitkeep
```

**Step 4: Set up CLAUDE.md**

If your repo has **no existing `CLAUDE.md`**:

```bash
cp /tmp/agentic-swe/CLAUDE.md .claude/CLAUDE.md
```

If your repo **already has a `CLAUDE.md`** (append to preserve your existing instructions):

```bash
echo -e "\n---\n\n<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->" >> CLAUDE.md
cat /tmp/agentic-swe/CLAUDE.md >> CLAUDE.md
```

**Step 5: Add `.work/` to `.gitignore`**

```bash
echo ".claude/.work/" >> .gitignore
```

**Step 6: Verify installation**

```bash
# Check core files exist
ls .claude/commands/work.md .claude/phases/feasibility.md .claude/agents/developer.md

# Check subagents are installed
find .claude/agents/subagents -name "*.md" | wc -l
# Expected: 135
```

---

## Selective Install (Subagents Only)

If you already have your own Claude Code setup and only want the specialized subagents:

```bash
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe

# Copy just the subagents
cp -r /tmp/agentic-swe/agents/subagents/ .claude/agents/subagents/

# Copy the catalog tool (optional but recommended)
cp -r /tmp/agentic-swe/tools/subagent-catalog/ .claude/tools/subagent-catalog/

# Copy the subagent command (optional)
cp /tmp/agentic-swe/commands/subagent.md .claude/commands/
```

You can now invoke any subagent directly in Claude Code:

```
Use the python-pro subagent to refactor this module with proper type hints
```

---

## Uninstalling

To remove the pipeline from a target repo:

```bash
rm -rf .claude/commands .claude/phases .claude/agents .claude/templates .claude/references .claude/tools .claude/.work
```

If the pipeline policy was appended to your `CLAUDE.md`, remove everything after the `<!-- BEGIN autonomous-swe-pipeline policy` delimiter.
