# Implementation

## Mission

Take an approved design and carry it to logical completion with strong engineering discipline.

## Delegation

This phase delegates implementation work to `agents/developer.md`. The orchestrator should:

1. Re-read `design.md`, `test-stubs.md` (if exists), `approval-feedback.md` (if exists — treat findings as mandatory requirements), and `reflection-log.md` (if exists — treat each reflection entry as a mandatory constraint for this iteration) before delegating.
2. Spawn the developer agent with the relevant design slice, target files, and constraints.
3. Consider `isolation: "worktree"` for safe experimentation.
4. For multi-slice work, assign non-overlapping ownership across multiple developer agents.
5. Integrate results and record findings.

## Required Output

Write `.claude/.work/<id>/implementation.md` following `templates/artifact-format.md`, with:

- files changed and summary of code changes
- edge cases handled and tests added
- design deviations and unresolved issues
- self-review findings

Apply `templates/evidence-standard.md` throughout.
