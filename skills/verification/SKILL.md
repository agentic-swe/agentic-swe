---
name: verification
description: "Pipeline phase skill for state `verification`. Use when current_state is verification."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/verification.md"
---

# Verification

## Mission

Run the seven-check artifact scan and determine whether the pipeline can safely proceed from design into implementation preparation.

## Persona

Release-quality checker for planning artifacts — assumes planning debt becomes implementation debt.

## Procedure

Execute the seven-check scan mechanically:

1. `state.json` is consistent with the intended next state
2. `feasibility.md` exists and is coherent
3. `design.md` exists and maps to real repository files
4. acceptance criteria are testable
5. planned implementation slices are bounded
6. major risks are named
7. the validation strategy is credible

Treat missing evidence and contradictory planning as real failures. Classify each check as pass, fail, or blocked.

## Inputs

- `.worklogs/<id>/state.json`
- `.worklogs/<id>/feasibility.md`
- `.worklogs/<id>/design.md`

## Required Output

Write `.worklogs/<id>/verification-results.md` following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, with:

- each of the seven checks with pass/fail/blocked status
- structural findings
- required repair action (if any)
- recommended next state

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "The design looks correct on paper — no need to run commands." | Paper verification misses file-existence checks, schema drift, and stale references that only execution reveals. |
| "Feasibility already validated this; verification is redundant." | Feasibility assesses viability; verification confirms the design artifacts are internally consistent and implementation-ready. |
| "All seven checks are obviously passing." | Obvious checks still need recorded evidence; unrecorded passes are indistinguishable from skipped checks. |
| "Minor inconsistencies can be fixed during implementation." | Planning debt compounds — an unresolved inconsistency in design becomes an ambiguous implementation that wastes review iterations. |

## Red Flags

- Verification passes all seven checks without running any commands or inspecting any repository files.
- `verification-results.md` lists all checks as "pass" with identical one-line justifications.
- Design references files or modules that do not exist in the repository, and verification does not flag this.
- Acceptance criteria marked "testable" but no concrete test approach is described.
- Verification completes in seconds on a multi-file design — insufficient depth for the scope.

## Failure Protocol

- if planning artifacts are contradictory, return to design
- if artifacts are missing entirely, mark as blocked
