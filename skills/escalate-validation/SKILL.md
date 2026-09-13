---
name: escalate-validation
description: "Pipeline phase skill for state `escalate-validation`. Use when current_state is escalate-validation."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/escalate-validation.md"
---

# Escalate — Validation

## Mission

Capture the terminal state when validation cannot pass and the failure is not a code defect resolvable by returning to implementation. Preserve evidence for human diagnosis.

## Persona

Incident recorder — documents what failed, why, and what was tried.

## Procedure

1. Read `validation-results.md`.
2. Summarize the blocking validation failure with evidence: exact check, command, or environment issue.
3. Record iteration counts from `state.json`.
4. Update `state.json`: set `current_state` to `escalate-validation`.
5. Append escalation entry to `progress.md` and `audit.log`.
6. STOP and surface the blocking issue to the user.

## Inputs

- `.worklogs/<id>/state.json`
- `.worklogs/<id>/validation-results.md`

## Required Output

No new artifact — `validation-results.md` must already exist.

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Three-Strike Rule

Per `${CLAUDE_PLUGIN_ROOT}/references/debugging-playbook.md`: if 3 fix attempts fail on the same root cause (same symptom, same area, three different patches that do not resolve it), the mental model is wrong. Stop fixing and escalate to human with evidence of all three attempts, what each tried, and why each failed. Do not consume additional budget on a fourth attempt.

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "Let me retry one more time — it might be a flake." | The Three-Strike Rule exists for this: three attempts on the same root cause means the mental model is wrong, not the luck. |
| "Escalation will slow the whole pipeline down." | A broken validation that loops indefinitely costs more than a clean escalation with evidence. |
| "The test failure is in infrastructure, not my code." | Environment vs. code distinction is exactly what this phase must document — escalate with that classification, don't suppress it. |
| "I'll mark it as a known issue and proceed." | Proceeding past a failing validation without escalation violates the gate — known issues must still be surfaced to the human. |

## Red Flags

- Same test failure appears across 3+ consecutive attempts with no change in approach or evidence of a different hypothesis.
- Escalation triggered but `validation-results.md` contains no command output or exit codes — only narrative descriptions.
- Iteration counts in `state.json` do not match the number of attempts documented in artifacts.
- Escalation entry omits classification of the failure (code defect vs. test defect vs. environment defect).
- Budget consumed on retries exceeds the cost of the original implementation phase.

## Failure Protocol

- If `validation-results.md` is missing, record that fact and still escalate.
