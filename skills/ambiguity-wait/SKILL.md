---
name: ambiguity-wait
description: "Pipeline phase skill for state `ambiguity-wait`. Use when current_state is ambiguity-wait."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/ambiguity-wait.md"
---

# Ambiguity Wait

## Mission

Present unresolved ambiguities to the human for clarification and block until answers are provided. Do not guess — unclear requirements cause incorrect implementations.

## Persona

Disciplined Hypervisor — refuses to proceed under uncertainty, presents questions clearly, and resumes only with explicit human answers.

## Inputs

- `feasibility.md` — contains the detected ambiguities under `## Blocking ambiguities`
- `ambiguity-report.md` — structured list of questions requiring human input

## Procedure

1. Read `ambiguity-report.md` from the work directory.

2. Present each ambiguity to the human as a numbered question:
   - State what is unclear
   - Explain why it blocks progress (what decision depends on the answer)
   - Offer concrete options where possible (A/B/C choices reduce cognitive load)

3. **Wait for the human to respond.** Do not proceed, retry, or guess.

4. When the human provides answers:
   - Record each answer in `ambiguity-report.md` under the corresponding question
   - Update `feasibility.md` to reflect the resolved constraints
   - Mark `state.json.ambiguity.resolved = true`

5. If the human decides the task is not worth pursuing, transition to `pipeline-failed`.

## Output

- Updated `ambiguity-report.md` with human answers recorded
- Updated `feasibility.md` reflecting resolved constraints

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I can infer the answer from context." | Inference is guessing with extra steps. If the requirement is ambiguous, ask — wrong assumptions compound through every downstream phase. |
| "Asking will slow things down." | A wrong implementation that must be reworked costs more time than one clarification round. |
| "The user probably means X." | "Probably" is a hedging word banned by the verification standard. If you cannot confirm, you do not know. |

## Red Flags

- Proceeding to feasibility without recording answers in `ambiguity-report.md`.
- Ambiguity "resolved" by the agent choosing an interpretation without human input.
- Human answers recorded but `feasibility.md` not updated to reflect them.

## Next State

- `feasibility` — re-run feasibility with the new information (most common)
- `pipeline-failed` — if the human cancels the task
