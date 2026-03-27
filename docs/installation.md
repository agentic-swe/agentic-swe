# Installation Guide

## Prerequisites

- **Claude Code** CLI, desktop app, or IDE extension ([install guide](https://docs.anthropic.com/en/docs/claude-code))
- **Git** installed and configured
- **GitHub CLI** (`gh`) installed and authenticated (for PR creation)
- A git repository where you want to use the pipeline

---

## Quick Install (Recommended)

The fastest way to get started. One shell command installs everything into your project.

**Step 1: Clone agentic-swe**

```bash
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe
```

**Step 2: Run the install script**

```bash
/tmp/agentic-swe/install.sh /path/to/your/project
```

This automatically:
- Creates the `.claude/` directory structure
- Copies all pipeline files (phases, commands, agents, templates, references)
- Copies all 135+ subagents into `.claude/agents/subagents/`
- Copies the subagent catalog tool into `.claude/tools/`
- Sets up `CLAUDE.md` (creates or appends to existing)
- Adds `.claude/.work/` to `.gitignore`

**Step 3: Open Claude Code in your project**

```bash
cd /path/to/your/project
claude
```

**Step 4: Start working**

```
/work Add retry logic to the API client
```

Done. All slash commands (`/work`, `/subagent`, `/check`, etc.) are now available.

---

## Alternative: Install from Inside Claude Code

If you prefer using the `/install` slash command from within Claude Code, you must launch Claude Code **from inside the agentic-swe repo** (not your target project):

```bash
git clone https://github.com/surajSFDC/agentic-swe.git
cd agentic-swe
claude
```

Then run `/install` inside Claude Code. This works because the slash commands are registered in `.claude/commands/` within the agentic-swe repo.

> **Why can't I run `/install` from my own project?** Claude Code discovers slash commands from `.claude/commands/` in the current project. Before installation, your project doesn't have `.claude/commands/install.md` yet — so the command doesn't exist. The shell script (`install.sh`) avoids this chicken-and-egg problem.

---

## Manual Install

If you prefer to set things up yourself:

**Step 1: Clone the repository**

```bash
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe
```

**Step 2: Copy `.claude/` into your project**

```bash
cd /path/to/your/project
cp -r /tmp/agentic-swe/.claude .claude
```

This copies everything — commands, phases, agents (including 135 subagents), templates, references, and tools.

**Step 3: Create runtime state directory**

```bash
mkdir -p .claude/.work
touch .claude/.work/.gitkeep
```

**Step 4: Set up CLAUDE.md**

If your repo has **no existing `CLAUDE.md`**:

```bash
cp /tmp/agentic-swe/CLAUDE.md CLAUDE.md
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
ls .claude/commands/work.md .claude/phases/feasibility.md .claude/agents/developer.md
find .claude/agents/subagents -name "*.md" | wc -l
# Expected: 135
```

---

## Selective Install (Subagents Only)

If you already have your own Claude Code setup and only want the specialized subagents:

```bash
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe

# Copy just the subagents
cp -r /tmp/agentic-swe/.claude/agents/subagents/ .claude/agents/subagents/

# Copy the catalog tool (optional but recommended)
cp -r /tmp/agentic-swe/.claude/tools/subagent-catalog/ .claude/tools/subagent-catalog/

# Copy the subagent command (optional)
cp /tmp/agentic-swe/.claude/commands/subagent.md .claude/commands/
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
