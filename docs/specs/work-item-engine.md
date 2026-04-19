# Work item engine (Phase 1)

This note complements root **`CLAUDE.md`**. It describes the **programmatic** enforcement shipped under **`scripts/lib/work-engine/`** and **`scripts/work-engine.cjs`**.

## Field shapes (budget)

- **`budget.budget_remaining`** — iteration-style budget; **`work-engine transition`** decrements by **1** per successful transition unless **`--no-decrement-budget`** is passed.
- **`budget.cost_used`** / **`budget.cost_budget_usd`** — compared with **strict `<`** for a **PROCEED** verdict.
- **`budget.cost_used` (live API spend estimate)** — After each Claude Code turn, the **`Stop`** hook (**`hooks/hooks.json`**) runs **`scripts/lib/work-engine/hook-record-cost.cjs`**, which reads the hook’s **`transcript_path`**, parses new JSONL lines since **`budget.cost_ledger.line_cursor`**, sums **Anthropic-style `usage`** blocks (input / output / cache read / cache creation tokens), converts to USD using **`scripts/lib/work-engine/pricing.cjs`** (Sonnet / Opus / Haiku tiers by model id substring), and **adds** the delta to **`cost_used`**. Override rates with **`AGENTIC_SWE_PRICING_JSON`** (see **`pricing.cjs`**). Pin the work item with **`AGENTIC_SWE_WORK_DIR=/abs/path/.worklogs/id`** when more than one active item exists; otherwise discovery uses **`AGENTIC_SWE_PROJECT_ROOT`** (if set) or the hook’s **`cwd`** as the **project root** and picks the newest non-**`completed`** **`state.json`** mtime under **`<projectRoot>/.worklogs/`**, with a **deterministic lexicographic tie-break** on the work id folder name when mtimes tie; **stderr** warns when multiple actives share the max mtime. Manual edits to **`cost_used`** are still allowed if you need to reconcile against an invoice. CLI **`record-cost`** accepts **`--project-root`** with the same precedence as the env var (see **`work-engine.cjs help`**).
- **`budget.usage_totals`** — Optional cumulative token counts (**`input_tokens`**, **`output_tokens`**, **`cache_read_input_tokens`**, **`cache_creation_input_tokens`**) updated on the same incremental transcript scan as **`cost_used`** (see **`transcript-cost.cjs`**). Used by the local **`/swe-dashboard`** view; attribution follows the same active-work-item rules as cost sync.

**Transcript vs. work item (attribution limits):** The **`Stop`** hook bills the **single** active **`state.json`** (see **`discover-workdir.cjs`** and **`AGENTIC_SWE_WORK_DIR`**). All new **`usage`** lines in that session’s **`transcript_path`** increment that item’s **`cost_used`** / **`usage_totals`** while it stays pinned—so a long session may include model usage **not** strictly scoped to that work item’s task. Subagent sessions may use **other** transcripts; merging multiple transcripts into one work item is **not** automated yet (reconcile manually or extend **`record-cost`** / hook design if you need it).

Loop caps, **`panel_runs`**, **`subagent_spawns`**, and per-track **`iteration_budget`** / **`cost_budget_usd`** come from merged **budget thresholds** config: pack default **`config/budget-thresholds.default.json`**, optional overlay **`AGENTIC_SWE_BUDGET_THRESHOLDS`** (path to JSON), and optional repo file **`.agentic-swe/budget-thresholds.json`** (deep merge, in that order). **`budget.policy`** on **`state.json`** holds subagent-related numbers derived from the **`subagents`** section (skip auto-select below **`budget_remaining`**, max spawns/delegation per phase). CLI: **`init --budget-profile …`**, **`apply-budget-profile`**, **`transition --set-pipeline-track …`** (see **`scripts/work-engine.cjs help`**).

## Evidence paths

CLI flag **`--evidence`** accepts comma-separated paths **relative to** **`.worklogs/<id>/`**. The engine rejects **`..`**, absolute paths, and paths that escape the work directory.

## `state.json` schema

**`schemas/work-item.schema.json`** validates the persisted document (Ajv draft 2020). **`history`** entries may be legacy **strings** (freeform) or **objects**; object entries must include **`from`**, **`to`**, and exactly one timeline field: **`at`** or **`timestamp`** (non-empty ISO strings). Optional fields include **`evidence_refs`**, **`assigned_subagent`**, **`reason`**, **`actor`**. Stricter validation may reject legacy hand-edited objects until **`work-engine migrate`** / manual fix.

## `state.json` writers and locking

**`applyTransition`** (engine) and **`syncCostFromTranscript`** (transcript cost sync) perform atomic writes (**temp file + rename**) wrapped in a **best-effort cross-process lock**: **`.agentic-swe-write.lock`** in the work dir (**`scripts/lib/work-engine/state-lock.cjs`**), acquired with **`O_CREAT | O_EXCL`**-style exclusivity and bounded retries. Another process holding the lock causes a bounded wait, then **`LOCK_TIMEOUT`** on exhaustion.

**What locking does not guarantee:** It does not replace workflow discipline; **CI** should still avoid two jobs mutating the same **`.worklogs/<id>`** concurrently. Locks are **per machine** (local filesystem); network filesystems may weaken semantics. Editors or other tools that rewrite **`state.json`** outside the engine are not coordinated by this lock.

## Phase 1 checklist (CI vs human)

| Area | Automated / CLI | Still human / IDE |
|------|-----------------|-------------------|
| **JSON Schema** on **`state.json`** | **`work-engine validate`**, **`work-engine doctor`** (active item) | Fixing invalid legacy files (then **`migrate`** if applicable) |
| **Budget verdict** (iteration + cost + counters) | **`work-engine budget`**, **`doctor`** (exits **1** on **STOP** for active item) | Choosing caps / track in **`CLAUDE.md`** workflow |
| **Allowed graph edge** | **`plan-transition`**, **`transition`** | Hypervisor choosing the right next state |
| **Required artifacts + evidence paths** | **`transition`** (blocks when missing) | Creating real artifact content |
| **Cost from transcript** | **`Stop`** hook, **`record-cost`** | Pinning **`AGENTIC_SWE_WORK_DIR`** when multiple actives tie |
| **Concurrent writers** | Lock around engine / cost sync writes | No lock for arbitrary manual edits or other tools |
| **Dashboard** | **`swe-dashboard-server`** read-only API | Interpreting rollups; Cursor hosts run **`npm run swe-dashboard`** manually (see site **`cursor-plugin`**, **`commands/swe-dashboard`**) |
| **CLAUDE “Required artifacts” table vs code** | **`test/state-machine-json.test.js`** (edges) | Row-level artifact parity unless a future checker exists |
