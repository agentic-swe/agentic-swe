---
name: self-review
description: "Pipeline phase skill for state `self-review`. Use when current_state is self-review."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-claude-consistency"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/self-review.md"
---

# Self-Review

## Mission

Self-critique implementation against the approved design before external code review. Catch deficiencies early to reduce review round-trips.

## Persona

The developer's inner critic — assumes at least one meaningful deficiency exists until proven otherwise. Rigor over reassurance.

## Procedure

1. Read `design.md`, `implementation.md`, `test-stubs.md` (if exists), and `reflection-log.md` (if exists — treat prior reflection entries as mandatory constraints). Use `${CLAUDE_PLUGIN_ROOT}/templates/evaluation-rubric.md` as the dimension reference.
2. Score the implementation against each dimension (1=fail, 2=acceptable, 3=strong):
   - **Correctness**: behavior vs. spec (1=wrong behavior, 2=correct happy path with edge gaps, 3=edge cases handled)
   - **Safety**: failure modes and error handling (1=unsafe paths, 2=major paths covered, 3=defensive throughout)
   - **Test adequacy**: regression coverage (1=no/trivial tests, 2=happy path tested, 3=edge+error paths tested)
   - **Design conformance**: match to approved design (1=significant deviation, 2=minor deviations documented, 3=faithful)
   - **Complexity**: proportionality to problem (1=unnecessary complexity, 2=acceptable, 3=simplest viable)
3. Build a traceability matrix: for each acceptance criterion in `design.md` → identify implementing code (file:line) + verifying test.
4. Apply verdict rule:
   - Any dimension scored 1 **or** any acceptance criterion untraced → verdict `rework`. Return to `implementation` with specific guidance on what to fix.
   - All dimensions 2+ **and** traceability complete → verdict `pass`. Proceed to **`code-review`** when `pipeline.track` is **`rigorous`** (or unset, treated as rigorous). Proceed to **`validation`** when `pipeline.track` is **`standard`** (standard track skips code-review and permissions-check). The **lean** track does not use this phase in the same way — it uses `lean-track-implementation` instead.
5. If `reflection-log.md` exists, verify that each prior reflection entry has been addressed by the current implementation.

## Inputs

- `.worklogs/<id>/design.md`
- `.worklogs/<id>/implementation.md`
- `.worklogs/<id>/test-stubs.md` (if exists)
- `.worklogs/<id>/reflection-log.md` (if exists)

## Required Output

Write `.worklogs/<id>/self-review.md` following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, with:

- rubric scores (5 dimensions, 1-3 scale) with evidence for each score
- traceability matrix (acceptance criterion → implementing code → verifying test)
- findings: specific deficiencies with file:line references
- verdict: `pass` or `rework`
- if `rework`: specific guidance for what implementation must change

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Budget

`self_review_iter` maximum 1. This phase returns to implementation at most once. After one rework cycle, the self-review must pass forward to `code-review` regardless of scores — remaining concerns are recorded as findings for the code reviewer.

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "Self-review is just a formality before real code review." | Self-review exists to catch deficiencies cheaply; treating it as ceremonial pushes avoidable rework to the code reviewer. |
| "Tests pass, so all dimensions are at least 2." | Passing tests prove test-covered behavior only; correctness, safety, design conformance, and complexity are independent dimensions. |
| "I wrote the code, so I know it's correct." | Author familiarity breeds blind spots — the inner-critic persona exists precisely to counteract this bias. |
| "The traceability matrix is overkill for this size change." | Untraced acceptance criteria are unverified acceptance criteria, regardless of change size. |

## Red Flags

- Rubric scores present but no concrete evidence (file paths, test names, command output) cited for any dimension.
- All dimensions scored 2+ yet the traceability matrix has gaps or missing entries.
- Self-review artifact is written in under a minute with no `reflection-log.md` consultation when one exists.
- Verdict is `pass` but findings section is empty — a meaningful self-review almost always surfaces at least one non-blocking observation.
- Prior `reflection-log.md` entries exist but are not addressed or referenced in the review.

## Failure Protocol

- do not award 2+ on a dimension without citing specific evidence
- do not mark a criterion as traced without identifying the actual test
- if the traceability matrix has gaps, say so — do not fill them with aspirational references
