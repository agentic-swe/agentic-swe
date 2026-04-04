# GitHub Copilot CLI Tool Mapping

Maps agentic-swe concepts to **GitHub Copilot** CLI / agent surfaces (workspace-assisted coding). Copilot does not ship agentic-swe slash commands; treat pipeline markdown (or summaries from **`CLAUDE.md`**) as instructions to follow explicitly.

## Core mapping

| agentic-swe Concept | Copilot Equivalent | Notes |
|---------------------|--------------------|-------|
| Hypervisor loop | Copilot agent session | You (or the agent) still own `state.json`, transitions, and gates per `CLAUDE.md`. |
| Agent delegation (developer, PR manager, etc.) | Copilot **agent** model / multi-step agent mode | Use for focused implementation or review tasks; paste scope + paths from phase prompts. |
| Panel review (3-way) | Three sequential or parallel agent requests | Same content as spawning three specialists; merge into one `design-panel-review.md`-style artifact. |
| Read / list / edit workspace | Copilot workspace tools | File read, search, and edits against the open repo; align paths with **`${CLAUDE_PLUGIN_ROOT}/`** when using the Claude Code plugin layout. |
| Terminal commands | Copilot shell / integrated terminal | Run tests, lint, install per project docs; capture output in validation artifacts. |
| Git status / branch / PR flow | Copilot **git** integration + `gh` | Align with `${CLAUDE_PLUGIN_ROOT}/agents/git-operations-agent.md` and `${CLAUDE_PLUGIN_ROOT}/references/github-workflow.md`. |
| Slash commands | Not native | **Invoke:** reference `${CLAUDE_PLUGIN_ROOT}/commands/*.md` text in the prompt or open file side-by-side. |
| Phase execution | Open `${CLAUDE_PLUGIN_ROOT}/phases/<state>.md` | Treat each phase file as a structured prompt block to complete before updating state. |
| Repo snapshot | `/repo-scan` equivalent | Manually glob + summarize or run project’s scan script if present; document evidence. |
| MCP | Copilot MCP (when configured) | Optional; same rules as other platforms—verify server availability before relying on it. |

## Practical workflow

1. Load work id from `.worklogs/` and read `state.json`.
2. Paste or attach the matching phase prompt from `${CLAUDE_PLUGIN_ROOT}/phases/`.
3. Use Copilot agent for heavy coding; keep artifact updates in the work folder.

## Source of truth

`CLAUDE.md` and `${CLAUDE_PLUGIN_ROOT}/templates/state.json` define required artifacts and transitions.
