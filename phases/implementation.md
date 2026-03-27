# Implementation

## Mission

Take an approved design and carry it to logical completion with strong engineering discipline.

## Delegation

This phase delegates implementation work to `agents/developer.md`, optionally supplemented by specialized subagents.

### Pre-Delegation: Subagent Auto-Selection

Before spawning the developer agent:

1. Re-read `design.md`, `test-stubs.md` (if exists), `approval-feedback.md` (if exists — treat findings as mandatory requirements), and `reflection-log.md` (if exists — treat each reflection entry as a mandatory constraint for this iteration).
2. Read `## Subagent Signals` from `feasibility.md`.
3. If `subagent_auto_select` is enabled and `subagent-mode` is `full`, consult `phases/subagent-selection.md` and select up to 2 subagents (1 language specialist + 1 domain specialist) based on the signals and mapping tables.
4. If `budget_remaining` < 3, skip subagent selection to preserve budget.

### Spawning

5. Spawn `agents/developer.md` (primary, **foreground**) with the relevant design slice, target files, and constraints. Tell the developer agent it may itself spawn subagents per `phases/subagent-selection.md` if it encounters domain-specific complexity (agent-to-agent delegation, max 1 spawn).
6. Spawn selected subagent(s) in **background** with the advisory prompt from `phases/subagent-selection.md` (Advisory Mode). They run in parallel — developer is NOT blocked.
7. Consider `isolation: "worktree"` for safe experimentation.
8. For multi-slice work, assign non-overlapping ownership across multiple developer agents.

### Integration

9. When developer agent returns, write initial `implementation.md`.
10. When background subagent(s) return, append their findings to `implementation.md` under `## Specialist Advisory`.
11. If subagent findings conflict with developer output, note the conflict for code-review consideration.
12. Log all subagent spawns and results in `audit.log`.

## Required Output

Write `.claude/.work/<id>/implementation.md` following `templates/artifact-format.md`, with:

- files changed and summary of code changes
- edge cases handled and tests added
- design deviations and unresolved issues
- self-review findings

Apply `templates/evidence-standard.md` throughout.
