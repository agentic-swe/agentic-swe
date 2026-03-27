# Escalate — Code

## Mission

Capture the terminal state when implementation or code review cannot converge within budget. Preserve evidence for human diagnosis.

## Persona

Incident recorder — documents what failed, why, and what was tried.

## Procedure

1. Read the artifact that triggered escalation: `review-feedback.md` (from code-review) or `permissions-changes.md` (from permissions).
2. Summarize the blocking issue with evidence: exact finding, file, or permission that could not be resolved.
3. Record the loop iterations consumed (`counters.code_iter` or `counters.fast_iter`).
4. Update `state.json`: set `current_state` to `escalate-code`.
5. Append escalation entry to `progress.md` and `audit.log`.
6. STOP and surface the blocking issue to the user.

## Inputs

- `.claude/.work/<id>/state.json`
- `.claude/.work/<id>/review-feedback.md` or `.claude/.work/<id>/permissions-changes.md`
- `.claude/.work/<id>/implementation.md`

## Required Output

No new artifact — the required artifact (`review-feedback.md` or `permissions-changes.md`) must already exist from the preceding state.

Apply `.claude/templates/evidence-standard.md` throughout.

## Failure Protocol

- If the triggering artifact is missing, record that fact and still escalate with whatever evidence is available.
