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

## Next State

`feasibility` — always. The initialized state transitions directly to feasibility to begin task analysis.
