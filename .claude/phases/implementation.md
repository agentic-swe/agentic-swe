# Implementation

## Mission

Take an approved design and carry it to logical completion with strong engineering discipline.

## Delegation

This phase delegates implementation work to `.claude/agents/developer.md`, optionally supplemented by specialized subagents.

### Pre-Delegation: Tooling and Subagents

Before spawning the developer agent:

1. Re-read `design.md`, `test-stubs.md` (if exists), `approval-feedback.md` (if exists — treat findings as mandatory requirements), and `reflection-log.md` (if exists — treat each reflection entry as a mandatory constraint for this iteration).
2. If the task involves **external APIs**, **MCP servers**, **non-repo** systems, or **destructive shell** operations, consult `.claude/references/tooling-expectations.md` and ensure the developer agent scopes tool use accordingly.
3. Read `## Subagent Signals` from `feasibility.md`.
4. If `subagent_auto_select` is enabled and `subagent-mode` is `full`, consult `.claude/phases/subagent-selection.md` and select up to 2 subagents (1 language specialist + 1 domain specialist) based on the signals and mapping tables.
5. If `budget_remaining` < 3, skip subagent selection to preserve budget.

### Spawning

6. Spawn `.claude/agents/developer.md` (primary, **foreground**) with the relevant design slice, target files, and constraints. Tell the developer agent it may itself spawn subagents per `.claude/phases/subagent-selection.md` if it encounters domain-specific complexity (agent-to-agent delegation, max 1 spawn).
7. Spawn selected subagent(s) in **background** with the advisory prompt from `.claude/phases/subagent-selection.md` (Advisory Mode). They run in parallel — developer is NOT blocked.
8. Consider `isolation: "worktree"` for safe experimentation.
9. For multi-slice work, assign non-overlapping ownership across multiple developer agents.

### Integration

10. When developer agent returns, write initial `implementation.md`.
11. When background subagent(s) return, append their findings to `implementation.md` under `## Specialist Advisory`.
12. If subagent findings conflict with developer output, note the conflict for code-review consideration.
13. Log all subagent spawns and results in `audit.log`.

## Required Output

Write `.claude/.work/<id>/implementation.md` following `.claude/templates/artifact-format.md`, with:

- files changed and summary of code changes
- edge cases handled and tests added
- design deviations and unresolved issues
- self-review findings
- **## Capability gaps** (optional) — if the built-in subagent catalog did not cover required expertise, add a section using `.claude/templates/capability-gaps-section.md`; omit if none

Apply `.claude/templates/evidence-standard.md` throughout.
