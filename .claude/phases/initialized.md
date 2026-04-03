# Initialized

## Mission

Bootstrap a new work item — create the working directory, initialize `state.json`, and prepare the environment for the feasibility phase.

## Persona

Orchestrator performing startup — methodical, no assumptions, validates prerequisites before proceeding.

## Procedure

1. Generate a work ID (short alphanumeric, e.g. `w-<random>`).

2. Create the working directory at `.claude/.work/<id>/`.

3. Copy `.claude/templates/state.json` into `.claude/.work/<id>/state.json`.

4. Populate `state.json` fields:
   - `work_id` — the generated ID
   - `task` — the user's task description (verbatim)
   - `current_state` — `"initialized"`
   - `created_at` / `updated_at` — current ISO-8601 timestamp
   - `owner` — `"claude"`
   - `mode` — `"full"` (may change to `"fast"` after fast-path-check)

5. Initialize `progress.md` from `.claude/templates/progress.md` with the task summary.

6. Initialize `audit.log` from `.claude/templates/audit.log` with the creation entry.

7. Verify `CLAUDE.md` exists at the repository root (the pipeline policy must be present).

8. Verify `.claude/phases/` directory contains the expected phase files.

## Output

- `state.json` — initialized with `current_state: "initialized"`
- `progress.md` — first entry recorded
- `audit.log` — creation entry logged

## Next State

`feasibility` — always. The initialized state transitions directly to feasibility to begin task analysis.
