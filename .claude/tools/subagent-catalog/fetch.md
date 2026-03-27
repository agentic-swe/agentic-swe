---
name: fetch
description: "Read and display the full definition of a specific subagent from the local catalog."
---

# Subagent Catalog - Fetch

Get the full definition of a specific agent from local storage.

## Input: $ARGUMENTS

Accepts: agent name (e.g., `code-reviewer`, `python-pro`)

## Instructions

### Step 1: Find agent file

```bash
source tools/subagent-catalog/config.sh
subagent_catalog_find "{{NAME}}"
```

### Step 2: Read and display

Read the agent file and display its contents with parsed frontmatter:

```
## code-reviewer

**Category**: 04-quality-security
**Model**: opus
**Tools**: Read, Write, Edit, Bash, Glob, Grep

[full definition follows]
```

### Step 3: Show invocation options

After displaying the definition, show how to use it:

```
**How to invoke:**
- As orchestrator subagent: Agent(prompt="agents/subagents/04-quality-security/code-reviewer.md")
- With model override: Agent(prompt="...", model="opus")
- In background: Agent(prompt="...", run_in_background=true)
- In isolation: Agent(prompt="...", isolation="worktree")
```

### Error handling

| error | suggestion |
|-------|------------|
| not found | run `/subagent-catalog:search <partial>` |
| multiple matches | list them, ask user to specify |
