---
name: check
description: "Enforce budget, transition, and artifact checks (permission-gated)."
---

# /check

Unified enforcement skill for budget, transition, and artifact validation. Permission-gated — the user sees exactly what is being checked.

## Work engine (CI / automation)

The same **budget**, **transition**, and **destination artifact** rules are implemented in code at **`${CLAUDE_PLUGIN_ROOT}/scripts/lib/work-engine/`** and exposed as:

- **`node ${CLAUDE_PLUGIN_ROOT}/scripts/work-engine.cjs help`** — subcommands: `init`, `apply-budget-profile`, `validate`, `budget`, `plan-transition`, `transition`, `record-cost`
- From a checkout of this pack: **`npm run work-engine -- …`**

Use **`plan-transition`** to validate a proposed edge without writing; use **`transition`** only when artifacts and budgets already satisfy policy (atomic **`state.json`** write, optional **`--dry-run`**). **`budget.cost_used`** is updated from **real token usage** in the Claude Code session transcript: the **`Stop`** hook runs **`hook-record-cost.cjs`** (see root **`hooks/hooks.json`**), which parses new lines from **`transcript_path`** and adds estimated USD (see **`scripts/lib/work-engine/pricing.cjs`**; override with **`AGENTIC_SWE_PRICING_JSON`**). For CI or ad-hoc sync: **`npm run work-engine -- record-cost --transcript-path /path/to.jsonl --cwd /your/repo`**. Set **`AGENTIC_SWE_WORK_DIR`** to a specific **`.worklogs/<id>`** if multiple active work items exist. Iteration **`budget.budget_remaining`** is decremented by **`transition`** by default (**`--no-decrement-budget`** to skip).

**Configurable budgets (tracks + caps + subagents):** Defaults ship in **`config/budget-thresholds.default.json`** (per-track **`iteration_budget`** / **`cost_budget_usd`**, **`counter_caps`**, **`subagents`** thresholds). Merge overrides from **`AGENTIC_SWE_BUDGET_THRESHOLDS`** (path to a JSON file) and from **`<repo>/.agentic-swe/budget-thresholds.json`**. **`init … --budget-profile lean|standard|rigorous`** applies that track’s ceilings and writes **`budget.policy`**; **`apply-budget-profile --work-dir … --track …`** updates an existing work item. When leaving **`lean-track-check`**, **`transition … --set-pipeline-track …`** applies the chosen track’s ceilings from the same merged config.

## Prompt

**Dispatch on `$ARGUMENTS`:**

- `/check budget` — verify budget is not exhausted
- `/check transition <from> <to>` — validate a proposed state transition
- `/check artifacts <state>` — verify required artifacts exist for a destination state

---

### Budget Check

Read the active `.worklogs/<id>/state.json` and check:

1. **Iteration budget**: Is `budget.budget_remaining > 0`?
2. **Cost budget**: Is `budget.cost_used < budget.cost_budget_usd`?
3. **Loop counters** (defaults match **`config/budget-thresholds.default.json`**; **`work-engine budget`** uses merged config when **`--work-dir`** resolves under **`.worklogs/`**):
   - `counters.lean_iter` must be ≤ configured cap (default 2)
   - `counters.design_iter` must be ≤ 3 or ≤ high-risk cap if `risk.score` meets **`design_iter_high_risk_min_score`** (defaults 3 / 4 / score ≥ 4)
   - `counters.code_iter`, `merge_iter`, `approval_iter`, `self_review_iter`, `test_adequacy_iter` — each ≤ its cap in config
   - `counters.panel_runs` and `counters.subagent_spawns` — enforced when using the programmatic engine with a valid work dir (defaults 8 and 60)

**Output:** iteration budget `<remaining>/<total>`, cost budget `$<used>/$<total>`, loop counters with effective ceilings, verdict: `PROCEED` or `STOP`.

If any budget or counter is exhausted, output a clear **STOP** directive naming the exhausted resource.

---

### Transition Check

Given `from_state` and `to_state`, check against the state machine in `CLAUDE.md`:

1. Is the transition `from_state → to_state` in the allowed transition set?
2. What artifacts are required for the destination state?
3. Are there any loop budget constraints that apply?

**Output:** transition `<from> → <to>`, allowed: `true`/`false`, required artifacts for destination, applicable budget constraints, verdict: `VALID` or `INVALID`.

If INVALID, explain which rule it violates.

---

### Artifact Check

Given `destination_state` and `work_dir` (`.worklogs/<id>/`), check against the required artifacts table in `CLAUDE.md`:

1. What artifacts are required for `destination_state`?
2. For each: does the file exist? Is it non-empty?
3. Update `state.json.artifacts` to reflect actual filenames found.

**Output:** destination state, required artifacts list, per-artifact status (`EXISTS`/`MISSING`/`EMPTY`), verdict: `COMPLETE` or `INCOMPLETE`.

If any required artifact is MISSING or EMPTY, list the missing items. The Hypervisor must not complete the transition until the verdict is COMPLETE.
