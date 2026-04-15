# Overview

Applies to **every host**: policy in root **`CLAUDE.md`**, work state under **`.worklogs/<id>/`**, pack markdown at **`${CLAUDE_PLUGIN_ROOT}/`** (or an equivalent exposed checkout).

## Prerequisites

- **Git** installed and configured (recommended for any target repo)
- **GitHub CLI** (`gh`) — optional; used in PR flows described in the pack
- A **git repository** where you want artifacts and policy to live

**Node.js** is only required for Cursor’s automated **`CLAUDE.md`** merge script, OpenCode’s ESM plugin, or if you run this repo’s tests / site build — **not** for Claude Code plugin-only use.

### Optional repo knowledge

| Location | Purpose |
|----------|---------|
| **`AGENTS.md`** (repo root) | Conventions, commands, boundaries for agent sessions |
| **`docs/agentic-swe/*.md`** | Optional: `CONVENTIONS.md`, `PITFALLS.md`, `PLAYBOOK.md`, … |

Copy-paste stubs ship in the pack under **`templates/repo-knowledge-stub.md`**. None of this is required for the pipeline to run.

If something fails, see **[Troubleshooting](../troubleshooting.md)**.

For a **first successful run** on Claude Code (install → **`/work`** → **`.worklogs/`** → gate), use **[Golden path](../golden-path.md)** (~15 minutes).

---

## Slash command `/install` (Claude Code)

With the **Claude Code** plugin enabled, **`/install`** (from **`commands/install.md`**) walks **`CLAUDE.md`** merge, **`.worklogs/`**, and optional **`.gitignore`** — same contract as the merge scripts referenced in other tabs.

---

## Migrating from a vendored `.claude/` tree

1. Enable the **plugin** (or expose the pack) per the **Claude Code** tab.
2. Remove vendored **`.claude/commands`**, **`.claude/phases`**, etc., if you no longer want duplicates.
3. Move work state from **`.claude/.work/<id>/`** to **`.worklogs/<id>/`** if needed — see repo **`scripts/migrate-work-state.js`** and **`CHANGELOG.md`**.

---

## Selective copy (advanced)

To copy only **e.g.** `agents/subagents/` without the full plugin, clone this repository and copy the directories you need from the **repo root**. Prefer the supported install paths in each tab for updates and validation.

---

## Uninstalling

- **Claude Code:** disable or remove the plugin in the host UI.
- **Policy:** remove everything in root **`CLAUDE.md`** after the `<!-- BEGIN autonomous-swe-pipeline policy` delimiter (if present).
- **Work state only:**

  ```bash
  rm -rf .worklogs
  ```

- **Legacy paths (if present):**

  ```bash
  rm -rf .claude/commands .claude/phases .claude/agents .claude/templates .claude/references .claude/tools .claude/.work
  ```

Pick your host in the tabs above for install commands.
