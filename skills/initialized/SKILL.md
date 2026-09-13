---
name: initialized
description: "Pipeline phase skill for state `initialized`. Use when current_state is initialized."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/initialized.md"
---

# Initialized

## Mission

Bootstrap a new work item — create the working directory, initialize `state.json`, and prepare the environment for the feasibility phase.

## Persona

Hypervisor performing startup — methodical, no assumptions, validates prerequisites before proceeding.

## Procedure

1. Generate a work ID (short alphanumeric, e.g. `w-<random>`).

2. Create the working directory at `.worklogs/<id>/`.

3. Copy `${CLAUDE_PLUGIN_ROOT}/templates/state.json` into `.worklogs/<id>/state.json`.

4. Populate `state.json` fields:
   - `work_id` — the generated ID
   - `task` — the user's task description (verbatim)
   - `current_state` — `"initialized"`
   - `created_at` / `updated_at` — current ISO-8601 timestamp
   - `owner` — `"claude"`
   - `mode` — `"full"` (may change to `"lean"` after lean-track-check routes to the lean track)

5. Initialize `progress.md` from `${CLAUDE_PLUGIN_ROOT}/templates/progress.md` with the task summary.

6. Initialize `audit.log` from `${CLAUDE_PLUGIN_ROOT}/templates/audit.log` with the creation entry.

7. Verify `CLAUDE.md` exists at the repository root (the pipeline policy must be present).

8. Verify `${CLAUDE_PLUGIN_ROOT}/phases/` directory contains the expected phase files.

## Output

- `state.json` — initialized with `current_state: "initialized"`
- `progress.md` — first entry recorded
- `audit.log` — creation entry logged

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "I'll set up `state.json` later — let me jump straight to feasibility." | Skipping initialization means no audit trail, no budget tracking, and no valid transition history from the start. |
| "The work directory structure is obvious; I don't need to verify templates." | Template drift or missing files cause silent failures downstream — verification catches this at near-zero cost. |
| "`CLAUDE.md` is always there; checking is redundant." | Pipeline policy can be absent in fresh clones, forks, or after accidental deletion — the check is a one-line safeguard. |

## Red Flags

- `state.json` not created before any transition out of `initialized` — the pipeline has no state to track.
- `progress.md` or `audit.log` missing after initialization — downstream phases will have no history to append to.
- Work ID generated but `.worklogs/<id>/` directory not actually created on disk.
- `state.json` created but `current_state` is not `"initialized"` — incorrect bootstrapping.
- Initialization skips the `CLAUDE.md` existence check and proceeds into a repo without pipeline policy.

## Next State

`feasibility` — always. The initialized state transitions directly to feasibility to begin task analysis.
