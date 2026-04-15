# Agentic SWE

Autonomous software engineering pipeline for Claude Code with 135+ specialized subagents.

Claude Code becomes a full SWE pipeline -- from task analysis through implementation, review, and PR creation -- with no runtime code. Everything is pure markdown: policies, phase prompts, agent definitions, and templates.

## Quick Start

**Claude Code (recommended):** add this repository as a **plugin marketplace**, install **`agentic-swe@agentic-swe-catalog`**, then open your target project in Claude Code. Pipeline commands, phases, and agents resolve from **`${CLAUDE_PLUGIN_ROOT}/`** (the plugin root). Per-work state lives under **`.worklogs/<id>/`** in your project; **`/install`** can walk you through merging root **`CLAUDE.md`** and optional **`.gitignore`** for worklogs.

```text
/plugin marketplace add surajSFDC/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog
```

**Local development** of the pack: run Claude Code with **`claude --plugin-dir /path/to/this/repo`** from your target project (or enable the plugin from that directory).

Then start a task:

```text
/work Add retry logic to the API client
```

See the [installation guide](https://surajSFDC.github.io/agentic-swe/docs/installation) and the [Claude Code plugin](https://surajSFDC.github.io/agentic-swe/docs/claude-code-plugin) for details, upgrades, and **optional org knowledge files** (`AGENTS.md`, `docs/agentic-swe/`).

**First success in ~15 minutes:** follow the [Golden path](https://surajSFDC.github.io/agentic-swe/docs/golden-path) (install → `/work` → `.worklogs/` → approval gate). **Socialize / pitch:** [Who this is for](https://surajSFDC.github.io/agentic-swe/docs/adoption-one-pager) and [Host support tiers](https://surajSFDC.github.io/agentic-swe/docs/host-support-tiers) (OpenCode + Antigravity Tier B vs Claude Code reference). **Tiny demo repo:** [`examples/golden-path-demo/`](examples/golden-path-demo/) (scratch target + `DEMO_SCRIPT.md`).

**What this is:** a **markdown workflow pack** that runs inside **Claude Code** on your repo (phases, gates, evidence). It is **not** a hosted async coding agent or cloud sandbox—that is a different class of product (e.g. remote harnesses with triggers and isolated runners).

## Product

Agentic SWE is a **workflow pack for Claude Code** (markdown policies, phases, and agents)—not a hosted cloud runtime. More on the product and licensing:

**Public site:** **[GitHub Pages](https://surajSFDC.github.io/agentic-swe/)**

| Topic | Docs |
|-------|------|
| First run (~15 min) | [Golden path](https://surajSFDC.github.io/agentic-swe/docs/golden-path) |
| Who it is for (short matrix) | [Adoption one-pager](https://surajSFDC.github.io/agentic-swe/docs/adoption-one-pager) |
| Multi-IDE scope (Tier A–D) | [Host support tiers](https://surajSFDC.github.io/agentic-swe/docs/host-support-tiers) |
| Who it is for and hero messaging | [Product positioning](https://surajSFDC.github.io/agentic-swe/docs/product-positioning) |
| MIT and commercial strategy | [Licensing](https://surajSFDC.github.io/agentic-swe/docs/licensing) |
| Distribution and hosting | [Distribution](https://surajSFDC.github.io/agentic-swe/docs/distribution) |
| Troubleshooting | [Troubleshooting](https://surajSFDC.github.io/agentic-swe/docs/troubleshooting) |
| `/check` quick reference | [Check commands](https://surajSFDC.github.io/agentic-swe/docs/check-commands) |

**Marketing site (source):** the React app lives under **`site/src/`**; long-form docs are **`site/src/content/docs/*.md`** (rendered at **`/docs/*`**). **`site/public/`** holds static assets (favicon, icons). Run **`npm run build:site`** to emit **`site/dist/`**. Publish via **GitHub Actions** to Pages: **Settings → Pages → Source: GitHub Actions**; pushes to **`main`** run [`.github/workflows/pages.yml`](.github/workflows/pages.yml) → **`https://surajSFDC.github.io/agentic-swe/`** (adjust owner/repo if you fork).

## How It Works

The pipeline runs a **state machine** that routes tasks through analysis, design, implementation, review, and PR creation. At each phase, it **automatically selects** specialized subagents based on the languages, frameworks, and domains detected in your codebase — agents can also call other agents in the background when they need domain-specific expertise.

```
              lean track (simple tasks)
             ┌─────────────────────────────────────────────────────┐
initialized -> feasibility -> lean-track-check -> lean-track-implementation -> validation -> pr-creation -> completed
                                    |
                    ┌───────────────┴────────────────┐
                    v                                v
         standard track (medium)          rigorous track (complex)
    design -> verification -> test ->     design -> design-review -> verification ->
    implementation -> self-review ->      test-strategy -> implementation -> self-review ->
    validation -> pr-creation -> ...      code-review -> permissions-check -> validation -> ...
```

**Standard track** skips the design panel, `design-review`, `code-review`, and `permissions-check` (see `CLAUDE.md` for exact allowed transitions and `pipeline.track`).

Human gates stop the pipeline at `ambiguity-wait`, `approval-wait`, and escalation states.

## Quick Start Walkthrough

Example tasks and the routes they follow (see the **state machine** diagram above).

**Lean track** (small bug fix):

```
/work "Fix the off-by-one error in calculateTotal"
```

→ feasibility → lean-track-check (low risk) → lean-track-implementation → validation → pr-creation → approval-wait → completed

**Rigorous track** (new feature):

```
/work "Add user authentication with JWT tokens"
```

→ feasibility → lean-track-check (high risk) → design → design-review → verification → test-strategy → implementation → self-review → code-review → permissions-check → validation → pr-creation → approval-wait → completed

## Key Commands

| Command | What it does |
|---------|-------------|
| `/work <task>` | Start a new task (auto-routes lean, standard, or rigorous track) |
| `/work <id>` | Resume paused work |
| `/plan-only <task>` | Analyze and design without implementing |
| `/brainstorm` | Design-first exploration (design phase + optional visual server) |
| `/write-plan [id]` | Refine `implementation.md` plan to plan-quality bar (no coding) |
| `/execute-plan [id]` | Run the plan via implementation / lean-track-implementation |
| `/author-pipeline` | Checklist to extend phases, commands, agents safely |
| `/subagent` | Browse 135+ specialized subagents |
| `/subagent search <query>` | Find subagents by keyword |
| `/subagent invoke <name> <task>` | Spawn a specialist for a task |
| `/evaluate-work <id>` | Check work item health and status |
| `/repo-scan` | Structured codebase snapshot |
| `/check budget` | Verify iteration budgets |

See the [usage reference](https://surajSFDC.github.io/agentic-swe/docs/usage) for the full commands list.

## Specialized Subagents

135+ agents across 10 categories. **Automatically selected** during pipeline execution based on detected languages, frameworks, and domain signals — no manual invocation needed. Agents can also call other agents to get domain-specific work done.

| Category | Count | Examples |
|----------|-------|---------|
| **Core Development** | 10 | `backend-developer`, `fullstack-developer`, `api-designer` |
| **Language Specialists** | 29 | `python-pro`, `typescript-pro`, `rust-engineer`, `golang-pro` |
| **Infrastructure** | 16 | `kubernetes-specialist`, `terraform-engineer`, `docker-expert` |
| **Quality & Security** | 14 | `code-reviewer`, `security-auditor`, `penetration-tester` |
| **Data & AI** | 13 | `llm-architect`, `ml-engineer`, `data-engineer` |
| **Developer Experience** | 13 | `refactoring-specialist`, `mcp-developer`, `cli-developer` |
| **Specialized Domains** | 12 | `fintech-engineer`, `blockchain-developer`, `iot-engineer` |
| **Business & Product** | 11 | `product-manager`, `technical-writer`, `ux-researcher` |
| **Meta & Orchestration** | 10 | `multi-agent-coordinator`, `workflow-orchestrator` |
| **Research & Analysis** | 7 | `competitive-analyst`, `trend-analyst`, `research-analyst` |

See the [subagent catalog](https://surajSFDC.github.io/agentic-swe/docs/subagent-catalog) for the full catalog with models and descriptions.

## Examples

**Simple bug fix** (lean track, ~3-5 min):
```
/work Fix the off-by-one error in pagination logic in src/api/list.py
```

**Complex feature** (rigorous track with design review, ~10-30 min):
```
/work Add rate limiting middleware to the Express API with Redis backing
```

**Invoke a specialist subagent**:
```
/subagent invoke rust-engineer Fix the lifetime issues in src/parser/mod.rs
```

**Parallel security audit**:
```
Spawn security-auditor AND penetration-tester subagents in parallel
to audit the payment processing module in src/payments/
```

**Plan without coding**:
```
/plan-only Migrate the monolithic API to microservices with gRPC
```

**Workflow shortcuts** (same pipeline, familiar command names):

```
/brainstorm Design the event-sourcing layer for order history
/write-plan
/execute-plan
```

See [examples](https://surajSFDC.github.io/agentic-swe/docs/examples) for detailed walkthroughs.

## Architecture

```
Hypervisor (Claude Code + CLAUDE.md policy)
├── Core Pipeline Agents
│   ├── developer-agent.md    -- Implementation specialist
│   ├── git-operations-agent.md -- Branch management, remote sync
│   ├── pr-manager-agent.md   -- PR creation and management
│   └── panel/                -- Design review panel (parallel)
│       ├── architect-reviewer.md
│       ├── security-reviewer.md
│       └── adversarial-reviewer.md
│
└── Specialized Subagents (135+ agents, 10 categories)
    ├── core-development/
    ├── language-specialists/
    ├── infrastructure/
    ├── ...
    └── research-analysis/
```

## Extending

- **Add a subagent**: Create a `.md` file in `${CLAUDE_PLUGIN_ROOT}/agents/subagents/<category>/` with frontmatter (`name`, `description`, `tools`, `model`)
- **Add a phase**: Create `.md` in `${CLAUDE_PLUGIN_ROOT}/phases/`, add the state to `CLAUDE.md` (diagram, Required Artifacts, transitions), and update **`${CLAUDE_PLUGIN_ROOT}/state-machine.json`** so it matches the fenced transition block (`npm test` includes `state-machine-json`).
- **Add a core agent**: Create `.md` in `${CLAUDE_PLUGIN_ROOT}/agents/`, reference in `CLAUDE.md`
- **Adjust budgets**: Edit `CLAUDE.md` Budgets section and `${CLAUDE_PLUGIN_ROOT}/templates/state.json`
- **Inspect work folders**: From the pack/repo root, `npm run summarize-work` (or `node scripts/summarize-work.js --json`)
- **Migrate old work state**: `node scripts/migrate-work-state.js` then `node scripts/migrate-work-state.js --apply` after major upgrades (see `CHANGELOG.md`)

## Multi-Platform Support

agentic-swe runs the same markdown pipeline — driven by the **Hypervisor** session per `CLAUDE.md` — across multiple AI coding platforms:

| Platform | Install Method | Details |
|----------|---------------|---------|
| **Claude Code** | Plugin marketplace + `/plugin install` (or `claude --plugin-dir` for dev) | Primary platform. See [claude-code-plugin.md](site/src/content/docs/claude-code-plugin.md). |
| **Cursor** | Plugin via `.cursor-plugin/` | `curl -fsSL https://raw.githubusercontent.com/surajSFDC/agentic-swe/main/scripts/install-cursor-plugin.sh \| bash` then reload; add **`AGENTIC_SWE_TARGET_REPO=/path/to/app`** on the same line to auto-merge **`CLAUDE.md`** (needs **`node`**). [Cursor plugin](https://surajSFDC.github.io/agentic-swe/docs/cursor-plugin). |
| **Codex** | Clone + symlink or copy | See `.codex/INSTALL.md` and `site/src/content/docs/README.codex.md`. |
| **OpenCode** | Plugin via `.opencode/` | ESM plugin injects orchestration policy. See `site/src/content/docs/README.opencode.md`. |
| **Gemini CLI** | Extension via `gemini-extension.json` | Context loaded from `GEMINI.md`. |

All platforms share the same markdown source at this repo’s **plugin root** (`commands/`, `phases/`, `agents/`, …). Platform-specific tool mappings are in `${CLAUDE_PLUGIN_ROOT}/references/` (`codex-tools.md`, `opencode-tools.md`, `gemini-tools.md`, `copilot-tools.md`).

**Skill-like triggering:** agentic-swe does not use a separate Skill-tool registry. The same habit is implemented with **session hooks** (`hooks/hooks.json` for Claude Code, `hooks/hooks-cursor.json` for Cursor) running `hooks/session-start`, plus `${CLAUDE_PLUGIN_ROOT}/references/implicit-routing.md` for intent → command/phase hints. The pipeline remains authoritative in root `CLAUDE.md`.

## CI and pre-push checks

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on **push / pull request** to **`main`**, on **merge queue**, and **manually** (`workflow_dispatch`). It uses **Node 20 and 22**, **`npm ci`** for root, **`site/`**, and **`agents/plugin-runtime/brainstorm-server`**, then **site lint**, **site build**, **`npm run verify`**, **`npm run version:check`**, optional **`claude plugin validate`**, and **`npm test`** (state machine, references, **multi-platform wiring**, brainstorm-server, etc.).

Locally, with dependencies installed under **`site/`**, run **`npm run ci`** for the same bar (minus the Node matrix and unless **`claude`** is on your **`PATH`**). See the [Release checklist](https://surajSFDC.github.io/agentic-swe/docs/release-checklist) for the full maintainer sequence (mirrors CI plus optional manual smoke).

## Research Basis

Built on research from SWE-agent, Agentless, Ambig-SWE, Reflexion, Self-Refine, AgentCoder, TALE, OpenHands, and more. See the Research Basis section in [CLAUDE.md](CLAUDE.md) for the full citation table.

## License

[MIT](LICENSE). See [licensing](https://surajSFDC.github.io/agentic-swe/docs/licensing) for how the license applies to the pack and typical use (not legal advice).
