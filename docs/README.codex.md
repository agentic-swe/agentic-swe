# agentic-swe — Codex User Guide

## Overview

agentic-swe is an autonomous software engineering pipeline with structured
phases, human gates, and 135+ specialist agents. This guide covers running
it inside Codex.

## Installation

See [`.codex/INSTALL.md`](../.codex/INSTALL.md) for setup steps. The short
version: run `npx agentic-swe` in your target repo, then copy `AGENTS.md`
to the repo root.

## Usage

Start a work item:

```
/work <task description>
```

The pipeline progresses through: feasibility → design → implementation →
review → validation → PR creation. Human gates pause for your input at
ambiguity and approval checkpoints.

### Key Commands

| Command | Purpose |
|---------|---------|
| `/work <desc>` | Start or resume a work item |
| `/check budget` | Verify budget before a phase |
| `/check transition` | Validate a state transition |
| `/check artifacts` | Confirm required artifacts exist |
| `/plan-only` | Run feasibility and design without implementing |
| `/repo-scan` | Snapshot codebase structure |
| `/test-runner` | Run detected test suites |
| `/lint` | Run linters in check mode |

## Tool Mapping

| agentic-swe Concept | Codex Equivalent |
|----------------------|------------------|
| Agent tool (subagent spawn) | Codex agent dispatch / multi-agent |
| Bash tool | Codex shell execution |
| Read / Write / Edit | Codex file operations |
| TodoWrite | Codex task tracking (if available) |
| WebSearch / WebFetch | Codex web tools (if available) |

## Pipeline State

All state lives under `.claude/.work/<id>/`. Key files:

- `state.json` — machine-readable pipeline state
- `progress.md` — human-readable progress log
- `audit.log` — append-only audit trail

## Troubleshooting

**Pipeline not starting:** Ensure `AGENTS.md` exists at the repo root and
`.claude/` directory is present with phases, commands, and templates.

**Commands not recognized:** Codex must index `.claude/commands/`. Re-open
the workspace or check that the command files are accessible.

**Subagents unavailable:** Enable `multi_agent: true` in your Codex config.
Without it the pipeline runs single-agent, skipping delegation.

**State corruption:** Delete `.claude/.work/<id>/` and restart with `/work`.
