# Agentic SWE

Autonomous software engineering pipeline for Claude Code with 135+ specialized subagents.

Claude Code becomes a full SWE pipeline -- from task analysis through implementation, review, and PR creation -- with no runtime code. Everything is pure markdown: policies, phase prompts, agent definitions, and templates.

## Quick Start

Install [from npm](https://www.npmjs.com/package/agentic-swe) (Node 18+):

```bash
npx agentic-swe /path/to/your/project
# or: npm install -g agentic-swe && agentic-swe install /path/to/your/project
```

Then open Claude Code in that project and start a task:

```bash
cd /path/to/your/project && claude
```

```
/work Add retry logic to the API client
```

See the [installation guide](https://d3pi4w4hqr9gq6.cloudfront.net/installation.md) for upgrades, selective installs, and **optional org knowledge files** (`AGENTS.md`, `docs/agentic-swe/`).

## Product

Agentic SWE is a **workflow pack for Claude Code** (markdown policies, phases, and agents)—not a hosted cloud runtime. More on the product and licensing:

| Topic | Doc |
|-------|-----|
| Who it is for and hero messaging | [Product positioning](https://d3pi4w4hqr9gq6.cloudfront.net/product-positioning.md) |
| MIT and commercial strategy | [Licensing](https://d3pi4w4hqr9gq6.cloudfront.net/licensing.md) |
| Pro / services (first paid wedges) | [Pro & services](https://d3pi4w4hqr9gq6.cloudfront.net/PRO.md) |
| Distribution and hosting | [Distribution](https://d3pi4w4hqr9gq6.cloudfront.net/distribution.md) |

## How It Works

The pipeline runs a **state machine** that routes tasks through analysis, design, implementation, review, and PR creation. At each phase, it **automatically selects** specialized subagents based on the languages, frameworks, and domains detected in your codebase — agents can also call other agents in the background when they need domain-specific expertise.

```
              fast path (simple tasks)
             ┌─────────────────────────────────────────────────────┐
initialized -> feasibility -> fast-path-check -> fast-implementation -> validation -> pr-created -> completed
                                    |
                                    v  full path (complex tasks)
                              design -> design-review -> verification -> test ->
                              implementation -> self-review -> code-review ->
                              permissions -> validation -> pr-created -> completed
```

Human gates stop the pipeline at `ambiguity-wait`, `approval-wait`, and escalation states.

## Key Commands

| Command | What it does |
|---------|-------------|
| `/work <task>` | Start a new task (auto-routes fast/full path) |
| `/work <id>` | Resume paused work |
| `/plan-only <task>` | Analyze and design without implementing |
| `/subagent` | Browse 135+ specialized subagents |
| `/subagent search <query>` | Find subagents by keyword |
| `/subagent invoke <name> <task>` | Spawn a specialist for a task |
| `/evaluate-work <id>` | Check work item health and status |
| `/repo-scan` | Structured codebase snapshot |
| `/check budget` | Verify iteration budgets |

See the [usage reference](https://d3pi4w4hqr9gq6.cloudfront.net/usage.md) for the full commands list.

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

See the [subagent catalog](https://d3pi4w4hqr9gq6.cloudfront.net/subagent-catalog.md) for the full catalog with models and descriptions.

## Examples

**Simple bug fix** (fast path, ~3-5 min):
```
/work Fix the off-by-one error in pagination logic in src/api/list.py
```

**Complex feature** (full path with design review, ~10-30 min):
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

See [examples](https://d3pi4w4hqr9gq6.cloudfront.net/examples.md) for detailed walkthroughs.

## Architecture

```
Orchestrator (Claude Code + CLAUDE.md policy)
├── Core Pipeline Agents
│   ├── developer.md          -- Implementation specialist
│   ├── git-ops.md            -- Branch management, remote sync
│   ├── pr-manager.md         -- PR creation and management
│   └── panel/                -- Design review panel (parallel)
│       ├── architect.md
│       ├── security.md
│       └── adversarial.md
│
└── Specialized Subagents (135+ agents, 10 categories)
    ├── 01-core-development/
    ├── 02-language-specialists/
    ├── 03-infrastructure/
    ├── ...
    └── 10-research-analysis/
```

## File Structure

```
agentic-swe/
├── CLAUDE.md              # Orchestrator policy and state machine
├── README.md
├── package.json           # npm package (CLI: agentic-swe)
├── bin/agentic-swe.js     # npm install entrypoint
├── docs/                  # Documentation (mirrored on the [project site](https://d3pi4w4hqr9gq6.cloudfront.net/))
│   ├── installation.md
│   ├── usage.md
│   ├── examples.md
│   ├── subagent-catalog.md
│   ├── product-positioning.md
│   ├── licensing.md
│   └── distribution.md
├── PRO.md                 # Pro / commercial offers (stub)
└── .claude/               # All pipeline files (same structure when installed)
    ├── commands/          # 13 slash commands (/work, /check, /subagent, etc.)
    ├── phases/            # 18 phase prompts + subagent-selection policy
    ├── agents/            # Core agents + 135 subagents
    │   ├── developer.md
    │   ├── git-ops.md
    │   ├── pr-manager.md
    │   ├── panel/         # Design review panel (3 agents)
    │   └── subagents/     # 10 category directories
    ├── templates/         # State schema, evidence standard, artifact format
    ├── tools/             # Subagent catalog tool
    ├── references/        # Git and PR workflow reference docs
    └── .work/             # Runtime state (gitignored)
```

## Extending

- **Add a subagent**: Create a `.md` file in `.claude/agents/subagents/<category>/` with frontmatter (`name`, `description`, `tools`, `model`)
- **Add a phase**: Create `.md` in `.claude/phases/`, add state to `CLAUDE.md`
- **Add a core agent**: Create `.md` in `.claude/agents/`, reference in `CLAUDE.md`
- **Adjust budgets**: Edit `CLAUDE.md` Budgets section and `.claude/templates/state.json`

## Research Basis

Built on research from SWE-agent, Agentless, Ambig-SWE, Reflexion, Self-Refine, AgentCoder, TALE, OpenHands, and more. See the Research Basis section in [CLAUDE.md](CLAUDE.md) for the full citation table.

## License

[MIT](LICENSE). Commercial services and optional Pro offerings are described on the [Pro & services](https://d3pi4w4hqr9gq6.cloudfront.net/PRO.md) page; see [licensing](https://d3pi4w4hqr9gq6.cloudfront.net/licensing.md) for how MIT relates to product packaging (not legal advice).
