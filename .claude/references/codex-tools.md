# Codex Tool Mapping

Maps agentic-swe commands and tool concepts to **OpenAI Codex** (CLI / agent) equivalents. Codex has no built-in `/work` router; the orchestrator follows repo prompts manually.

## Core mapping

| agentic-swe Concept | Codex Equivalent | Notes |
|---------------------|------------------|-------|
| Agent tool (delegate phase work) | `spawn_agent` + `wait` | Use for bounded sub-tasks (e.g. developer, panel reviewer); collect results before transitioning pipeline state. |
| Background / parallel agents | Multiple `spawn_agent` then `wait` (or batch wait) | Mirror panel pattern: spawn reviewers, wait, synthesize into one artifact. |
| Plan updates during work | Codex **plan** tool | Maps to agentic-swe `update_plan`-style planning; keep steps aligned with `CLAUDE.md` state machine. |
| Read / search files | Codex file / search tools | Prefer repo-local reads over guessing paths. |
| Write / patch files | Codex apply-patch or file-edit tools | Match project style; evidence belongs in `.claude/.work/<id>/` artifacts. |
| Shell (test, lint, git) | Codex shell execution | Run from repo root; respect `.npmrc` and documented commands. |
| Slash commands (e.g. `/work`, `/check`) | No native slash UI | **Invoke:** open matching `.claude/commands/<name>.md` and execute its checklist as plain instructions. |
| Phase prompts | Read `.claude/phases/<state>.md` | Each file is the canonical procedure for that pipeline state. |
| Subagent prompts | `spawn_agent` with prompt = file body | Point agent at `.claude/agents/subagents/...` or core agents under `.claude/agents/`. |
| MCP / external tools | Codex MCP (if session enables) | Same governance as `tooling-expectations.md`: do not assume availability. |

## Quick invocation pattern

1. Read `.claude/.work/<id>/state.json` for `current_state`.
2. Open `.claude/phases/<current_state>.md` and `.claude/commands/check.md` (or specific `/check` docs) as needed.
3. Use `spawn_agent` for delegated work; `wait` before merging findings into artifacts.

## Source of truth

Pipeline policy: `CLAUDE.md`. Templates and artifact shapes: `.claude/templates/`.
