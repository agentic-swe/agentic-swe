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

## Tier B happy path (~15 minutes)

This tab is an **official Tier B** path: same policy spine as Claude Code, **not** identical packaging. See **[Host support tiers](../host-support-tiers.md)** for definitions.

1. **Checkout** this repository and wire **`opencode.json`** + symlink **`agentic-swe.js`** (sections above).
2. **Merge `CLAUDE.md`** into your app repo; use **`.worklogs/<id>/`** in the **target** repo.
3. Open the **target** repo in OpenCode; start a session and run **`/work Fix a trivial typo in README`** (or use files from **`examples/golden-path-demo`** in the pack).
4. Confirm **`.worklogs/<id>/state.json`** updates and the session respects **approval-wait** before you merge.

**Command mapping (vs Claude Code reference):** there is no Anthropic **`/plugin install`** here — discovery is **`opencode.json`** + the ESM plugin. Policy injection uses **`experimental.chat.messages.transform`** instead of Claude Code’s plugin root resolution in all setups.

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
