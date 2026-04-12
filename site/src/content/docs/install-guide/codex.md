# Codex

Treat this **Git repository** as the **source of truth** for markdown: plugin root **`commands/`**, **`phases/`**, **`agents/`** (including **`agents/plugin-runtime/`**), **`templates/`**, **`references/`**, and **`state-machine.json`**.

## Prerequisites

- A **checkout** of **agentic-swe** (clone or submodule)
- A **target git repository** where you want pipeline artifacts

## Quick setup

1. Copy **`AGENTS.md`** from the pack into your **target repo root** (or merge with an existing **`AGENTS.md`**).

2. Merge **`CLAUDE.md`** into the target repo using the delimiter rules in **`commands/install.md`** (same idea as Claude Code **`/install`**).

3. Make pack markdown visible to Codex — pick one:
   - **Symlink** the directories you need from the checkout into the target repo (keep paths consistent with **`AGENTS.md`**), or
   - **Open both** the pack checkout and the target repo in one workspace if your tooling resolves cross-folder reads.

4. Use **`.worklogs/<id>/`** in the **target repo root** for per-work state (not **`.claude/.work/`**).

5. Optional: enable **multi-agent** mode in Codex if your environment supports it (some flows use delegation).

## Symlink example (local dev)

Adjust paths to match your machine:

```bash
PACK=/path/to/agentic-swe
TARGET=/path/to/your-repo
cp "$PACK/AGENTS.md" "$TARGET/"
# Merge CLAUDE.md manually or follow commands/install.md in the pack
mkdir -p "$TARGET/.agentic-swe"
for d in commands phases agents templates references tools; do
  ln -sf "$PACK/$d" "$TARGET/.agentic-swe/$d"
done
ln -sf "$PACK/state-machine.json" "$TARGET/.agentic-swe/state-machine.json"
```

Point **`AGENTS.md`** (or Codex config) at those paths so **`/work`** and phase files resolve.

## Usage

Start or resume with **`/work <task description>`** (or open the matching file under **`commands/`** if your host maps commands that way). The pipeline uses **feasibility → … → validation → PR** with **human gates** at ambiguity and approval.

### Common commands

| Command | Purpose |
|---------|---------|
| **`/work`** | Start or resume a work item |
| **`/check budget`** | Before phases |
| **`/check transition`** | Before **`state.json`** changes |
| **`/check artifacts`** | Required files for the next state |
| **`/plan-only`** | Feasibility + design without implementation |
| **`/repo-scan`** | Structured codebase snapshot |
| **`/test-runner`** / **`/lint`** | Validation helpers |

## Tool mapping (conceptual)

| Pack concept | Typical Codex equivalent |
|--------------|-------------------------|
| Agent / subagent spawn | Multi-agent / dispatch (if enabled) |
| Shell / bash | Codex shell execution |
| Read / write / edit | File tools |
| Tasks / todos | Task tracking (if available) |

## Pipeline state

Under **`.worklogs/<id>/`**: **`state.json`**, **`progress.md`**, **`audit.log`**, plus phase artifacts per **`CLAUDE.md`**.

## Related in-site docs

- **[Codex quick reference](../README.codex.md)** (home tile).
- **[Usage](../usage.md)** · **[Multi-platform support](../multi-platform-support.md)** · **[Troubleshooting](../troubleshooting.md)**
