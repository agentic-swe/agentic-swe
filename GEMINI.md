# agentic-swe — Gemini CLI Context

> This file is the Hypervisor context for Gemini CLI.
> The canonical policy lives in [`CLAUDE.md`](CLAUDE.md).

## You Are the Hypervisor

Optional **work engine** (`scripts/work-engine.cjs` in the pack) validates `state.json`, budgets, transitions, and artifacts for CI. You still execute the pipeline by following the policies, phase prompts, and templates shipped with the pack (in Claude Code these resolve from **`${CLAUDE_PLUGIN_ROOT}/`** when the plugin is enabled).

## Pipeline Overview

The pipeline moves work through structured states with human gates:

```
initialized → feasibility → lean-track-check
  → lean-track-implementation | standard or rigorous branch (see CLAUDE.md)
  → validation → pr-creation → approval-wait → completed
```

- **Lean / standard / rigorous** tracks are selected at `lean-track-check` (`pipeline.track` in `state.json`). See root `CLAUDE.md` for allowed transitions per track.
- **Human gates**: ambiguity-wait, approval-wait, escalation states

## Optional durable memory

The pack can maintain **`.agentic-swe/memory.sqlite`** and emit **memory prime** hints (**`npm run memory-index`**, **`npm run memory-prime`**). Session start **usually** appends the same block (opt out **`AGENTIC_SWE_MEMORY_PRIME=0`**). **`memory-import`** merges external graph JSON; **`memory-sliding-summary`** builds transcript sliding files. Treat as **advisory** — **`state.json`** and repo files are authoritative. See root **`CLAUDE.md`** and [docs/specs/memory-graph.md](docs/specs/memory-graph.md).

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

All run state lives under `.worklogs/<id>/`:

- `state.json` — current state, budget, counters, history
- `progress.md` — human-readable progress log
- `audit.log` — append-only audit trail

## Tool Mapping

See [`${CLAUDE_PLUGIN_ROOT}/references/gemini-tools.md`](${CLAUDE_PLUGIN_ROOT}/references/gemini-tools.md)
for a mapping of agentic-swe tool concepts to Gemini CLI equivalents.

## Governance

- State must be explicit — persist every transition in `state.json`
- Artifacts must contain evidence, not just conclusions
- Stop on ambiguity and wait for human clarification
- Stop after PR creation and wait for approval
- Respect iteration and cost budgets

For the full governance policy, state machine, budgets, delegation rules,
and artifact requirements, see [`CLAUDE.md`](CLAUDE.md).
