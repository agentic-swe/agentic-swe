---
name: implementation
description: "Pipeline phase skill for state `implementation`. Use when current_state is implementation."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-phase-anatomy"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/implementation.md"
---

# Implementation

## Mission

Take an approved design and carry it to logical completion with strong engineering discipline.

## Delegation

This phase delegates implementation work to `${CLAUDE_PLUGIN_ROOT}/agents/developer-agent.md`, optionally supplemented by specialized subagents.

### TDD Mode

When `state.json.pipeline.tdd_mode` is `true`, the developer agent must follow red-green-refactor discipline per `${CLAUDE_PLUGIN_ROOT}/references/tdd-discipline.md`. This means: run test stubs first to capture failing output, write minimum code to pass, then refactor. The resulting `implementation.md` must include a `## TDD Evidence` section with verbatim red/green output. See `${CLAUDE_PLUGIN_ROOT}/references/tdd-examples.md` for concrete patterns.

### Plan Quality

The implementation plan inside `implementation.md` must meet the quality bar defined in `${CLAUDE_PLUGIN_ROOT}/references/plan-quality-bar.md`. Every step must have exact file paths, complete code snippets, and verification commands with expected output. Use `${CLAUDE_PLUGIN_ROOT}/references/task-decomposition-guide.md` to decompose work into 2-5 minute steps. A plan that a fresh developer cannot follow without asking questions is incomplete.

### Parallel dispatch (multi-domain / multi-slice)

When implementation spans **independent domains** (e.g. frontend + backend), **multiple non-overlapping slices**, or parallel advisory/review fan-out, consult `${CLAUDE_PLUGIN_ROOT}/references/parallel-dispatch.md` for when to parallelize, prompt structure (scope, goal, constraints, expected output), and post-merge integration (conflict check, full tests, sequential rework on conflicts).

### Context Pack

Before any delegation, produce a **Context Pack** per `${CLAUDE_PLUGIN_ROOT}/templates/context-pack.md` (validated against `${CLAUDE_PLUGIN_ROOT}/schemas/context-pack.schema.json`). Include rules summary, scope files with line ranges, patterns to follow, constraints, and verification commands. See `${CLAUDE_PLUGIN_ROOT}/references/context-engineering.md` for the five-level hierarchy and trust levels.

### Source-Driven Development

When the implementation introduces or relies on external library/framework APIs, apply `${CLAUDE_PLUGIN_ROOT}/references/source-driven-development.md`: mark API claims as `VERIFIED:` (with source URL) or `UNVERIFIED:` (with confidence and risk). Reviewers will flag unmarked API calls.

### Deprecation and Removal

When the work item **removes** code, deprecates an interface, or replaces one library with another, produce a **Removal Manifest** per `${CLAUDE_PLUGIN_ROOT}/references/deprecation-and-migration.md` inside `implementation.md`. Apply the Chesterton's Fence rule before removing code whose purpose is unclear.

### Slicing Strategy

Choose a slicing strategy per `${CLAUDE_PLUGIN_ROOT}/references/slicing-strategies.md` (vertical / contract-first / risk-first). Each slice must leave the system compilable and testable. The scope-creep check (`${CLAUDE_PLUGIN_ROOT}/scripts/lib/scope/diff-scope-check.cjs`) compares the actual diff against declared files — undeclared edits fail CI.

### Pre-Delegation: Tooling and Subagents

Before spawning the developer agent:

0. **Descent-first (engine + L0 replay)**: Entering `implementation` / `lean-track-implementation` runs `implementation-descent` (fingerprint-scoped L0/L1 only; never skip a new feature because `npm test` already passes). The engine writes `.worklogs/<id>/context-pack.json` (schema-valid, includes evaluated `muscle_memory`). If `state.metrics.skip_llm_exploration` is true, record `## Descent replay` in `implementation.md` and skip redundant LLM exploration. Otherwise run `node ${CLAUDE_PLUGIN_ROOT}/scripts/work-engine.cjs descent-try --work-dir .worklogs/<id>` (optional `--verify`, optional `--files` comma-list when fingerprints are task keys rather than design paths). On **ESCALATE**, continue below. Pass `context-pack.json` to any delegate.

