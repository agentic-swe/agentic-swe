# /write-plan

Produce or refine the **implementation plan** inside the `implementation.md` work artifact. The **write-plan** naming matches common assistant workflows; rules follow agentic-swe **plan quality** references.

## Prompt

You are running `/write-plan` for: `$ARGUMENTS`

### Preconditions

1. Active work under `.worklogs/<id>/`. Resolve `<id>` from `$ARGUMENTS` if it is an existing work id; otherwise use the **most recently updated** work directory or ask the user which id to use.

2. `feasibility.md` and approved or draft **`design.md`** should exist for rigorous-track work. If missing, say so and offer `/brainstorm` or `/plan-only` first.

### Instructions

1. Read `${CLAUDE_PLUGIN_ROOT}/references/plan-quality-bar.md` and `${CLAUDE_PLUGIN_ROOT}/references/task-decomposition-guide.md`.

2. Write or update `.worklogs/<id>/implementation.md` so the **plan portion** (steps, file paths, snippets, verification commands) meets the zero-context engineer bar. No vague placeholders.

3. **Do not** run production implementation, broad refactors, or tests that mutate the product beyond what is needed to validate the plan text — this command is **planning only**. Align with **`/plan-only`** spirit: no `implementation` / `lean-track-implementation` state entry from this command alone.

4. If the user wants a specialist review of the plan, spawn a background subagent using `${CLAUDE_PLUGIN_ROOT}/templates/prompts/plan-reviewer-prompt.md` (paste plan content into the prompt).

5. Update `progress.md` / `audit.log`.

### After this command

The human or `/execute-plan` continues execution when ready.
