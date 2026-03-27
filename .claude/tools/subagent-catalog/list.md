---
name: list
description: "List all categories and agents in the local subagent catalog. Use when user wants to browse available subagents."
---

# Subagent Catalog - List

Browse all available categories and agents from the local subagent catalog.

## Input: $ARGUMENTS

No arguments required.

## Instructions

### Step 1: List categories and agents

```bash
source tools/subagent-catalog/config.sh

for category in $(subagent_catalog_list_categories); do
  echo "### $category"
  subagent_catalog_list_agents_in "$category" | tr '\n' ', ' | sed 's/,$/\n/'
  echo ""
done
```

### Step 2: Format output

Display as a scannable list:

```
## Subagent Catalog (Local)

### 01-core-development
api-designer, backend-developer, frontend-developer, fullstack-developer, ...

### 02-language-specialists
typescript-pro, python-pro, rust-engineer, golang-pro, ...

[...continue for all 10 categories...]
```

### Tips

- use `/subagent-catalog:search <query>` to filter by keyword
- use `/subagent-catalog:fetch <name>` to get full definition
- agents are stored locally in `agents/subagents/`
