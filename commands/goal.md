---
name: goal
description: "Run a governed goal loop: define a verifiable objective and iterate work items until it holds, halting at every human gate and budget ceiling."
---

# /goal

Run the **outer goal loop** — the loop-engineering layer over the per-work-item pipeline. You define a goal and a *verifiable* completion condition; the Hypervisor discovers work, runs it through the existing state machine, verifies the objective, and repeats **until the goal holds, a human gate is hit, or a budget is exhausted.**

> Namespaced as `agentic-swe:goal` to avoid colliding with the host built-in `/goal`. This is the **governed** goal loop: it halts at gates instead of running through them.

## Prompt

You are running `/goal` for: `$ARGUMENTS`.

### Guiding principle — loop *up to* the gate, not *through* it

The outer loop advances autonomously but **stops** and surfaces to the human whenever: a child work item reaches a human gate (`ambiguity-wait`, `approval-wait`), the outer budget is exhausted, a stall is detected, or the objective verifies and needs final sign-off. Never bypass a gate to "keep the loop going."

### Canonical sources (do not restate — read them)

- **`${CLAUDE_PLUGIN_ROOT}/goal-state-machine.json`** — allowed outer transitions (authority).
- **`${CLAUDE_PLUGIN_ROOT}/templates/goal.json`** — outer state template.
- **`${CLAUDE_PLUGIN_ROOT}/agents/goal-verifier-agent.md`** — the goal-level checker.
- **`CLAUDE.md`** — the per-work-item state machine the children run on (unchanged).

### Outer state machine

```
goal-initialized -> goal-discovery
goal-discovery -> goal-execute | goal-failed
goal-execute -> goal-verify | goal-gate | goal-escalated
goal-verify -> goal-execute | goal-approval | goal-escalated
goal-gate -> goal-execute | goal-failed
goal-approval -> goal-met | goal-execute
goal-escalated -> goal-execute | goal-failed
```

| State | What you do |
|-------|-------------|
| `goal-discovery` | Enumerate + triage work from `completion_criteria` and `discovery.sources` (explicit sub-goals, failing tests, `TODO`/`FIXME` scan). Queue child work items into `goal.json.discovery.queue`. If nothing to do and criteria already hold → `goal-approval`; if infeasible → `goal-failed`. |
| `goal-execute` | Pick the next queued item; run it through the **existing** pipeline via `/work` (no inner changes). On child `completed` → `goal-verify`. If the child parks at a human gate → `goal-gate`. On unrecoverable child failure/escalation → `goal-escalated`. Increment `budget.child_items_used`. |
| `goal-verify` | Delegate to `${CLAUDE_PLUGIN_ROOT}/agents/goal-verifier-agent.md` to evaluate `completion_criteria` against repo reality — evidence-backed, distinct from per-item validation. Met → `goal-approval`. Not met, more to do → `goal-execute`. Non-converging → `goal-escalated`. |
| `goal-gate` | A child is waiting on a human. Pause, surface it, resume to `goal-execute` when resolved (or `goal-failed` if abandoned). |
| `goal-approval` | Human confirms the objective is genuinely met. Approved → `goal-met`. "Not really done" → `goal-execute`. |
| `goal-escalated` | Human decision required. → `goal-execute` (with guidance) or `goal-failed`. |
| `goal-met` / `goal-failed` | Terminal. |

### Completion criteria — verifiable-first

Set `goal.json.completion_criteria.type`:
- **`command`** — a shell command that must exit `0` (e.g. `npm test`). Strongest; prefer this.
- **`checklist`** — sub-goals, each ideally with its own verify command; met when all verified.
- **`assertion`** — freeform, requires human confirmation at `goal-approval`. Weakest — do not overuse.

Every path ends at the `goal-approval` human gate before `goal-met`: the machine proposes "met," the human disposes.

### Budgets & stall detection (outer)

Read/enforce `goal.json.budget`: `max_child_items`, `max_loop_turns`, aggregate `cost_budget_usd`. On each loop turn increment `loop_turns_used`. If `goal-verify` returns the same `convergence.last_failure_category` for `consecutive_same_category >= 2`, transition to `goal-escalated` — do not burn the whole budget on one failure mode. If a budget ceiling is reached, stop and surface to the human.

### Operating loop

1. **Resolve context.** If `$ARGUMENTS` is an existing goal id under `.worklogs/goals/<id>/`, resume it. Otherwise create one: `node ${CLAUDE_PLUGIN_ROOT}/scripts/goal-engine.cjs init --id <goal-id> --objective "$ARGUMENTS"` (writes `goal.json` + `audit.log`).
2. **Define `completion_criteria`** with the human before executing — this is the stop condition; get it right.
3. **Advance** one state at a time. Validate every transition with the engine before writing it:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/goal-engine.cjs transition --goal-dir .worklogs/goals/<id> --to <state> --actor hypervisor --reason "<why>"
   ```
   (Use `--dry-run` to check an edge without committing it. Invalid edges exit non-zero.)
4. **Execute children** via `/work` in `goal-execute`; record each in `goal.json.children` with `{ work_id, status, contribution }`.
5. **Verify** via the goal-verifier in `goal-verify`; integrate its verdict (it is input, not automatic truth).
6. **Halt** at any gate/budget/stall and surface to the human. Append every transition to `goal.json.history` and `audit.log`.
7. Repeat until `goal-met` or `goal-failed`.

### First-slice limits (current build)

Single active child item at a time; `completion_criteria` types `command` and `checklist`; discovery sources explicit + failing-tests + TODO scan. Parallel children (worktrees) and connector-based discovery (issues/CI/review comments) are later slices.
