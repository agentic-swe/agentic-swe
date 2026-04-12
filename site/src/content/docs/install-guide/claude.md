# Claude Code

The **supported** path is the **Claude Code plugin**: add this GitHub repository as a **plugin marketplace**, install **`agentic-swe`**, then use **`/install`** in your **target** repository. Commands, phases, agents, templates, references, and hooks resolve from **`${CLAUDE_PLUGIN_ROOT}/`**. You do **not** copy the full pipeline into **`project/.claude/`** by default.

Official references: [Plugins](https://code.claude.com/docs/en/plugins) · [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

## Install from GitHub

1. In Claude Code, add the marketplace (use the repo you trust):

   ```text
   /plugin marketplace add surajSFDC/agentic-swe
   ```

2. Install the plugin (catalog id **`agentic-swe-catalog`**, plugin id **`agentic-swe`**):

   ```text
   /plugin install agentic-swe@agentic-swe-catalog
   ```

3. Open your **target project** and run **`/install`** once. That merges root **`CLAUDE.md`** with the Hypervisor policy (delimiter-safe) and sets up **`.worklogs/<id>/`**. You will be asked whether to add **`.worklogs/`** to **`.gitignore`**.

4. Start work:

   ```text
   /work Add retry logic to the API client
   ```

## Local development (`--plugin-dir`)

From a checkout of this repository:

```bash
cd /path/to/your/target-project
claude --plugin-dir /path/to/agentic-swe
```

The **repository root** is the plugin root (`commands/`, `phases/`, `agents/`, `hooks/`, …).

## Validate the manifest

From a checkout of the pack:

```bash
claude plugin validate /path/to/agentic-swe
```

## Layout (plugin root)

- **`.claude-plugin/plugin.json`** lives under **`.claude-plugin/`**; portable dirs (**`commands/`**, **`agents/`**, **`phases/`**, **`hooks/`**, …) sit at the **repository root** per the [standard plugin layout](https://code.claude.com/docs/en/plugins-reference#plugin-directory-structure).
- **`hooks/hooks.json`** at the plugin root is loaded by Claude automatically — do **not** duplicate it via a **`hooks`** key pointing at the same file in **`plugin.json`** on recent Claude versions.
- **`phases/`**, **`templates/`**, **`references/`**, **`agents/plugin-runtime/`**, and **`state-machine.json`** are referenced by policy as **`${CLAUDE_PLUGIN_ROOT}/...`**; they are not separate manifest “component keys.”

## Commands vs skills

This pack ships slash entry points under **`commands/*.md`** (one file per command, e.g. **`/work`**, **`/check`**, **`/install`**), aligned with **`${CLAUDE_PLUGIN_ROOT}/commands/`** in **`CLAUDE.md`**. The Plugins reference also documents a **`skills/`** tree; migrating to **`skills/<name>/SKILL.md`** would be a deliberate change, not required for a valid install.

## Related in-site docs

- **[Claude Code plugin](../claude-code-plugin.md)** — shorter quick reference for the home install tile.
- **[Usage](../usage.md)** · **[Multi-platform support](../multi-platform-support.md)** · **[Troubleshooting](../troubleshooting.md)**
