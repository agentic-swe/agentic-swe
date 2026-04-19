# Installing agentic-swe for Codex

The **npm CLI (`npx agentic-swe`) was removed in v3**. Codex users should treat this repository as the **source of truth** for markdown (plugin root: `commands/`, `phases/`, `agents/` including `agents/plugin-runtime/`, `templates/`, `references/`, `state-machine.json`).

## Prerequisites

- A checkout of **agentic-swe** (clone or submodule)
- A **target git repository** where you want the pipeline

## Quick setup

1. Copy **`AGENTS.md`** from this repo into your **target repo root** (or merge its content with an existing `AGENTS.md`).

2. Merge **`CLAUDE.md`** into the target repo using the delimiter rules in **`commands/install.md`** (same as Claude Code **`/install`**).

3. Make pipeline markdown visible to Codex — pick one:
   - **Symlink** the pack directories you need from the checkout into the target repo (layout is up to you; keep paths consistent with what **`AGENTS.md`** describes), or
   - **Open both** the pack checkout and the target repo in the same workspace if your tooling resolves cross-folder reads.

4. Use **`.worklogs/<id>/`** in the **target repo root** for per-work state (not **`.claude/.work/`**).

5. Optional: **durable memory** (local SQLite index, **`memory-prime`**) uses pack **`scripts/`** with **`npm install`** at the pack root; see the docs site **Durable memory** page (`site/src/content/docs/durable-memory.md` in this repo).

6. Optional: enable multi-agent mode in Codex if your environment supports it (see **`site/src/content/docs/README.codex.md`**).

## Symlink example (local dev)

Adjust paths to match your machine; this mirrors a minimal “live” link to the pack:

```bash
PACK=/path/to/agentic-swe
TARGET=/path/to/your-repo
cp "$PACK/AGENTS.md" "$TARGET/"
# Merge CLAUDE.md manually or follow commands/install.md
mkdir -p "$TARGET/.agentic-swe"
for d in commands phases agents templates references tools; do
  ln -sf "$PACK/$d" "$TARGET/.agentic-swe/$d"
done
ln -sf "$PACK/state-machine.json" "$TARGET/.agentic-swe/state-machine.json"
```

Point **`AGENTS.md`** (or your Codex config) at those paths so phase and command files resolve.
