# Multi-platform support

agentic-swe runs the same markdown pipeline — driven by the **Hypervisor** session per root **`CLAUDE.md`** — across several AI coding hosts. The canonical pack layout is the **plugin root**: **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, **`tools/`**, and **`state-machine.json`**, resolved via **`${CLAUDE_PLUGIN_ROOT}/`** when the Claude Code plugin is enabled.

**CI vs full verification:** **`npm test`** runs **`test/install-platform-stubs.test.js`**, which checks **each platform’s manifests, versions, hook targets, and (for OpenCode) loading the plugin module in Node** — plus **`claude plugin validate`** when the Claude CLI is on **`PATH`**. That replaces **manual** checks for **wiring only**. **Cursor, Codex, OpenCode, and Gemini** UIs are still not driven in GitHub-hosted CI; proving each **app** loads the pack needs **manual smoke** or **self-hosted runners** — see the [Release checklist](release-checklist.md).

| Platform | Install method | Where to read more |
|----------|----------------|-------------------|
| **Claude Code** | Add the marketplace, then **`/plugin install agentic-swe@agentic-swe-catalog`** (or **`claude --plugin-dir /path/to/this/repo`** for dev) | [Claude Code plugin](claude-code-plugin.md), [Installation](installation.md) |
| **Cursor** | Bundled **`.cursor-plugin/`**; rules + **`hooks/hooks-cursor.json`** | Project rules should point at root **`CLAUDE.md`** and plugin paths; slash commands are not automatic — use phase prompts or custom rules as needed |
| **Codex** | Clone / submodule this repo; symlink or copy pack dirs into the target project | [.codex/INSTALL.md](../../.codex/INSTALL.md), [Codex](README.codex.md) |
| **OpenCode** | **`.opencode/`** plugin entry | [OpenCode](README.opencode.md) |
| **Gemini CLI** | **`gemini-extension.json`** | Context from **`GEMINI.md`** at repo root |

Platform-specific **tool name** hints (when a host renames tools) live under **`${CLAUDE_PLUGIN_ROOT}/references/`** — e.g. **`codex-tools.md`**, **`opencode-tools.md`**, **`gemini-tools.md`**, **`copilot-tools.md`**.

## Hooks and “skill-like” routing

This pack does **not** rely on a separate Skill-tool registry. Session **hooks** (**`hooks/hooks.json`** for Claude Code, **`hooks/hooks-cursor.json`** for Cursor) run **`hooks/session-start`** so policy and routing hints load early. Intent → command/phase nudges are also described in **`${CLAUDE_PLUGIN_ROOT}/references/implicit-routing.md`**. The **state machine and artifacts** in **`CLAUDE.md`** remain the source of truth.

## Walkthrough on this site

For narrative context, command examples, and CI notes in one page, open the [Guide](/guide#platforms) and use the **Platforms** section (table of contents).
