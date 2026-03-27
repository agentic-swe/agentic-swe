# /plan-only

Plan work without implementing. Stops after the planning stages.

## Prompt

You are planning work for: `$ARGUMENTS`

Instructions:

1. If you are in a target repository and `.claude/CLAUDE.md` or the required `.claude/templates/` files are missing, run `/install` first.
2. Create `.claude/.work/<id>/state.json` from `templates/state.json`.
3. Fill in `work_id`, `task`, and keep `current_state: "initialized"`.
4. Execute only:
   - `feasibility`
   - `fast-path-check`
   - if full path is required (fast-path-check verdict is `complex`), `design`
5. If ambiguity is found, stop at `ambiguity-wait`.
6. If the task is fast-path eligible, stop after `fast-path-check` and record the recommendation instead of implementing.
7. Do not proceed into:
   - `verification`
   - `test`
   - `fast-implementation`
   - `implementation`
   - `code-review`
   - `validation`
   - `pr-created`
8. Return the work id, current state, and recommended next state.
