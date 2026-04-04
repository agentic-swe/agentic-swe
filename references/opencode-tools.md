# OpenCode Tool Mapping

Maps agentic-swe concepts to **OpenCode**-style agent tooling (tasks, skills, mentions, file/shell). Exact names vary by OpenCode build; this table is semantic.

## Core mapping

| agentic-swe Concept | OpenCode Equivalent | Notes |
|---------------------|----------------------|-------|
| Todo list / phase checklist | **todowrite** (or task tracker) | Mirror `progress.md` and state transitions; one task per concrete pipeline step. |
| Reusable procedure | **skill** | Map a skill to “run this phase/command”: body = condensed steps from `${CLAUDE_PLUGIN_ROOT}/commands/*.md` or `${CLAUDE_PLUGIN_ROOT}/phases/*.md`. |
| Invoke specialist by name | **@mention** dispatch | `@`-style routing ≈ Agent tool pointed at `${CLAUDE_PLUGIN_ROOT}/agents/subagents/<category>/<role>.md` or panel agents. |
| Core agent (git-ops, developer) | @mention + scoped prompt | Include file paths, success criteria, and “append to audit.log” style obligations from `CLAUDE.md`. |
| Read / write / patch files | OpenCode file tools | Same evidence standard: artifacts under `.worklogs/<id>/`. |
| Grep / glob / search | OpenCode search / workspace listing | Use for `/repo-scan`-like discovery when no slash runner exists. |
| Shell (npm, pytest, git) | OpenCode shell tool | Run from repo root; paste command output into `validation-results.md` when relevant. |
| Slash commands | Skill or scripted open of `${CLAUDE_PLUGIN_ROOT}/commands/` | No `/` parser required—load markdown and execute steps. |
| State machine | Manual `state.json` edits + history | OpenCode does not replace `CLAUDE.md`; it executes steps you schedule in tasks. |
| Web / fetch | OpenCode fetch / browse (if enabled) | Document sources in artifacts when external facts change the plan. |

## Suggested alignment

- **todowrite:** one item per “read phase → produce artifact → `/check` equivalent → transition”.
- **skill:** one skill per high-frequency command (`work`, `check`, `repo-scan` logic).
- **@mention:** route “security reviewer” → `${CLAUDE_PLUGIN_ROOT}/agents/panel/security-reviewer.md` (or selected subagent).

## Source of truth

`CLAUDE.md`, `${CLAUDE_PLUGIN_ROOT}/phases/`, and `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md`.
