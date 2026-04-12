---
name: install
description: "Plugin-first setup for a target git repository (merge CLAUDE.md, bootstrap .worklogs/)."
---

# /install

**Plugin-first setup** for a **target git repository** using the agentic-swe Claude Code plugin.

The pipeline markdown (commands, phases, agents including bundled helpers under **`agents/plugin-runtime/`**, templates, references, hooks, **`state-machine.json`**, …) ships **inside the installed plugin** and is resolved via **`${CLAUDE_PLUGIN_ROOT}/...`**. You do **not** copy that tree into `project/.claude/` as the primary path.

## Prompt

### 1. Enable the plugin

- **Distribution:** Add this repository as a Claude Code plugin marketplace and install **`agentic-swe`** (see project docs for the marketplace name and `/plugin install` flow).
- **Local development:** Run Claude Code with **`claude --plugin-dir <path-to-this-repo-root>`** so the plugin root matches the repository layout (`commands/`, `phases/`, `agents/`, … at the repo root).

### 2. Project policy (`CLAUDE.md`)

- If the target repo has **no** root **`CLAUDE.md`**: offer to add one by copying or summarizing the Hypervisor policy from this pack’s root **`CLAUDE.md`** (or tell the user to copy it manually).
- If **`CLAUDE.md` already exists**: **append** (do not replace) the pipeline policy using this delimiter convention:

```markdown

---

<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->
```

- If the delimiter **`<!-- BEGIN autonomous-swe-pipeline policy`** is already present: **replace** only the content **after** the delimiter with the current policy text (upgrade path).

### 3. Work state: `.worklogs/<id>/`

Per-work artifacts (`state.json`, `progress.md`, `audit.log`, phase outputs) live under **`.worklogs/<id>/`** at the **target repository root** (not under `.claude/`).

When you **first** create `.worklogs/` or the first work id under it:

1. **Ask the user explicitly** whether to append **`.worklogs/`** to the project **`.gitignore`**.
2. If they **agree**, append a line `.worklogs/` to `.gitignore` (create the file if needed).
3. If they **decline**, leave `.gitignore` unchanged so teams may commit shared traces if they want.

**No silent gitignore** — do not modify `.gitignore` without this consent.

Optional: create **`.worklogs/.gitkeep`** only if the user wants an empty tracked folder before any work id exists (ask; do not assume).

### 4. What not to do

- Do **not** tell users to run **`npx agentic-swe`** or a global **`agentic-swe`** CLI (removed; install is plugin/marketplace + optional `CLAUDE.md` merge only).
- Do **not** bulk-copy **`commands/`**, **`phases/`**, **`agents/`**, etc. into **`target/.claude/`** unless the user explicitly asks for a **legacy/vendored** layout (out of scope for default onboarding).

### 5. Verification

Confirm the user can run slash commands such as **`/work`** and **`/check transition`** in Claude Code with the plugin enabled, and that **`.worklogs/`** (or a chosen work id folder) is writable under the target repo root.
