# agentic-swe — Orchestration Policy

> This file exists for Codex and generic agent platform compatibility.
> The canonical policy lives in [`CLAUDE.md`](CLAUDE.md).

## Pipeline Summary

agentic-swe is an autonomous software engineering pipeline. You are the
orchestrator — there is no runtime engine. Execute the pipeline by following
the policies, phase prompts, and templates under `.claude/`.

### State Machine (abbreviated)

```
initialized → feasibility → fast-path-check → [fast-path | full-path] → validation → pr-creation → approval-wait → completed
```

- **Fast path** (low-risk): skips design and code review
- **Full path** (complex): includes design, design-review, test-strategy, implementation, self-review, code-review, and permissions-check
- **Human gates**: ambiguity-wait, approval-wait, and escalation states

### Available Commands

| Command | Purpose |
|---------|---------|
| `/work <desc>` | Start or resume a work item |
| `/plan-only` | Feasibility and design only — no implementation |
| `/brainstorm` | Design-first exploration (design phase + optional visual server) |
| `/write-plan` | Refine `implementation.md` plan without coding |
| `/execute-plan` | Execute the plan via implementation / fast-path-implementation |
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

- `.claude/commands/` — slash command definitions
- `.claude/phases/` — phase prompts (one per pipeline state)
- `.claude/agents/` — specialist agent prompts (135+ subagents)
- `.claude/templates/` — state, progress, and evidence templates
- `.claude/references/` — authoritative tool and process references

### Governance

For the full governance policy, state machine, budgets, delegation rules,
and artifact requirements, see [`CLAUDE.md`](CLAUDE.md).
