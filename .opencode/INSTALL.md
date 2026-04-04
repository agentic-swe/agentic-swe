# Installing agentic-swe for OpenCode

## Prerequisites

- OpenCode with plugin support enabled
- Node.js >= 18 (for the ESM plugin)
- A checkout of **agentic-swe** (this repository)

## Setup

### 1. Target repo layout

The plugin file resolves pipeline paths from the **agentic-swe repository root** (parent of `.opencode/`). Either:

- Open the **agentic-swe** checkout as your workspace, or
- Point the plugin at a clone (see plugin source paths in **`.opencode/plugins/agentic-swe.js`**).

There is **no** `npx agentic-swe` step in v3 — use the **Claude Code plugin** or a Git checkout.

### 2. Add the plugin to opencode.json

Create or edit **`opencode.json`** in the repo you open in OpenCode:

```json
{
  "plugins": [
    {
      "name": "agentic-swe",
      "entry": ".opencode/plugins/agentic-swe.js"
    }
  ]
}
```

### 3. Copy or symlink the plugin file

```bash
mkdir -p /path/to/your-repo/.opencode/plugins
ln -s /path/to/agentic-swe/.opencode/plugins/agentic-swe.js \
      /path/to/your-repo/.opencode/plugins/agentic-swe.js
```

If the plugin’s **`repoRoot`** must differ, adjust **`.opencode/plugins/agentic-swe.js`** or run OpenCode from the pack checkout.

### 4. Merge policy and worklogs

Merge root **`CLAUDE.md`** into your project per **`commands/install.md`** and use **`.worklogs/<id>/`** for work state.

### 5. Verify

Open the repo in OpenCode. The plugin prepends **`CLAUDE.md`** policy. Run **`/work <task>`** to start a work item.
