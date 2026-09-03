---
name: swe-tui
description: "Command skill swe-tui."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-verify-sanity"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "command"
  source: "commands/swe-tui.md"
---

# /swe-tui

Launch a terminal-based live cockpit for monitoring pipeline execution.

## Usage

```
/swe-tui [--work-dir <path>] [--cwd <repo-path>]
```

## Behavior

1. Discover the active work item from `.worklogs/` (newest non-completed, or specified via `--work-dir`).
2. Start a terminal UI displaying:
   - **State bar**: current state, track, budget remaining, cost used
   - **History panel**: scrollable list of transitions with timestamps
   - **Gate panel**: active gate prompts (ambiguity-wait, approval-wait) with resolution controls
   - **Event stream**: real-time events from the pipeline (state changes, subagent spawns, doubt findings)
   - **Budget burn**: visual cost/token chart
3. Events are consumed via the dashboard event stream (WebSocket from `swe-dashboard` or file-watch on `state.json`).
4. Gate resolution: when a gate event appears, the TUI prompts the human for input and writes the resolution to the appropriate artifact.

## Constraints

- Read-only by default — gate resolution requires explicit `--interactive` flag.
- Falls back to polling `state.json` every 2 seconds if WebSocket is unavailable.
- Designed for SSH/headless environments where the browser dashboard is not accessible.

## Implementation Notes

Uses Node built-in `readline` for minimal dependency. Implementation: `${CLAUDE_PLUGIN_ROOT}/scripts/swe-tui-server.cjs`.

Exported API for tests and programmatic use:
- `formatBudgetBar(remaining, total, width)` → string
- `discoverWorkDir(cwd)` → string|null
- `discoverAllWorkDirs(cwd)` → string[]
- `renderWorkItem(state, opts)` → string
- `chooseLayout(itemCount, termWidth)` → 'side-by-side'|'stacked'

ASCII mascot is rendered only when `process.stdout.isTTY === true` and `NO_COLOR` is not set. CI/pipe environments get plain-text output automatically.
