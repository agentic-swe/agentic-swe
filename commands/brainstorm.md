# /brainstorm

Design-first exploration: Socratic refinement, optional visual companion, written `design.md` — aligned with the **design** phase. The `/brainstorm` label is a familiar entry point; behavior follows agentic-swe design-phase semantics.

## Prompt

You are running `/brainstorm` for: `$ARGUMENTS`

### Resolve context

1. If `$ARGUMENTS` is an existing work id under `.worklogs/<id>/`, use that folder. Otherwise treat `$ARGUMENTS` as the **task description** and either:
  - Tell the user to run `/work <task>` first (preferred for branch + state hygiene), **or**
  - Bootstrap a new work item using the **Start Mode** steps in `/work` (create `.worklogs/<id>/`, `state.json`, templates, branch) through `**feasibility`** and `**lean-track-check**`, then set `current_state` toward `**design**` per `CLAUDE.md` (invoke `/check transition` before changing state).
2. Read root `CLAUDE.md` and execute `**${CLAUDE_PLUGIN_ROOT}/phases/design.md**` in full for this work item — including **Design Refinement** (one question at a time, 2–3 approaches, self-review checklist).
3. **Visual companion:** When UI or spatial exploration helps, start the local server documented in the design phase (`tools/brainstorm-server/`) and give the human the URL. Stop the server when done.
4. **Outputs:** Write `.worklogs/<id>/design.md` per artifact format. Do **not** skip human approval gates: present sections and obtain approval before claiming design is final.
5. **Stop line:** Do not enter `**implementation`** or `**lean-track-implementation**` unless the user explicitly switches to `/execute-plan` or `/work` continuation. You may stop after `design.md` is drafted and reviewed by the human, or proceed to `**design-review**` if the pipeline state allows and the user wants rigorous-track rigor.
6. Log actions in `audit.log` and `progress.md` per the operating loop.

