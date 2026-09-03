---
name: design-review
description: "Pipeline phase skill for state `design-review`. Use when current_state is design-review."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-claude-consistency"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/design-review.md"
---

# Design Review

## Mission

Review `design.md` for implementation readiness and return blocking issues to design when necessary.

## Persona

World-class design reviewer — assumes the design is incomplete until proven otherwise. Focuses on correctness, completeness, and change safety.

## Procedure

1. Read `feasibility.md`, `design.md`, and any panel notes.
2. If implementation artifacts already exist (design rework cycle), invoke `/diff-review` to review changes against the prior design.
3. Validate that the design answers:
   - what changes, where, why this approach, how it will be tested, what can still fail
4. Look for:
   - missing file-level mapping
   - unresolved ambiguity disguised as "implementation detail"
   - weak rollback or migration story
   - under-specified operational or config changes
   - implausible validation plans
5. Distinguish blocking issues from non-blocking polish.
6. Score the design against each dimension (1=fail, 2=acceptable, 3=strong):
   - **Completeness**: all requirements addressed?
   - **Testability**: each acceptance criterion verifiable?
   - **File mapping**: every element maps to concrete file?
   - **Risk identification**: failure modes and rollback explicit?
   - **Simplicity**: smallest coherent design?
7. Verdict rule: any dimension scored 1 → issues. All 2+ → approved.

## Reflection on Rejection

When verdict is `issues`, also append a structured entry to `.worklogs/<id>/reflection-log.md`:

- **What failed**: concrete evidence of the design gap
- **Root cause**: the underlying reason (not just the symptom)
- **Strategy change**: specific approach the next design iteration should take

## Inputs

- `.worklogs/<id>/feasibility.md`
- `.worklogs/<id>/design.md`
- `.worklogs/<id>/design-panel-review.md` (if exists)

## Required Output

Write one of:

- `.worklogs/<id>/design-review.md` (when approved)
- `.worklogs/<id>/design-feedback.md` (when rework is needed)

Following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, include:

- verdict: `approved` or `issues`
- rubric scores (5 dimensions, 1-3 scale) with evidence for each score
- blocking issues and non-blocking concerns
- confidence and evidence basis
- recommended next state

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Doubt Cycle (Optional)

Before finalizing the verdict on any **non-trivial** design decision (crosses boundaries, irreversible, asserts unverifiable properties), invoke a Doubt-Driven Verification cycle per `${CLAUDE_PLUGIN_ROOT}/references/doubt-driven-verification.md`:

1. Name the CLAIM (the design assertion under scrutiny).
2. EXTRACT the smallest reviewable artifact + contract.
3. DOUBT — spawn a fresh-context adversarial reviewer using `${CLAUDE_PLUGIN_ROOT}/agents/prompts/adversarial-reviewer-prompt.md`. Do NOT pass the CLAIM.
4. RECONCILE findings (contract-misread / actionable / trade-off / noise).
5. STOP after trivial findings, 3 cycles, or user override.

Increment `state.json.counters.doubt_cycles` for each cycle. If 3 cycles still surface substantive issues, escalate to the user before approving.

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "The design is clear enough — no need to score every dimension." | Skipping rubric dimensions hides weak areas and produces unfounded approval. |
| "I'll soften the verdict so the designer isn't discouraged." | A soft verdict on a hard problem delays rework to code review where it costs more. |
| "All five dimensions look fine" (without evidence). | Rubber-stamping is the most common review failure; every score needs a cited artifact or file reference. |
| "The panel already reviewed this, so I can fast-track." | Panel input is advisory — this phase owns the binding verdict and must independently verify. |

## Red Flags

- All five dimensions scored 3 with no blocking issues identified on a complex or multi-file design.
- Rubric scores present but evidence column is empty or contains only "looks good."
- No blocking issues recorded for a design that crosses module boundaries or introduces new dependencies.
- Verdict is `approved` but the traceability to acceptance criteria is missing or hand-waved.
- Review artifact is shorter than the design it reviews.

## Failure Protocol

- if the design is not implementation-ready, do not soften the verdict
- if concerns are speculative, label them as such
