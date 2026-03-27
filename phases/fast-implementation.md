# Fast-Path Implementation

## Mission

Implement a low-risk change end-to-end under a tighter review budget.

## Constraints

- Maximum **2 review iterations** (tracked in `state.json.counters.fast_iter`).
- If the second review still has blocking findings, escalate to `escalate-code` rather than iterating further.

## Delegation

Follow the same delegation model as `phases/implementation.md`:

1. Re-read `feasibility.md` and `fast-path-check.md` before delegating.
2. Spawn `agents/developer.md` with the task scope, target files, and constraints.
3. Consider `isolation: "worktree"` for safe experimentation.
4. Before producing review artifacts, perform a structured self-review:
   a. Re-read `feasibility.md` requirements.
   b. Score the implementation against the 5-dimension rubric (correctness, safety, test adequacy, design conformance, complexity) — same scale as code-review (1=fail, 2=acceptable, 3=strong).
   c. If any dimension scores 1, fix before requesting review.
   d. Record self-review scores in `implementation.md`.

## Inline Test Requirement

Before completing, the developer agent must:

1. Identify the single most decisive test for the behavioral change.
2. Either write and run that test, or run existing tests covering the changed behavior. Use `/test-runner <scope>` to execute scoped tests.
3. Record test evidence (command, output, pass/fail) in `implementation.md`.
4. If no automated test path exists, document why and specify manual verification steps.

This is lighter than the full test phase but prevents shipping untested behavioral changes.

## Required Output

Write to `.claude/.work/<id>/`:

- `implementation.md` — files changed, summary, edge cases, deviations, **test evidence**
- `review-pass.md` (if clean) or `review-feedback.md` (if issues found)

Follow `templates/artifact-format.md` for structure. Apply `templates/evidence-standard.md` throughout.
