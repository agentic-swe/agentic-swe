# Slash command `/check` (quick reference)

The pipeline’s enforcement checks are invoked as **`/check <subcommand>`** inside Claude Code (see `${CLAUDE_PLUGIN_ROOT}/commands/check.md` for full prompts).

| Invocation | Purpose |
|------------|---------|
| `/check budget` | Iteration and cost budgets; loop counters; **PROCEED** vs **STOP** |
| `/check transition <from> <to>` | Whether a state transition is allowed per `CLAUDE.md` |
| `/check artifacts <state>` | Required artifacts for the destination state |

Use these **before** advancing the state machine when the Hypervisor policy (`CLAUDE.md`) requires it.

## Headless work engine (CI)

From a checkout of the **agentic-swe** pack (or with **`${CLAUDE_PLUGIN_ROOT}`** pointing at the installed plugin), you can run the same structural checks **without** the IDE:

```bash
npm run work-engine -- help
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-engine.cjs" validate --work-dir .worklogs/<id>
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-engine.cjs" budget --work-dir .worklogs/<id> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-engine.cjs" record-cost --transcript-path /path/to/transcript.jsonl --cwd "$(pwd)"
```

In Claude Code, **`budget.cost_used`** is normally updated automatically via the **`Stop`** hook (see pack **`hooks/hooks.json`**). The **`record-cost`** command is for manual replay or CI if you export a transcript path.

See **`commands/check.md`** in the pack for **`init`**, **`plan-transition`**, **`transition`**, and **`record-cost`**. Spec: [work-item-engine.md](https://github.com/surajSFDC/agentic-swe/blob/main/docs/specs/work-item-engine.md) in the repo.

## Local work dashboard (`/swe-dashboard`)

Slash **`/swe-dashboard`** (see pack **`commands/swe-dashboard.md`**) opens a **read-only** page at **`http://127.0.0.1:47822/`** (default; set **`SWE_DASHBOARD_PORT`**) listing all **`.worklogs/<id>/state.json`** work items: cost, token totals, filters, export, and rollups. **Claude Code** can auto-start the server via **`UserPromptSubmit`** (**`hooks/dashboard-on-prompt.sh`**); elsewhere run:

```bash
npm run swe-dashboard -- --cwd "$(pwd)"
```

Demo data for an empty repo (writes gitignored **`.worklogs/_demo-*`**):

```bash
npm run seed-dashboard-demo
```

## Pack CLIs: durable memory (optional)

From a checkout of the pack (or with **`${CLAUDE_PLUGIN_ROOT}/scripts/`** on the path):

```bash
npm run memory-index -- --project-root "$(pwd)"
npm run memory-prime -- --project-root "$(pwd)" --query "your task keywords"
npm run memory-compact -- --work-dir "$(pwd)/.worklogs/<id>"
npm run memory-import -- --project-root "$(pwd)" --file bundle.json --force
npm run memory-sliding-summary -- --work-dir "$(pwd)/.worklogs/<id>" --transcript-path /path/to/transcript.jsonl
```

**`hooks/session-start`** appends **memory-prime** by default; set **`AGENTIC_SWE_MEMORY_PRIME=0`** to disable. Full reference: [Durable memory](durable-memory.md) and the repo spec [memory-graph.md](https://github.com/surajSFDC/agentic-swe/blob/main/docs/specs/memory-graph.md).

## Pack CLIs: catalog lint and routing (Phase 3)

**`npm run verify`** includes **`catalog:lint`** (subagent frontmatter and overlap checks). Routing and optional semantic index:

```bash
npm run catalog:lint
npm run catalog:route -- "your task text" --mode auto --k 5 --json
npm run catalog:index -- --project-root "$(pwd)" --plugin-root "${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
```

Details: [Catalog routing](catalog-routing.md).

Related: [troubleshooting.md](troubleshooting.md), [usage.md](usage.md), [durable-memory.md](durable-memory.md), [catalog-routing.md](catalog-routing.md).
