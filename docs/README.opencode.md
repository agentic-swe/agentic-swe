# agentic-swe — OpenCode User Guide

## Overview

agentic-swe is an autonomous software engineering pipeline with structured
phases, human gates, and 135+ specialist agents. This guide covers running
it inside OpenCode via the ESM plugin.

## Installation

See [`.opencode/INSTALL.md`](../.opencode/INSTALL.md) for setup steps.

1. Run `npx agentic-swe` in your target repo
2. Add the plugin entry to `opencode.json`
3. Copy or symlink the plugin file

## How the Plugin Works

The plugin does two things:

- **`config` hook** — registers `.claude/` subdirectories (commands, phases,
  agents, templates, references) so OpenCode can discover them.
- **`experimental.chat.messages.transform`** — prepends the full orchestration
  policy from `CLAUDE.md` as a system message, ensuring every chat session
  follows the pipeline state machine.

## Tool Mapping

| agentic-swe Concept | OpenCode Equivalent |
|----------------------|---------------------|
| Agent tool (subagent spawn) | `opencode.agent.spawn` |
| Bash tool | `opencode.shell.exec` |
| Read / Write / Edit | `opencode.file.*` |
| TodoWrite | `opencode.tasks` (if available) |
| WebSearch / WebFetch | `opencode.web.*` (if available) |

## Usage

Start a work item:

```
/work <task description>
```

The pipeline follows: feasibility → design → implementation → review →
validation → PR creation. Human gates pause at ambiguity and approval.

### Key Commands

| Command | Purpose |
|---------|---------|
| `/work <desc>` | Start or resume a work item |
| `/plan-only` | Feasibility + design only |
| `/check budget` | Verify remaining budget |
| `/check transition` | Validate state transitions |
| `/repo-scan` | Snapshot codebase structure |
| `/test-runner` | Run test suites |
| `/subagent` | Browse specialist agents |

## Pipeline State

All run state lives under `.claude/.work/<id>/`:

- `state.json` — machine state, budget, counters
- `progress.md` — human-readable log
- `audit.log` — append-only audit trail

## Troubleshooting

**Plugin not loading:** Ensure `opencode.json` contains the plugin entry
and the path to `agentic-swe.js` is correct.

**Policy not injected:** Check that `CLAUDE.md` exists at the repo root.
The plugin reads it at chat startup.

**Commands missing:** Verify `.claude/commands/` exists and contains `.md`
files. Re-run `npx agentic-swe` if the directory is incomplete.
