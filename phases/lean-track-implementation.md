# Lean-Track Implementation

## Mission

Implement a low-risk change end-to-end under a tighter review budget.

## Constraints

- Maximum **2 review iterations** (tracked in `state.json.counters.lean_iter`).
- If the second review still has blocking findings, escalate to `escalate-code` rather than iterating further.

## TDD Mode

When `state.json.pipeline.tdd_mode` is `true`, the developer agent must follow red-green-refactor discipline per `${CLAUDE_PLUGIN_ROOT}/references/tdd-discipline.md`. Even on the **lean track**, the red step (failing test output) must be captured before writing production code. Record evidence in `implementation.md` under `## TDD Evidence`. See `${CLAUDE_PLUGIN_ROOT}/references/tdd-examples.md` for patterns.

## Plan Quality

The implementation plan must meet `${CLAUDE_PLUGIN_ROOT}/references/plan-quality-bar.md` — exact file paths, complete code, verification commands with expected output. Decompose using `${CLAUDE_PLUGIN_ROOT}/references/task-decomposition-guide.md`. The lean track means fewer steps, not lower quality per step.

## Delegation

Follow the same delegation model as `${CLAUDE_PLUGIN_ROOT}/phases/implementation.md`, with additional subagent auto-selection for the lean track:

### Pre-Delegation: Subagent Auto-Selection (Minimal Mode)

1. Re-read `feasibility.md` and `lean-track-check.md` before delegating.
2. Read `## Subagent Signals` from `feasibility.md`.
3. If `subagent_auto_select` is enabled and a language specialist is recommended with `high` confidence AND it matches the primary language of the files to be changed:
   - Select that **one** language specialist for background advisory.
   - No domain specialists on the lean track.
4. If `budget_remaining` < 3, skip subagent selection entirely.

### Spawning

5. Spawn `${CLAUDE_PLUGIN_ROOT}/agents/developer-agent.md` (primary, **foreground**) with the task scope, target files, and constraints. Tell the developer agent it may spawn 1 subagent per `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md` if it encounters domain-specific complexity.
6. If a language specialist was selected, spawn it in **background** (non-blocking). If `lean-track-implementation` finishes before the specialist returns, **proceed without waiting**.
7. Consider `isolation: "worktree"` for safe experimentation.

### Self-Review

8. Before producing review artifacts, perform a structured self-review:
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

All test evidence must meet `${CLAUDE_PLUGIN_ROOT}/references/verification-standard.md` — show the command, its output, and exit code. Do not claim "tests pass" or "feature works" without captured executable proof. Hedging language ("should work", "seems fine") is treated as missing evidence.

This is lighter than the full test phase but prevents shipping untested behavioral changes.

## Required Output

Write to `.worklogs/<id>/`:

- `implementation.md` — files changed, summary, edge cases, deviations, **test evidence**, `## Specialist Advisory` (if subagent returned in time)
- `review-pass.md` (if clean) or `review-feedback.md` (if issues found)

If the background language specialist returns after implementation.md is written, append its findings. If it hasn't returned, proceed — do not wait.

Follow `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md` for structure. Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.
