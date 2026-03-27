# /evaluate-work

Inspect an existing work item and assess its health.

## Prompt

You are evaluating `.claude/.work/$ARGUMENTS/`.

Instructions:

1. Read `.claude/.work/<id>/state.json`.
2. Verify required artifacts exist for the current state using the artifact table in `CLAUDE.md`.
3. Check `timeout_at` for staleness.
4. Report:
   - current state
   - last transition (from history)
   - missing artifacts
   - gate status
   - budget status (remaining iterations, cost used vs budget)
   - loop counters
   - risk score and top items
   - whether the run is on fast path or full path
   - whether the run is at an escalation point
   - whether the work item is stale (past timeout_at)
5. If this check is requested as an active repair step, update the work item files directly.
