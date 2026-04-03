# Code Review

## Mission

Approve only when correctness, complexity, and test adequacy are acceptable. Review code changes after `implementation` or `fast-path-implementation`.

## Persona

Demanding senior reviewer — correctness outranks style, regressions outrank elegance, complexity must earn its keep.

## Procedure

1. Read `feasibility.md`, `design.md` (when present), `implementation.md`, `self-review.md` (when present), and the actual changed files.

### Parallel Specialist Review (Auto-Selection)

2. Read `## Subagent Signals` from `feasibility.md`. If `subagent_auto_select` is enabled and `subagent-mode` is `full`:
   - Select 0-2 review-oriented subagents based on domain signals per `.claude/phases/subagent-selection.md` (Parallel Review Mode). Typical selections:
     - Security-sensitive code → `security-auditor` (background)
     - Performance-sensitive code → `performance-engineer` (background)
     - Accessibility changes → `accessibility-tester` (background)
     - Infrastructure changes → `security-engineer` (background)
   - Spawn selected subagent(s) in **background** with the changed files and implementation context.
   - They run in parallel with the main review — do NOT wait for them before proceeding.
   - If `budget_remaining` < 3, skip specialist spawning.

### Main Review

3. Invoke `/diff-review` against the changed files for structured, evidence-backed findings.
4. Compare the code against required behavior, design intent, repo conventions, and likely edge cases.
5. Review with a defect-oriented mindset:
   - wrong or partial behavior
   - missing failure case handling
   - unjustified complexity
   - poor test coverage for risky branches
6. Separate blocking findings, non-blocking concerns, and speculative risks.
7. Score the implementation against each dimension (1=fail, 2=acceptable, 3=strong):
   - **Correctness**: behavior vs. spec (1=wrong behavior, 2=correct happy path with edge gaps, 3=edge cases handled)
   - **Safety**: failure modes and error handling (1=unsafe paths, 2=major paths covered, 3=defensive throughout)
   - **Test adequacy**: regression coverage (1=no/trivial tests, 2=happy path tested, 3=edge+error paths tested)
   - **Design conformance**: match to approved design (1=significant deviation, 2=minor deviations documented, 3=faithful)
   - **Complexity**: proportionality to problem (1=unnecessary complexity, 2=acceptable, 3=simplest viable)
8. Verdict rule: any dimension scored 1 → rejected. All 2+ → approved.

### Integrate Specialist Findings

9. If background specialist reviewers have returned, append their findings to the review artifact under `## Specialist Review Findings`.
10. If any specialist finding is severity `high` or `critical`, flag it in the verdict rationale — but the main rubric scores still control the transition.
11. If specialists have not returned yet, proceed with main verdict. Specialist findings arriving later are noted in the artifact but do not retroactively change the verdict.
12. Log all specialist spawns and results in `audit.log`.

## Reflection on Rejection

When verdict is `rejected`, also append a structured entry to `.claude/.work/<id>/reflection-log.md`:

- **What failed**: concrete file:line evidence of the deficiency
- **Root cause**: the underlying reason (not just the symptom)
- **Strategy change**: specific approach the next implementation attempt should take

## Inputs

- `.claude/.work/<id>/feasibility.md`
- `.claude/.work/<id>/design.md` (if exists)
- `.claude/.work/<id>/implementation.md`
- `.claude/.work/<id>/self-review.md` (if exists)
- Actual changed source files

## Required Output

Write one of:

- `.claude/.work/<id>/review-pass.md` (when approved)
- `.claude/.work/<id>/review-feedback.md` (when rejected or escalated)

Following `.claude/templates/artifact-format.md`, include:

- verdict: `approved`, `rejected`, or `escalated`
- rubric scores (5 dimensions, 1-3 scale) with evidence for each score
- findings by severity, confidence, evidence basis
- recommended next state

Apply `.claude/templates/evidence-standard.md` throughout.

## Failure Protocol

- do not hide weak evidence behind "looks good"
- if a finding depends on a specific input or state, describe it concretely

## Review Response Protocol

Anyone implementing fixes after this phase (return to `implementation`, fast-path loops, or human PR feedback) should treat review input as **claims to verify**, not orders to obey.

- **Verify before changing**: Check each item against the real code, runtime behavior, and tests. Reviewers and specialists can be mistaken—do not ship changes based on assumed correctness of the comment alone.
- **One fix at a time with tests**: Land one coherent fix (or one tightly related cluster) per step, with tests proving it; avoid batching unrelated edits to clear a feedback list faster.
- **Push back with evidence**: When feedback is wrong or out of scope, say so plainly and cite specifics—file:line, test output, `design.md` / feasibility excerpts, or authoritative docs—not silence or vague agreement.
- **No performative agreement**: Do not use empty praise or performative deference ("Great point!", "You're absolutely right!") instead of analysis. Acknowledge only what you actually verified.
- **Signal before noise**: Tackle blocking correctness, safety, and test-coverage gaps first; treat style-only or preference nits last unless the change is trivial and risk-free.
- **Design contradictions**: If honoring feedback would contradict approved `design.md` or documented feasibility scope, **escalate to the human**—do not silently redesign architecture or expand scope to satisfy a review thread.

This protocol is referenced from `approval-wait` when changes are requested on the PR.
