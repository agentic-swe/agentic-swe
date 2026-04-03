# Implementation

## Mission

Take an approved design and carry it to logical completion with strong engineering discipline.

## Delegation

This phase delegates implementation work to `.claude/agents/developer-agent.md`, optionally supplemented by specialized subagents.

### TDD Mode

When `state.json.pipeline.tdd_mode` is `true`, the developer agent must follow red-green-refactor discipline per `.claude/references/tdd-discipline.md`. This means: run test stubs first to capture failing output, write minimum code to pass, then refactor. The resulting `implementation.md` must include a `## TDD Evidence` section with verbatim red/green output. See `.claude/references/tdd-examples.md` for concrete patterns.

### Plan Quality

The implementation plan inside `implementation.md` must meet the quality bar defined in `.claude/references/plan-quality-bar.md`. Every step must have exact file paths, complete code snippets, and verification commands with expected output. Use `.claude/references/task-decomposition-guide.md` to decompose work into 2-5 minute steps. A plan that a fresh developer cannot follow without asking questions is incomplete.

### Parallel dispatch (multi-domain / multi-slice)

When implementation spans **independent domains** (e.g. frontend + backend), **multiple non-overlapping slices**, or parallel advisory/review fan-out, consult `.claude/references/parallel-dispatch.md` for when to parallelize, prompt structure (scope, goal, constraints, expected output), and post-merge integration (conflict check, full tests, sequential rework on conflicts).

### Pre-Delegation: Tooling and Subagents

Before spawning the developer agent:

1. Re-read `design.md`, `test-stubs.md` (if exists), `approval-feedback.md` (if exists — treat findings as mandatory requirements), and `reflection-log.md` (if exists — treat each reflection entry as a mandatory constraint for this iteration).
2. If the task involves **external APIs**, **MCP servers**, **non-repo** systems, or **destructive shell** operations, consult `.claude/references/tooling-expectations.md` and ensure the developer agent scopes tool use accordingly.
3. Read `## Subagent Signals` from `feasibility.md`.
4. If `subagent_auto_select` is enabled and `subagent-mode` is `full`, consult `.claude/phases/subagent-selection.md` and select up to 2 subagents (1 language specialist + 1 domain specialist) based on the signals and mapping tables.
5. If `budget_remaining` < 3, skip subagent selection to preserve budget.

### Working Directory

If `state.json.pipeline.worktree_path` is set, all file operations and commands in this phase run inside that directory instead of the main checkout. Pass the worktree path to the developer agent and any subagents so they operate in the correct location.

### Spawning

6. Spawn `.claude/agents/developer-agent.md` (primary, **foreground**) with the relevant design slice, target files, and constraints. Tell the developer agent it may itself spawn subagents per `.claude/phases/subagent-selection.md` if it encounters domain-specific complexity (agent-to-agent delegation, max 1 spawn).
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
