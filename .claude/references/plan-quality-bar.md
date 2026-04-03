# Plan quality bar

A plan is ready when a "zero-context engineer" — an enthusiastic junior developer who has never seen the repository — can execute it without asking a single clarifying question. Every ambiguity the developer would have to resolve is a defect in the plan.

## The zero-context test

Read each step aloud and ask: "Could someone with no project knowledge execute this in 2-5 minutes without guessing?" If the answer is no, the step is incomplete.

## Required per step

| Element | Good | Bad |
|---------|------|-----|
| File path | `src/auth/middleware.ts` | "the auth middleware" |
| Location in file | "after the `validateToken` function (line ~45)" | "in the appropriate place" |
| Code snippet | Complete, copy-pasteable code block | "add appropriate validation" |
| Verification | `npm test -- --grep "token expiry" → expected: 3 passed, 0 failed` | "run the tests" |
| Dependencies | "requires step 3 to be completed first" | (implicit ordering) |

## Granularity

Each step should take **2-5 minutes** to execute. Signs a step is too large:

- It touches more than 2 files
- It contains multiple independent code changes
- The verification checks more than one behavior
- You need the word "and" to describe what it does

Signs a step is too small:

- It only adds an import that the next step uses
- It renames a single variable with no behavioral effect
- Combining it with the next step would still be under 5 minutes

## Banned phrases

These indicate incomplete planning. Replace each with concrete specifics.

| Phrase | What to write instead |
|--------|-----------------------|
| "add appropriate error handling" | The exact try/catch or error type with the specific response |
| "update the config as needed" | The exact key-value pairs being added or changed |
| "similar to the existing pattern" | The actual code, even if it resembles nearby code |
| "handle edge cases" | Each edge case named, with its specific handling code |
| "wire up the component" | Exact import path, exact props, exact placement in JSX/template |
| "ensure tests pass" | The exact test command and its expected output |

## Self-review dimensions

Before submitting a plan, score each dimension 1-3 (1=fail, 2=adequate, 3=strong):

| Dimension | 1 (fail) | 3 (strong) |
|-----------|----------|------------|
| **Spec coverage** | Steps don't cover all requirements | Every requirement traces to at least one step |
| **Completeness** | Placeholder phrases remain | Every step has file path, code, and verification |
| **Buildability** | Intermediate steps leave the build broken | Each step produces a buildable state |
| **Testability** | No verification commands | Every step has a runnable check with expected output |
| **Ordering** | Dependencies are implicit or circular | Explicit dependency chain, each step buildable after completion |

Any dimension scoring 1 is a blocking defect. Fix before proceeding.

## Verification commands

Every step must include a verification command. Acceptable forms:

- `npm test -- --grep "pattern"` with expected pass/fail counts
- `npx tsc --noEmit` (expect exit 0)
- `curl -s localhost:3000/api/health | jq .status` (expect `"ok"`)
- `grep -c "export function" src/utils.ts` (expect specific count)
- Manual check: "open `http://localhost:3000/settings` → toggle appears in sidebar" (only when no automated alternative exists)

## Scope

Consumed by:

- `.claude/phases/implementation.md` (full-path plan quality gate)
- `.claude/phases/fast-path-implementation.md` (same standard, fewer steps)
- `.claude/agents/developer-agent.md` (plan authoring)
