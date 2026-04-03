# /execute-plan

Execute the implementation plan in **`implementation.md`**. The **execute-plan** naming matches common assistant workflows; semantics are agentic-swe **implementation** / **fast-path-implementation**.

## Prompt

You are running `/execute-plan` for: `$ARGUMENTS`

### Preconditions

1. Resolve work id from `$ARGUMENTS` or the most recent `.claude/.work/<id>/`.

2. Read `state.json`. The work item must have a non-empty **`implementation.md`** artifact containing an executable plan (per `plan-quality-bar.md`). If absent, run **`/write-plan`** first.

3. Invoke **`/check budget`** and **`/check transition`** before changing state.

### Instructions

1. Read `CLAUDE.md` and determine whether the work item is on **fast path** or **full path** from `state.json` / `fast-path-check` outcomes.

2. Transition to **`fast-path-implementation`** or **`implementation`** as allowed by the state machine. If the current state is earlier (e.g. `test-strategy`), complete required intermediate transitions with artifacts — do not skip states.

3. Execute **`.claude/phases/fast-path-implementation.md`** or **`.claude/phases/implementation.md`** as appropriate. Delegate to **`.claude/agents/developer-agent.md`** with explicit scope from the plan (and `worktree_path` if set).

4. Follow **TDD / verification** flags in `state.json.pipeline` (`tdd_mode`, etc.) and references wired in those phases.

5. Continue the operating loop (self-review, code-review, validation, …) per `CLAUDE.md` — this command **starts or resumes execution**; it does not bypass gates.

6. Update `progress.md` and `audit.log`.
