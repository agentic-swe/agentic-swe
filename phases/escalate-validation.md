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

## Failure Protocol

- If `validation-results.md` is missing, record that fact and still escalate.