1. Re-read `design.md`, `test-stubs.md` (if exists), `approval-feedback.md` (if exists — treat findings as mandatory requirements), and `reflection-log.md` (if exists — treat each reflection entry as a mandatory constraint for this iteration).
2. If the task involves **external APIs**, **MCP servers**, **non-repo** systems, or **destructive shell** operations, consult `${CLAUDE_PLUGIN_ROOT}/references/tooling-expectations.md` and ensure the developer agent scopes tool use accordingly.
3. Read `## Subagent Signals` from `feasibility.md`.
4. If `subagent_auto_select` is enabled and `subagent-mode` is `full`, consult `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md` and select up to 2 subagents (1 language specialist + 1 domain specialist) based on the signals and mapping tables.
5. If `budget.budget_remaining` is below **`budget.policy.subagent_skip_below_budget_remaining`** (when set; else **3**), skip subagent selection to preserve budget.

### Working Directory

If `state.json.pipeline.worktree_path` is set, all file operations and commands in this phase run inside that directory instead of the main checkout. Pass the worktree path to the developer agent and any subagents so they operate in the correct location.

### Spawning

6. Spawn `${CLAUDE_PLUGIN_ROOT}/agents/developer-agent.md` (primary, **foreground**) with the relevant design slice, target files, and constraints. Tell the developer agent it may itself spawn subagents per `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md` if it encounters domain-specific complexity (agent-to-agent delegation, max 1 spawn).
7. Spawn selected subagent(s) in **background** with the advisory prompt from `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md` (Advisory Mode). They run in parallel — developer is NOT blocked.
8. Consider `isolation: "worktree"` for safe experimentation.
9. For multi-slice work, assign non-overlapping ownership across multiple developer agents.

### Integration

10. When developer agent returns, write initial `implementation.md`.
11. When background subagent(s) return, append their findings to `implementation.md` under `## Specialist Advisory`.
12. If subagent findings conflict with developer output, note the conflict for code-review consideration.
13. Log all subagent spawns and results in `audit.log`.

## Required Output

Write `.worklogs/<id>/implementation.md` following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, with:

- files changed and summary of code changes
- edge cases handled and tests added
- design deviations and unresolved issues
- self-review findings
- **## Capability gaps** (optional) — if the built-in subagent catalog did not cover required expertise, add a section using `${CLAUDE_PLUGIN_ROOT}/templates/capability-gaps-section.md`; omit if none

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll add tests after the code works." | Deferred tests rarely get written, and untested code hides regressions. Writing the decisive test first surfaces design flaws before they compound. |
| "This small addition is closely related — I'll include it now." | Scope creep during implementation bypasses the design gate. Unplanned additions lack feasibility review, risk assessment, and test strategy. |
| "The plan is clear enough in my head — I don't need to decompose further." | An implementation plan that cannot be followed by a fresh developer is incomplete. Implicit steps become skipped steps under pressure. |
| "The reflection log mentions this, but my approach is different enough." | If the reflection log identifies a failure pattern, the next iteration must address it explicitly. A different-looking approach that ignores the root cause will hit the same failure. |
| "Edge cases can be handled in a follow-up." | Edge cases deferred to follow-ups are edge cases shipped to production. If the design identified them, implementation must handle or explicitly document the risk. |
| "The existing tests cover this path already." | Existing tests cover existing behavior. New code that changes control flow, adds branches, or modifies data shapes needs new assertions, not inherited confidence. |

## Red Flags

- Implementation artifact lists files changed but no tests added or updated for behavioral changes.
- Developer agent was spawned without a context pack or with a prompt that omits `reflection-log.md` findings.
- Code changes touch files outside the scope defined in `design.md` without documenting the deviation.
- The implementation plan has steps with no verification command or expected output.
- Multiple subagents were spawned when budget remaining was below the skip threshold.
