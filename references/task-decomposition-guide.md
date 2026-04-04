# Task decomposition guide

Operational rules for breaking implementation work into steps that are small enough to verify independently and large enough to be worth executing.

## Target granularity

Each step takes **2-5 minutes** to execute. The output of each step is a buildable, testable state — never a half-written function or a broken import.

## Step anatomy

Every step must specify all five elements:

1. **File path** — exact path from repo root (e.g., `src/api/routes/users.ts`)
2. **What changes** — one-sentence description of the change's purpose
3. **Code** — complete snippet, copy-pasteable, including surrounding context lines for placement
4. **Verification** — a runnable command with expected output (test, type-check, curl, grep)
5. **Dependencies** — which prior steps must be done first (or "none")

If you cannot fill all five, the step is underspecified. Fix it before moving on.

## Ordering principles

### Dependencies first

Build from the bottom up. A new utility function comes before the code that calls it. A database migration comes before the query that uses the new column.

### Tests before production code (TDD mode)

When `tdd_mode` is active, each behavioral change follows red-green-refactor:

1. Write the failing test (step N)
2. Write the minimum production code to pass (step N+1)
3. Refactor if needed (step N+2)

When TDD is not active, prefer writing tests in the same step as the code they cover, or immediately after.

### Core before polish

Implement the happy path first, then error handling, then edge cases, then logging/metrics. Typical order: types → core logic → test → wiring → error handling → integration test.

## When to split a step

- Touches **more than 2 files**
- Contains **unrelated changes** (a bug fix and a feature in one step)
- Verification would test **multiple behaviors** at once
- Takes **longer than 5 minutes** to execute

## When to merge steps

Merge when two steps touch the **same file** with tightly coupled changes **and** executing them separately would leave a broken intermediate state (e.g., adding an import and using the imported symbol).

## Cross-cutting concerns

Logging, error handling, and metrics get their own dedicated step(s) — not sprinkled into every other step. Each step's verification should focus on one behavior.

## DRY and YAGNI enforcement

- **Don't extract a helper** until the second use. The first instance is inline.
- **Don't add configuration** for values that have exactly one possible value today.
- **Don't build abstractions** the spec doesn't require. If the task says "add a REST endpoint," don't also build a generic endpoint factory.
- **Don't add "while I'm here" changes.** If you notice a nearby improvement, note it as a follow-up — don't bundle it into the current decomposition.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Steps that only work in sequence with no independent verification | Add a verification command to each step |
| "Refactor everything" as a single step | Break into specific, file-by-file refactors |
| Mixing test infrastructure setup with test writing | Separate: step 1 = configure test runner, step 2 = write first test |
| Leaving the build broken between steps | Each step must end with a passing type-check at minimum |
| Ordering by file rather than by dependency | Reorder so each step can be verified without forward references |

## Scope

Consumed by:

- `${CLAUDE_PLUGIN_ROOT}/phases/implementation.md` (structuring implementation plans)
- `${CLAUDE_PLUGIN_ROOT}/phases/lean-track-implementation.md` (same decomposition rules, smaller scope)
- `${CLAUDE_PLUGIN_ROOT}/agents/developer-agent.md` (step execution)

Related: `${CLAUDE_PLUGIN_ROOT}/references/plan-quality-bar.md` (quality criteria for each step)
