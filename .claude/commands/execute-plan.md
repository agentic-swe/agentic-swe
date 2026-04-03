# /execute-plan

Execute the implementation plan in **`implementation.md`**. The **execute-plan** naming matches common assistant workflows; semantics are agentic-swe **implementation** / **lean-track-implementation**.

## Prompt

You are running `/execute-plan` for: `$ARGUMENTS`

### Preconditions

1. Resolve work id from `$ARGUMENTS` or the most recent `.claude/.work/<id>/`.

2. Read `state.json`. The work item must have a non-empty **`implementation.md`** artifact containing an executable plan (per `plan-quality-bar.md`). If absent, run **`/write-plan`** first.

3. Invoke **`/check budget`** and **`/check transition`** before changing state.

### Instructions

1. Read `CLAUDE.md` and read **`pipeline.track`** (`lean` | `standard` | `rigorous`) and `lean-track-check` outcomes. If `track` is unset on an older work item, treat as **`rigorous`** for transition rules.

2. Transition to **`lean-track-implementation`** or **`implementation`** as allowed by the state machine and active track. If the current state is earlier (e.g. `test-strategy`), complete required intermediate transitions with artifacts — do not skip states.

3. Execute **`.claude/phases/lean-track-implementation.md`** or **`.claude/phases/implementation.md`** as appropriate. Delegate to **`.claude/agents/developer-agent.md`** with explicit scope from the plan (and `worktree_path` if set).

4. Follow **TDD / verification** flags in `state.json.pipeline` (`tdd_mode`, etc.) and references wired in those phases.

5. Continue the operating loop per `CLAUDE.md` — for **standard** track after `self-review`, go to **`validation`** (not `code-review`). For **rigorous** track, use self-review → code-review → permissions-check → validation. This command **starts or resumes execution**; it does not bypass gates.

6. Update `progress.md` and `audit.log`.
