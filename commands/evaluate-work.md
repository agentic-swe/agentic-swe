# /evaluate-work

Inspect an existing work item and assess its health.

## Prompt

You are evaluating `.worklogs/$ARGUMENTS/`.

Instructions:

1. Read `.worklogs/<id>/state.json`.
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
   - whether the run is on the lean track or rigorous track
   - whether the run is at an escalation point
   - whether the work item is stale (past timeout_at)
5. If this check is requested as an active repair step, update the work item files directly.
6. **Optional health scoring**: Compare `self-review.md` (if present) to `${CLAUDE_PLUGIN_ROOT}/templates/evaluation-rubric.md` — report any dimension still at 1 after rework limits, and whether `metrics-summary.md` exists under the work directory (optional file for cross-run metrics; not required by the state machine).

7. **Optional playbook signal**: If `docs/agentic-swe/PLAYBOOK.md` exists in the repo, mention the most recent entry’s “next time” line when summarizing risks for the same area of work.
