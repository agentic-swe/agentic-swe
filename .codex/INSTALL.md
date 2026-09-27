# Installing agentic-swe for Codex

## Automated setup

From the target repository:

```bash
agentic-swe setup --host codex
```

This merges the project policy, preserves an existing `AGENTS.md`, installs the portable pack under `.agentic-swe/`, and safely merges lifecycle hooks into `.codex/hooks.json`. Review and approve those hooks when Codex asks you to trust the repository. The manual steps below remain available for custom layouts.

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

5. **Durable memory is automatic after hook approval.** Session start refreshes changed repository knowledge; Stop captures the transcript, evolves evidence-backed procedures, and writes a receipt. `npm run memory-index`, `memory-prime`, and `memory-reflect` are bootstrap, diagnostic, and recovery controls—not per-task requirements. See **[Durable memory](https://agentic-swe.github.io/agentic-swe-site/docs/durable-memory)**.

6. Optional: enable multi-agent mode in Codex if your environment supports it (see **[README.codex.md](https://github.com/agentic-swe/agentic-swe-site/blob/main/src/content/docs/README.codex.md)** in **agentic-swe-site**).

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
