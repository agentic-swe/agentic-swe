# Agentic SWE

Autonomous software engineering pipeline for Claude Code with 135+ specialized subagents.

Claude Code becomes a full SWE pipeline -- from task analysis through implementation, review, and PR creation -- with no runtime code. Everything is pure markdown: policies, phase prompts, agent definitions, and templates.

## Quick Start

```bash
# 1. Clone into your project
git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe

# 2. Open Claude Code in your project
cd /path/to/your/project && claude

# 3. Install the pipeline
/install

# 4. Start working
/work Add retry logic to the API client
```

See [docs/installation.md](docs/installation.md) for manual install, selective install (subagents only), and more options.

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

See [docs/usage.md](docs/usage.md) for the full commands reference.

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

See [docs/subagent-catalog.md](docs/subagent-catalog.md) for the full catalog with models and descriptions.

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

See [docs/examples.md](docs/examples.md) for 8 detailed walkthroughs.

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
├── agents/                # Core agents + 135 subagents
│   ├── developer.md
│   ├── git-ops.md
│   ├── pr-manager.md
│   ├── panel/             # Design review panel
│   └── subagents/         # 10 category directories
├── commands/              # 13 slash commands
├── phases/                # 17 phase prompts
├── templates/             # State schema, evidence standard, artifact format
├── tools/                 # Subagent catalog tool
├── references/            # Git/GitHub reference docs
└── docs/                  # Detailed documentation
    ├── installation.md    # Install guide (3 methods)
    ├── usage.md           # Usage guide + commands reference
    ├── examples.md        # 8 practical examples
    └── subagent-catalog.md # Full 135-agent catalog
```

## Extending

- **Add a subagent**: Create a `.md` file in `agents/subagents/<category>/` with frontmatter (`name`, `description`, `tools`, `model`)
- **Add a phase**: Create `.md` in `phases/`, add state to `CLAUDE.md`
- **Add a core agent**: Create `.md` in `agents/`, reference in `CLAUDE.md`
- **Adjust budgets**: Edit `CLAUDE.md` Budgets section and `templates/state.json`

## Research Basis

Built on research from SWE-agent, Agentless, Ambig-SWE, Reflexion, Self-Refine, AgentCoder, TALE, OpenHands, and more. See the Research Basis section in [CLAUDE.md](CLAUDE.md) for the full citation table.

## License

MIT
