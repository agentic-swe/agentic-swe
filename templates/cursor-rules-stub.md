# Cursor rules stub (agentic-swe)

Copy the **fenced block below** into your **target repository** (the app or library you are changing), as a new file under **`.cursor/rules/`** — for example **`.cursor/rules/agentic-swe.mdc`**. Adjust Cursor rule frontmatter (globs, description) per [Cursor rules](https://docs.cursor.com/context/rules) for your layout.

**Purpose:** keep every Agent chat aligned with the **Hypervisor** policy in this repo’s root **`CLAUDE.md`** and with **`.worklogs/<id>/`** state, even when the Cursor plugin’s session hook does not run.

Replace **`PACK_ROOT`** with the absolute path or workspace-relative path to your **agentic-swe** checkout (clone, fork, or git submodule — the directory that contains **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, and **`state-machine.json`**).

---

## Paste into `.cursor/rules/*.mdc` (example body)

```markdown
---
description: Hypervisor + agentic-swe pack paths for this repo
globs: []
alwaysApply: true
---

You are operating under the **agentic-swe** pipeline for this project.

1. **Policy:** Read and follow the repository root **`CLAUDE.md`** (Hypervisor: state machine, gates, budgets, artifacts). Do not invent transitions; **`state.json`** is the source of truth for **`current_state`** and **`pipeline.track`**.

2. **Active work:** Before starting a new governed task, list **`.worklogs/`** and, if any work id exists, read **`.worklogs/<id>/state.json`** and continue from **`current_state`** unless the user explicitly starts something new.

3. **Pack paths:** Phase prompts, commands, agents, templates, and references live under the installed pack root. Treat **`PACK_ROOT`** as that root (same role as **`${CLAUDE_PLUGIN_ROOT}/`** in Claude Code):
   - Phases: **`PACK_ROOT/phases/`**
   - Commands: **`PACK_ROOT/commands/`**
   - Agents: **`PACK_ROOT/agents/`**
   - Templates: **`PACK_ROOT/templates/`**
   - References: **`PACK_ROOT/references/`**
   - State edges: **`PACK_ROOT/state-machine.json`** (must stay consistent with **`CLAUDE.md`**)

4. **Artifacts:** Write pipeline outputs only under **`.worklogs/<id>/`** in **this** repository (never treat **`PACK_ROOT/.worklogs/`** as the work tree unless that checkout *is* the target project).

5. **Enforcement:** Before changing **`state.json`**, follow the prompts in **`PACK_ROOT/commands/check.md`** (budget, transition, artifacts). In CI you may shell out to **`node PACK_ROOT/scripts/work-engine.cjs`** for the same structural rules. Evidence expectations: **`PACK_ROOT/templates/evidence-standard.md`**.

6. **Optional org context:** If present, read root **`AGENTS.md`** and **`docs/agentic-swe/*.md`** when they inform feasibility or implementation.
```

---

## After pasting

- Replace every **`PACK_ROOT`** in the pasted body with your real path (no trailing slash required if your tools accept either form).
- Re-read **`CLAUDE.md`** after pack upgrades; run **`node scripts/migrate-work-state.js`** from a pack checkout when **`CHANGELOG.md`** calls for work state migration.
- For install order and Cursor plugin wiring, use **`scripts/install-cursor-plugin.sh`** with **`AGENTIC_SWE_TARGET_REPO`** for an automated **`CLAUDE.md`** merge, or **`node scripts/merge-claude-policy.js --target …`**, plus the [Cursor plugin](https://agentic-swe.github.io/agentic-swe-site/docs/cursor-plugin) doc / **`commands/install.md`** for rules and delimiters.
