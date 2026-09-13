---
name: escalate-code
description: "Pipeline phase skill for state `escalate-code`. Use when current_state is escalate-code."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/escalate-code.md"
---

# Escalate — Code

## Mission

Capture the terminal state when implementation or code review cannot converge within budget. Preserve evidence for human diagnosis.

## Persona

Incident recorder — documents what failed, why, and what was tried.

## Procedure

1. Read the artifact that triggered escalation: `review-feedback.md` (from code-review) or `permissions-changes.md` (from permissions-check).
2. Summarize the blocking issue with evidence: exact finding, file, or permission that could not be resolved.
3. Record the loop iterations consumed (`counters.code_iter` or `counters.lean_iter`).
4. Update `state.json`: set `current_state` to `escalate-code`.
5. Append escalation entry to `progress.md` and `audit.log`.
6. STOP and surface the blocking issue to the user.

## Inputs

- `.worklogs/<id>/state.json`
- `.worklogs/<id>/review-feedback.md` or `.worklogs/<id>/permissions-changes.md`
- `.worklogs/<id>/implementation.md`

## Required Output

No new artifact — the required artifact (`review-feedback.md` or `permissions-changes.md`) must already exist from the preceding state.

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "Escalation means I failed." | Escalation is a designed exit — it preserves budget and surfaces blockers that require human judgment. Suppressing it wastes iterations. |
| "One more attempt might fix it." | If the budget is exhausted or the same root cause persists across iterations, another attempt is definitionally non-converging. |
| "I'll escalate but skip the evidence summary." | An escalation without concrete evidence (exact finding, file, iteration history) forces the human to re-diagnose from scratch. |
| "The issue is obvious, so I don't need to document what was tried." | Future sessions and other agents cannot learn from undocumented attempts — the audit trail is for them, not just for now. |

## Red Flags

- Escalation triggered but no concrete evidence of what blocked progress — only vague statements like "could not resolve."
- `review-feedback.md` or `permissions-changes.md` missing at escalation time despite being required from the preceding state.
- Loop counters show budget remaining but escalation was triggered anyway — over-eager escalation skips valid rework.
- Escalation entry in `audit.log` lacks iteration counts or artifact references.
- Same escalation pattern repeated across multiple work items without a playbook entry or systemic fix.

## Failure Protocol

- If the triggering artifact is missing, record that fact and still escalate with whatever evidence is available.
