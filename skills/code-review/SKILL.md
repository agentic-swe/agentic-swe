---
name: code-review
description: "Pipeline phase skill for state `code-review`. Use when current_state is code-review."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-claude-consistency"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/code-review.md"
---

# Code Review

## Mission

Approve only when correctness, complexity, and test adequacy are acceptable. Review code changes after `implementation` or `lean-track-implementation`.

## Persona

Demanding senior reviewer — correctness outranks style, regressions outrank elegance, complexity must earn its keep.

## Procedure

1. Read `feasibility.md`, `design.md` (when present), `implementation.md`, `self-review.md` (when present), and the actual changed files.

### Parallel Specialist Review (Auto-Selection)

2. Read `## Subagent Signals` from `feasibility.md`. If `subagent_auto_select` is enabled and `subagent-mode` is `full`:
   - Select 0-2 review-oriented subagents based on domain signals per `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md` (Parallel Review Mode). Typical selections:
     - Security-sensitive code → `security-auditor` (background)
     - Performance-sensitive code → `performance-engineer` (background)
     - Accessibility changes → `accessibility-tester` (background)
     - Infrastructure changes → `security-engineer` (background)
   - Spawn selected subagent(s) in **background** with the changed files and implementation context.
   - They run in parallel with the main review — do NOT wait for them before proceeding.
   - If `budget.budget_remaining` is below **`budget.policy.subagent_skip_below_budget_remaining`** (when set; else **3**), skip specialist spawning.

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

When verdict is `rejected`, also append a structured entry to `.worklogs/<id>/reflection-log.md`:

- **What failed**: concrete file:line evidence of the deficiency
- **Root cause**: the underlying reason (not just the symptom)
- **Strategy change**: specific approach the next implementation attempt should take

## Inputs

- `.worklogs/<id>/feasibility.md`
- `.worklogs/<id>/design.md` (if exists)
- `.worklogs/<id>/implementation.md`
- `.worklogs/<id>/self-review.md` (if exists)
- Actual changed source files

## Required Output

Write one of:

- `.worklogs/<id>/review-pass.md` (when approved)
- `.worklogs/<id>/review-feedback.md` (when rejected or escalated)

Following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, include:

- verdict: `approved`, `rejected`, or `escalated`
- rubric scores (5 dimensions, 1-3 scale) with evidence for each score
- findings by severity, confidence, evidence basis
- recommended next state

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Doubt Cycle (Optional)

Before approving code that **crosses module boundaries**, has **irreversible effects**, or **asserts properties the type system cannot verify**, invoke a Doubt-Driven Verification cycle per `${CLAUDE_PLUGIN_ROOT}/references/doubt-driven-verification.md`:

1. Name the CLAIM (the correctness assertion under scrutiny).
2. EXTRACT the diff or function + the design-spec contract.
3. DOUBT — spawn a fresh-context adversarial reviewer using `${CLAUDE_PLUGIN_ROOT}/agents/prompts/adversarial-reviewer-prompt.md`. Do NOT pass the CLAIM.
4. RECONCILE findings (contract-misread / actionable / trade-off / noise).
5. STOP after trivial findings, 3 cycles, or user override.

Increment `state.json.counters.doubt_cycles` for each cycle. Anti-doubt-theater: if 2+ cycles produce substantive findings but zero classified actionable, stop and escalate.

## Failure Protocol

- do not hide weak evidence behind "looks good"
- if a finding depends on a specific input or state, describe it concretely

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The author clearly thought about this — I'll trust their judgment." | Deference is not review. The reviewer's job is to verify claims against evidence, not to assume the author's reasoning was complete. |
| "It's a small change — no need to check edge cases." | Small changes in critical paths cause disproportionate damage. Size does not correlate with risk; blast radius does. |
| "The tests pass, so the code is correct." | Passing tests prove the tested paths work. They say nothing about untested branches, error handling, or invariants the test suite does not exercise. |
| "I'll note this as non-blocking — it can be fixed later." | Non-blocking findings that affect correctness or safety rarely get fixed post-merge. If it matters enough to note, classify its severity honestly. |
| "The self-review already caught the major issues." | Self-review operates with the author's mental model. Independent review exists precisely to find what the author's perspective cannot. |

## Red Flags

- Review artifact scores all dimensions 2+ but provides no evidence citations for any score.
- Rubric scores and verdict were decided before `/diff-review` was invoked.
- Specialist reviewers returned high-severity findings that are acknowledged but not reflected in the verdict rationale.
- The review approves code that deviates from `design.md` without documenting why the deviation is acceptable.
- Reflection log shows the same root-cause category in consecutive entries, but the review does not flag the pattern.
- Review feedback consists entirely of style or formatting suggestions with no correctness or safety analysis.

## Review Response Protocol

Anyone implementing fixes after this phase (return to `implementation`, lean-track loops, or human PR feedback) should treat review input as **claims to verify**, not orders to obey.

- **Verify before changing**: Check each item against the real code, runtime behavior, and tests. Reviewers and specialists can be mistaken—do not ship changes based on assumed correctness of the comment alone.
- **One fix at a time with tests**: Land one coherent fix (or one tightly related cluster) per step, with tests proving it; avoid batching unrelated edits to clear a feedback list faster.
- **Push back with evidence**: When feedback is wrong or out of scope, say so plainly and cite specifics—file:line, test output, `design.md` / feasibility excerpts, or authoritative docs—not silence or vague agreement.
- **No performative agreement**: Do not use empty praise or performative deference ("Great point!", "You're absolutely right!") instead of analysis. Acknowledge only what you actually verified.
- **Signal before noise**: Tackle blocking correctness, safety, and test-coverage gaps first; treat style-only or preference nits last unless the change is trivial and risk-free.
- **Design contradictions**: If honoring feedback would contradict approved `design.md` or documented feasibility scope, **escalate to the human**—do not silently redesign architecture or expand scope to satisfy a review thread.

This protocol is referenced from `approval-wait` when changes are requested on the PR.
