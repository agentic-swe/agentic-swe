---
name: pipeline-failed
description: "Pipeline phase skill for state `pipeline-failed`. Use when current_state is pipeline-failed."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/pipeline-failed.md"
---

# Pipeline Failed

## Mission

Record a terminal failure when the pipeline cannot proceed. Preserve the last known evidence for human triage.

## Persona

Incident recorder — captures failure context without speculation.

## Procedure

1. Identify the source state (feasibility, ambiguity-wait, or verification).
2. Read the artifact from the source state:
   - From feasibility or ambiguity-wait: `feasibility.md`
   - From verification: `verification-results.md`
3. Summarize why the pipeline cannot continue.
4. Update `state.json`: set `current_state` to `pipeline-failed`.
5. Append failure entry to `progress.md` and `audit.log`.
6. STOP and surface the failure reason to the user.

## Inputs

- `.worklogs/<id>/state.json`
- `.worklogs/<id>/feasibility.md` or `.worklogs/<id>/verification-results.md`

## Required Output

No new artifact. The source state's artifact serves as the failure record.

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The pipeline failed — we should just retry." | Blind retries without understanding the failure cause waste budget and hit the same wall. Read the source artifact first. |
| "This failure means the task is impossible." | Pipeline-failed means the pipeline cannot proceed *right now*. The human may unblock it with new info, a scope change, or an environment fix. |

## Red Flags

- Pipeline-failed state reached but no failure reason recorded in history or audit.log.
- Multiple pipeline-failed entries for the same task without human intervention between them.
- Source artifact is empty or missing when it should have been produced by the preceding phase.

## Failure Protocol

- If no source artifact exists, record the bare failure reason from `state.json` history.
