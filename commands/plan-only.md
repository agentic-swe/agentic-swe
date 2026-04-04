---
name: plan-only
description: "Plan work without implementing; stops after planning stages."
---

# /plan-only

Plan work without implementing. Stops after the planning stages.

## Prompt

You are planning work for: `$ARGUMENTS`

Instructions:

1. If you are in a target repository and `CLAUDE.md` or the required `${CLAUDE_PLUGIN_ROOT}/templates/` files are missing, run `/install` first.
2. Create `.worklogs/<id>/state.json` from `${CLAUDE_PLUGIN_ROOT}/templates/state.json`.
3. Fill in `work_id`, `task`, and keep `current_state: "initialized"`.
4. Execute only:
   - `feasibility`
   - `lean-track-check`
   - if the rigorous track is required (lean-track-check verdict is `complex`), `design`
5. If ambiguity is found, stop at `ambiguity-wait`.
6. If the task is lean-track eligible, stop after `lean-track-check` and record the recommendation instead of implementing.
7. Do not proceed into:
   - `verification`
   - `test-strategy`
   - `lean-track-implementation`
   - `implementation`
   - `code-review`
   - `validation`
   - `pr-creation`
8. Return the work id, current state, and recommended next state.
