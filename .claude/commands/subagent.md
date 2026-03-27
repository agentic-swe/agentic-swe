---
name: subagent
description: "Browse, search, and invoke specialized subagents for specific development tasks."
---

# /subagent — Discover and Invoke Specialized Subagents

Browse, search, and invoke from 135+ specialized subagents covering 10 categories of development expertise.

## Input: $ARGUMENTS

Usage:
- `/subagent` — list all categories and agents
- `/subagent search <query>` — find agents by keyword
- `/subagent info <name>` — show full agent definition
- `/subagent invoke <name> <task description>` — spawn agent for a task

## Categories

| # | Category | Count | Examples |
|---|----------|-------|----------|
| 01 | Core Development | 10 | api-designer, backend-developer, frontend-developer, fullstack-developer |
| 02 | Language Specialists | 29 | python-pro, typescript-pro, rust-engineer, golang-pro, react-developer |
| 03 | Infrastructure | 16 | cloud-architect, devops-engineer, kubernetes-specialist, terraform-engineer |
| 04 | Quality & Security | 14 | code-reviewer, security-auditor, debugger, performance-engineer |
| 05 | Data & AI | 13 | data-engineer, ml-engineer, llm-architect, prompt-engineer |
| 06 | Developer Experience | 13 | documentation-engineer, cli-developer, refactoring-specialist, mcp-developer |
| 07 | Specialized Domains | 12 | blockchain-developer, fintech-developer, gaming-developer, iot-engineer |
| 08 | Business & Product | 11 | product-manager, project-manager, technical-writer, ux-researcher |
| 09 | Meta & Orchestration | 10 | multi-agent-coordinator, workflow-orchestrator, context-manager |
| 10 | Research & Analysis | 7 | research-analyst, competitive-analyst, trend-analyst |

## Instructions

### Action: list (no arguments or `list`)

List all categories with their agents:

```bash
source .claude/tools/subagent-catalog/config.sh
for category in $(subagent_catalog_list_categories); do
  echo "### $category"
  subagent_catalog_list_agents_in "$category" | tr '\n' ', ' | sed 's/,$//'
  echo ""
done
```

### Action: search <query>

```bash
source .claude/tools/subagent-catalog/config.sh
subagent_catalog_search "<query>"
```

Display results as a table with category, name, and description.

### Action: info <name>

1. Find the agent file:
```bash
source .claude/tools/subagent-catalog/config.sh
subagent_catalog_find "<name>"
```

2. Read and display the full agent definition with parsed frontmatter (name, description, tools, model).

3. Show invocation example:
```
Agent(prompt="agents/subagents/<category>/<name>.md", model="<model>")
```

### Action: invoke <name> <task>

1. Find the agent file path.
2. Read the agent definition to determine the recommended model.
3. Spawn the agent:

```
Agent(
  prompt="<read agent file content>\n\n---\n\nTask: <task description>",
  model="<model from frontmatter>",
  description="<name>: <short task summary>"
)
```

**Model routing from agent frontmatter:**
- `opus` — deep reasoning (security audits, architecture reviews)
- `sonnet` — everyday coding (most developers and specialists)
- `haiku` — quick tasks (documentation, searches, dependency checks)

## When to Use Subagents

The orchestrator should consider invoking a subagent when:

1. **Language-specific expertise needed** — e.g., Rust borrow checker issues, Python async patterns
2. **Domain specialist required** — e.g., Kubernetes deployment, database optimization, security audit
3. **Parallel review** — spawn multiple reviewers (code-reviewer + security-auditor) simultaneously
4. **Research tasks** — competitive analysis, trend research, literature review
5. **Infrastructure work** — Terraform plans, Docker optimization, CI/CD pipelines

## Integration with Pipeline

Subagents complement the core pipeline agents:

- **developer.md** handles general implementation; language specialists handle language-specific expertise
- **panel/*.md** handles design review; quality-security subagents provide deeper audits
- **git-ops.md** handles git workflow; devops subagents handle infrastructure concerns

The orchestrator delegates to subagents the same way as core agents — with explicit scope, evidence requirements, and audit logging.
