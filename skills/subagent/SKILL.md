---
name: subagent
description: "Browse, search, and invoke specialized subagents for specific development tasks."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-catalog-counts"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "command"
  source: "commands/subagent.md"
---

# /subagent — Discover and Invoke Specialized Subagents

Browse, search, and invoke from <!-- catalog-counts:start kind=short-total -->
138+ subagents
<!-- catalog-counts:end --> covering 10 categories of development expertise.

## Input: $ARGUMENTS

Usage:
- `/subagent` — list all categories and agents
- `/subagent search <query>` — find agents by keyword
- `/subagent info <name>` — show full agent definition
- `/subagent invoke <name> <task description>` — spawn agent for a task

## Categories

<!-- catalog-counts:start kind=table -->
| Category | Count |
|----------|------:|
| Language Specialists | 29 |
| Infrastructure | 16 |
| Specialized Domains | 15 |
| Quality & Security | 14 |
| Data & AI | 13 |
| Developer Experience | 13 |
| Business & Product | 11 |
| Core Development | 10 |
| Meta & Orchestration | 10 |
| Research & Analysis | 7 |
<!-- catalog-counts:end -->

See [`CLAUDE.md` — Specialized subagents](../CLAUDE.md#specialized-subagents) for example agents per category and when to invoke each.

## Instructions

### Action: list (no arguments or `list`)

List all categories with their agents:

```bash
source ${CLAUDE_PLUGIN_ROOT}/agents/plugin-runtime/subagent-catalog/config.sh
for category in $(subagent_catalog_list_categories); do
  echo "### $category"
  subagent_catalog_list_agents_in "$category" | tr '\n' ', ' | sed 's/,$//'
  echo ""
done
```

### Action: search <query>

```bash
source ${CLAUDE_PLUGIN_ROOT}/agents/plugin-runtime/subagent-catalog/config.sh
subagent_catalog_search "<query>"
```

Display results as a table with category, name, and description.

### Action: info <name>

1. Find the agent file:
```bash
source ${CLAUDE_PLUGIN_ROOT}/agents/plugin-runtime/subagent-catalog/config.sh
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

The Hypervisor should consider invoking a subagent when:

1. **Language-specific expertise needed** — e.g., Rust borrow checker issues, Python async patterns
2. **Domain specialist required** — e.g., Kubernetes deployment, database optimization, security audit
3. **Parallel review** — spawn multiple reviewers (code-reviewer + security-auditor) simultaneously
4. **Research tasks** — competitive analysis, trend research, literature review
5. **Infrastructure work** — Terraform plans, Docker optimization, CI/CD pipelines

## Integration with Pipeline

Subagents complement the core pipeline agents:

- **developer-agent.md** handles general implementation; language specialists handle language-specific expertise
- **panel/*.md** handles design review; quality-security subagents provide deeper audits
- **git-operations-agent.md** handles git workflow; devops subagents handle infrastructure concerns

The Hypervisor delegates to subagents the same way as core agents — with explicit scope, evidence requirements, and audit logging.
