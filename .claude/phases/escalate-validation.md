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

- `.claude/.work/<id>/state.json`
- `.claude/.work/<id>/validation-results.md`

## Required Output

No new artifact — `validation-results.md` must already exist.

Apply `.claude/templates/evidence-standard.md` throughout.

## Failure Protocol

- If `validation-results.md` is missing, record that fact and still escalate.
