# agentic-swe — Gemini CLI Context

> This file is the orchestration context for Gemini CLI.
> The canonical policy lives in [`CLAUDE.md`](CLAUDE.md).

## You Are the Orchestrator

There is no runtime engine. You execute the pipeline by following the
policies, phase prompts, and templates under `.claude/`.

## Pipeline Overview

The pipeline moves work through structured states with human gates:

```
initialized → feasibility → lean-track-check
  → lean-track-implementation | standard or rigorous branch (see CLAUDE.md)
  → validation → pr-creation → approval-wait → completed
```

- **Lean / standard / rigorous** tracks are selected at `lean-track-check` (`pipeline.track` in `state.json`). See root `CLAUDE.md` for allowed transitions per track.
- **Human gates**: ambiguity-wait, approval-wait, escalation states

## Key Commands

| Command | Purpose |
|---------|---------|
| `/work <desc>` | Start or resume a work item |
| `/plan-only` | Feasibility + design without implementation |
| `/check budget` | Verify budget before a phase |
| `/check transition` | Validate a state transition |
| `/check artifacts` | Confirm required artifacts exist |
| `/repo-scan` | Snapshot codebase structure |
| `/test-runner` | Run detected test suites |
| `/lint` | Run linters in check mode |
| `/subagent` | Browse and invoke specialist agents |

## State and Artifacts

All run state lives under `.claude/.work/<id>/`:

- `state.json` — current state, budget, counters, history
- `progress.md` — human-readable progress log
- `audit.log` — append-only audit trail

## Tool Mapping

See [`.claude/references/gemini-tools.md`](.claude/references/gemini-tools.md)
for a mapping of agentic-swe tool concepts to Gemini CLI equivalents.

## Governance

- State must be explicit — persist every transition in `state.json`
- Artifacts must contain evidence, not just conclusions
- Stop on ambiguity and wait for human clarification
- Stop after PR creation and wait for approval
- Respect iteration and cost budgets

For the full governance policy, state machine, budgets, delegation rules,
and artifact requirements, see [`CLAUDE.md`](CLAUDE.md).
