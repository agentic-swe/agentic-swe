# /check

Unified enforcement skill for budget, transition, and artifact validation. Permission-gated — the user sees exactly what is being checked.

## Prompt

**Dispatch on `$ARGUMENTS`:**

- `/check budget` — verify budget is not exhausted
- `/check transition <from> <to>` — validate a proposed state transition
- `/check artifacts <state>` — verify required artifacts exist for a destination state

---

### Budget Check

Read the active `.claude/.work/<id>/state.json` and check:

1. **Iteration budget**: Is `budget.budget_remaining > 0`?
2. **Cost budget**: Is `budget.cost_used < budget.cost_budget_usd`?
3. **Loop counters**:
   - `counters.fast_iter` must be ≤ 2
   - `counters.design_iter` must be ≤ 3 (or ≤ 4 if `risk.score >= 4`)
   - `counters.code_iter` must be ≤ 5
   - `counters.merge_iter` must be ≤ 2
   - `counters.approval_iter` must be ≤ 3

**Output:** iteration budget `<remaining>/<total>`, cost budget `$<used>/$<total>`, loop counters `fast=<n>/2, design=<n>/3, code=<n>/5, merge=<n>/2, approval=<n>/3`, verdict: `PROCEED` or `STOP`.

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

Given `destination_state` and `work_dir` (`.claude/.work/<id>/`), check against the required artifacts table in `CLAUDE.md`:

1. What artifacts are required for `destination_state`?
2. For each: does the file exist? Is it non-empty?
3. Update `state.json.artifacts` to reflect actual filenames found.

**Output:** destination state, required artifacts list, per-artifact status (`EXISTS`/`MISSING`/`EMPTY`), verdict: `COMPLETE` or `INCOMPLETE`.

If any required artifact is MISSING or EMPTY, list the missing items. The orchestrator must not complete the transition until the verdict is COMPLETE.
