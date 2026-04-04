# agentic-swe — Hypervisor policy

> This file exists for Codex and generic agent platform compatibility.
> The canonical policy lives in [`CLAUDE.md`](CLAUDE.md).

## Pipeline Summary

agentic-swe is an autonomous software engineering pipeline. You are the
**Hypervisor** — there is no runtime engine. Execute the pipeline by following
the policies, phase prompts, and templates under **`${CLAUDE_PLUGIN_ROOT}/`** when the **agentic-swe** Claude Code plugin is enabled. Per-work state lives in **`.worklogs/<id>/`** in the project under edit.

### State Machine (abbreviated)

```
initialized → feasibility → lean-track-check → branch by pipeline.track → … → validation → pr-creation → approval-wait → completed
```

- **Lean track** (`pipeline.track`: `lean`): skips full design flow; uses `lean-track-implementation`
- **Standard track** (`standard`): design + verification + test-strategy + implementation + self-review → validation; skips design panel, `design-review`, `code-review`, and `permissions-check`
- **Rigorous track** (`rigorous`): full governance — design, design-review, verification, test-strategy, implementation, self-review, code-review, permissions-check
- **Human gates**: ambiguity-wait, approval-wait, and escalation states

### Available Commands

| Command | Purpose |
|---------|---------|
| `/work <desc>` | Start or resume a work item |
| `/plan-only` | Feasibility and design only — no implementation |
| `/brainstorm` | Design-first exploration (design phase + optional visual server) |
| `/write-plan` | Refine `implementation.md` plan without coding |
| `/execute-plan` | Execute the plan via implementation / lean-track-implementation |
| `/author-pipeline` | Extend phases, commands, agents, templates safely |
| `/check budget` | Verify budget before a phase |
| `/check transition` | Validate a state transition |
| `/check artifacts` | Confirm required artifacts exist |
| `/evaluate-work` | Inspect work item health |
| `/repo-scan` | Snapshot codebase structure |
| `/test-runner [scope]` | Run detected test suites |
| `/lint [scope]` | Run linters in check mode |
| `/subagent` | Browse and invoke specialist agents |

### Key Directories

- `${CLAUDE_PLUGIN_ROOT}/commands/` — slash command definitions (per [Claude Plugins reference](https://code.claude.com/docs/en/plugins-reference#skills), plugins may use `commands/*.md` or `skills/<name>/SKILL.md`; this pack uses **`commands/`** only)
- `${CLAUDE_PLUGIN_ROOT}/phases/` — phase prompts (one per pipeline state)
- `${CLAUDE_PLUGIN_ROOT}/agents/` — specialist agent prompts (135+ subagents)
- `${CLAUDE_PLUGIN_ROOT}/templates/` — state, progress, and evidence templates
- `${CLAUDE_PLUGIN_ROOT}/references/` — authoritative tool and process references

### Governance

For the full governance policy, state machine, budgets, delegation rules,
and artifact requirements, see [`CLAUDE.md`](CLAUDE.md).

### Git branching (this repository)

PR flow uses a **UAT gate**: work merges to **`uat`** first, then **`uat` → `main`** after UAT passes; **`hotfix/*`** may open PRs directly to **`main`**. Details: [`.cursor/rules/development-branch-workflow.mdc`](.cursor/rules/development-branch-workflow.mdc).
