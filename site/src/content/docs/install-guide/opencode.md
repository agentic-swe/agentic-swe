# OpenCode

OpenCode loads an **ESM plugin** under **`.opencode/plugins/agentic-swe.js`**. The plugin registers pack directories and prepends **`CLAUDE.md`** policy into chat. Use a **Git checkout** of this repository as the pack source.

## Prerequisites

- **OpenCode** with plugin support enabled
- **Node.js ≥ 18** (for the ESM plugin)
- A **checkout** of **agentic-swe**

## Workspace layout

The plugin resolves paths from the **agentic-swe repository root** (parent of **`.opencode/`**). Either:

- Open the **agentic-swe** checkout as your workspace, **or**
- Point the plugin at a clone (see **`repoRoot`** logic inside **`.opencode/plugins/agentic-swe.js`**).

## Add the plugin to `opencode.json`

In the repo you open in OpenCode:

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

## Install the plugin file

```bash
mkdir -p /path/to/your-repo/.opencode/plugins
ln -s /path/to/agentic-swe/.opencode/plugins/agentic-swe.js \
      /path/to/your-repo/.opencode/plugins/agentic-swe.js
```

If **`repoRoot`** must differ from defaults, adjust the plugin source or run OpenCode from the pack checkout.

## Merge policy and worklogs

Merge root **`CLAUDE.md`** into your project per **`commands/install.md`**. Use **`.worklogs/<id>/`** in the **target** repo for **`state.json`** and artifacts.

## What the plugin does

- **`config` hook** — registers **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`** from the pack root so OpenCode can discover them.
- **`experimental.chat.messages.transform`** — prepends the orchestration policy from **`CLAUDE.md`** as a system message so sessions follow the state machine.

## Verify

Open the repo in OpenCode, start a chat, and run **`/work <task>`**. If commands are missing, confirm **`commands/*.md`** exists on the pack root and paths are wired correctly.

## Tool mapping (conceptual)

| Pack concept | OpenCode surface |
|--------------|------------------|
| Subagent spawn | `opencode.agent.spawn` (when available) |
| Shell | `opencode.shell.exec` |
| File tools | `opencode.file.*` |
| Web | `opencode.web.*` (when available) |

## Related in-site docs

- **[OpenCode quick reference](../README.opencode.md)** (home tile).
- **[Overview tab](/docs/installation#overview)** · **[Multi-platform support](../multi-platform-support.md)** · **[Troubleshooting](../troubleshooting.md)**
