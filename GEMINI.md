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

Session hooks index changed project docs, refresh lessons and the style profile, and prime memory automatically. Treat the result as **advisory** — **`state.json`** and repo files are authoritative.

**`npm run memory-index`**, **`npm run memory-prime`**, **`npm run memory-reflect`**, and **`npm run cold-start-warm`** are bootstrap, diagnostic, and recovery commands. **`memory-import`** merges external graph JSON; **`memory-sliding-summary`** builds transcript sliding files. See root **`CLAUDE.md`** and [docs/specs/memory-graph.md](docs/specs/memory-graph.md).

For Google Antigravity, `agentic-swe setup --host antigravity` safely merges `.agents/hooks.json`: `PreInvocation` runs entry maintenance and `Stop` performs transcript capture/evolution. Gemini CLI uses this context file but does not expose the same Antigravity IDE hook contract.

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
| `npm run catalog:lint` | Lint **`agents/subagents`** (also part of **`npm run verify`** on a checkout) |
| `npm run catalog:route` | Headless top‑k routing for a query (`--mode auto`, `lexical`, or `semantic`) |
| `npm run catalog:index` | Build **`.agentic-swe/catalog-embeddings.json`** for semantic mode |

See [docs/specs/catalog-routing.md](docs/specs/catalog-routing.md) and the site page **[Catalog routing](https://agentic-swe.github.io/agentic-swe-site/docs/catalog-routing)** (source in [`agentic-swe-site`](https://github.com/agentic-swe/agentic-swe-site)).

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
