# Claude Code plugin

**Quick install**

1. In Claude Code, add this repo as a marketplace (use the published GitHub path you were given):

   ```text
   /plugin marketplace add surajSFDC/agentic-swe
   ```

2. Install the pack:

   ```text
   /plugin install agentic-swe@agentic-swe-catalog
   ```

3. Open your **target project** (the repo you are changing) and run **`/install`** once so root **`CLAUDE.md`** gets the Hypervisor block and **`.worklogs/`** is set up.

That’s it: commands, phases, agents, and hooks load from **`${CLAUDE_PLUGIN_ROOT}/`** — you do **not** copy the tree into **`project/.claude/`** for the default layout.

**Official docs:** [Plugins](https://code.claude.com/docs/en/plugins) · [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

**Hooks:** **`hooks/hooks.json`** runs **`session-start`** (routing hint; optional **memory prime** when **`AGENTIC_SWE_MEMORY_PRIME=1`**), **`Stop`** → cost sync, and async helpers for **`/brainstorm`** / **`/swe-dashboard`**. See [Durable memory](durable-memory.md).

**More detail:** [Installation](installation.md) · [Usage](usage.md) · [Durable memory](durable-memory.md) · [Troubleshooting](troubleshooting.md)
