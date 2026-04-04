# Installation Guide

## Prerequisites

- **Claude Code** CLI, desktop app, or IDE extension ([install guide](https://docs.anthropic.com/en/docs/claude-code))
- **Git** installed and configured
- **GitHub CLI** (`gh`) installed and authenticated (optional; for PR creation flows)
- A **git repository** where you want to use the pipeline (recommended)

**Node.js** is only required if you build this repo’s marketing site or run repo tests — it is **not** required for end users installing the Claude Code plugin.

### Optional org knowledge files

After setup, you can add **repo-local** context the **feasibility** phase will read when present:

| Location | Purpose |
|----------|---------|
| `AGENTS.md` (repo root) | Conventions, commands, boundaries for agents |
| `docs/agentic-swe/*.md` | Optional: `CONVENTIONS.md`, `PITFALLS.md`, `DECISIONS.md`, `PLAYBOOK.md` |

Copy-paste guidance lives in the plugin at `${CLAUDE_PLUGIN_ROOT}/templates/repo-knowledge-stub.md`. Nothing here is required for the pipeline to run.

If something fails, see [troubleshooting.md](troubleshooting.md).

---

## Install (recommended): Claude Code plugin

The **supported** path is to add this GitHub repository as a **plugin marketplace** and install **`agentic-swe`**. Commands, phases, agents, templates, and references load from **`${CLAUDE_PLUGIN_ROOT}/`** (the plugin root). You do **not** copy the full pipeline into `project/.claude/` by default.

1. In Claude Code, add the marketplace (example; use the repo you trust):

   ```text
   /plugin marketplace add surajSFDC/agentic-swe
   ```

2. Install the plugin:

   ```text
   /plugin install agentic-swe@agentic-swe-catalog
   ```

3. Open your **target project** in Claude Code and run **`/install`** to merge root **`CLAUDE.md`** with the Hypervisor policy (if needed) and set up **`.worklogs/<id>/`**. You will be asked whether to add **`.worklogs/`** to **`.gitignore`**.

4. Start work:

   ```text
   /work Add retry logic to the API client
   ```

See [claude-code-plugin.md](claude-code-plugin.md) for manifest details, versioning, and validation.

### Local development (`--plugin-dir`)

From a checkout of this repository:

```bash
cd /path/to/your/target-project
claude --plugin-dir /path/to/agentic-swe
```

The repo root is the plugin root (`commands/`, `phases/`, `agents/`, …).

### Upgrades and repairs

Update the plugin from the marketplace (or pull Git and bump the plugin version). Re-run **`/install`** if you need to refresh the appended **`CLAUDE.md`** block or worklog setup.

---

## Slash command `/install`

After the plugin is enabled, **`/install`** (from `${CLAUDE_PLUGIN_ROOT}/commands/install.md`) guides **`CLAUDE.md`** merge, **`.worklogs/`**, and optional **`.gitignore`** — see that command’s prompt.

---

## Migrating from a vendored `.claude/` tree

If you previously copied **`.claude/commands`**, **`.claude/phases`**, etc. into a project:

1. Enable the **plugin** as above.
2. Remove the vendored **`.claude/commands`**, **`.claude/phases`**, and related dirs if you no longer want duplicates.
3. Move work state from **`.claude/.work/<id>/`** to **`.worklogs/<id>/`** if needed (see repo **`scripts/migrate-work-state.js`** and **`CHANGELOG.md`**).

---

## Selective copy (advanced)

If you only want subagents or catalog files without the full plugin, clone this repository and copy the directories you need from the repo root (e.g. `agents/subagents/`, `tools/subagent-catalog/`). Prefer the plugin for a supported, updatable install.

---

## Uninstalling

Disable or remove the plugin in Claude Code.

If you merged pipeline policy into root **`CLAUDE.md`**, remove everything after the `<!-- BEGIN autonomous-swe-pipeline policy` delimiter.

To remove local work state only:

```bash
rm -rf .worklogs
```

Remove legacy paths if present:

```bash
rm -rf .claude/commands .claude/phases .claude/agents .claude/templates .claude/references .claude/tools .claude/.work
```
