# Implicit routing (skill-like behavior without the Skill tool)

Hosts differ: some expose a **Skill** tool; agentic-swe uses **`CLAUDE.md`**, **slash commands**, and **phase prompts**. This document defines when the orchestrator should **recommend** a command or phase **before** writing production code—mirroring the **route-then-code** habit: choose a process step (phase or command) before editing production code.

## Preconditions (always)

1. **Active work** — If `.claude/.work/<id>/` exists, read `state.json` and follow the operating loop in `CLAUDE.md`. Do not ignore an in-progress work item.
2. **Install** — If `.claude/` or root `CLAUDE.md` is missing in the target repo, run `/install` (or `npx agentic-swe`) before routing.

## Intent → suggested entry

| Signals in user message | Suggested first action | Typical path |
|-------------------------|------------------------|--------------|
| Bug, regression, typo, “fix”, “broken”, single file | `/work <task>` | feasibility → fast-path-check → fast-path-implementation |
| “New feature”, “add auth”, “redesign”, multiple modules, unclear architecture | `/work <task>` | feasibility → design → … |
| “Design only”, “spec”, “no code yet”, exploration | `/plan-only` or `/brainstorm` | feasibility → design (plan-only stops per command) |
| “Follow the plan”, “execute plan”, plan artifact exists | `/execute-plan` (same work id) | implementation or fast-path-implementation |
| “Improve the plan”, “break down tasks” | `/write-plan` | refine `implementation.md` artifact |
| Visual layout, UI flow, “show me options” | `/brainstorm` (optional: local visual server per design phase) | design artifact |
| New command, phase, agent, template | `/author-pipeline` | contributor workflow (no state transition) |

## Rules

- **Do not skip human gates** — `ambiguity-wait`, design approval, `approval-wait` stay mandatory when the state machine requires them.
- **Ambiguity** — If requirements are unclear, transition to `ambiguity-wait` (or ask one clarifying question at a time in design) instead of guessing.
- **Budget** — Invoke `/check budget` before expensive phases; if budget is low, skip optional background subagents per `CLAUDE.md`.
- **Session hook** — On session start, Claude Code runs `hooks/session-start`, which injects a short copy of this routing hint; the canonical detail lives here.

## Relationship to “skills”

There is no separate Skill registry. **Phases** under `.claude/phases/` and **commands** under `.claude/commands/` are the source of truth. Treat high-value references (TDD, debugging, verification) as **consulted during the matching phase**, not as a parallel plugin layer.
