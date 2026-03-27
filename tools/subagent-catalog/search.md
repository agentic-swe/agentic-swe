---
name: search
description: "Search the local subagent catalog by name, description, or capability keyword."
---

# Subagent Catalog - Search

Find agents by name, description, or category.

## Input: $ARGUMENTS

## Instructions

### Step 1: Search local agents

```bash
source tools/subagent-catalog/config.sh
subagent_catalog_search "{{QUERY}}"
```

### Step 2: Format results

Display matches as a table:

```
## Results for "kubernetes"

| Agent | Category | Description |
|-------|----------|-------------|
| kubernetes-specialist | 03-infrastructure | Container orchestration master |
| devops-engineer | 03-infrastructure | CI/CD and automation expert |

> use `/subagent-catalog:fetch <name>` to get full definition
> invoke with: Agent(prompt=agents/subagents/<category>/<name>.md)
```

### Step 3: Handle edge cases

- **no results**: suggest related terms or `/subagent-catalog:list`
- **too many results**: ask user to narrow the query
- **category match**: show all agents in that category
