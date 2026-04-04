# Claude Code plugin (marketplace)

agentic-swe ships a **Claude Code plugin manifest** under [`.claude-plugin/`](../../.claude-plugin/) so others can add this repo as a **plugin marketplace** and install the pack without cloning manually.

Official reference: [Create and distribute a plugin marketplace](https://docs.anthropic.com/en/docs/claude-code/plugin-marketplaces) (Anthropic).

## For users (install from GitHub)

After this catalog is **pushed to a public GitHub repo** (e.g. `surajSFDC/agentic-swe`):

1. In **Claude Code**, add the marketplace (use your fork or upstream if different):

   ```text
   /plugin marketplace add surajSFDC/agentic-swe
   ```

   You can also use a full HTTPS Git URL or a branch/ref if your Claude Code version supports it (see Anthropic docs).

2. Install the plugin (catalog id **`agentic-swe-catalog`**, plugin id **`agentic-swe`**):

   ```text
   /plugin install agentic-swe@agentic-swe-catalog
   ```

3. **Project setup:** The plugin loads commands, agents, hooks, and policy context. For a **target repository**, you still need root **`CLAUDE.md`** merged with the Hypervisor policy and a populated **`.claude/`** tree. The supported way is:

   ```bash
   npx agentic-swe /path/to/your/project
   ```

   Use the plugin for **discovery and updates** of the pack in your environment; use **`npx agentic-swe`** (or `agentic-swe install`) when you need a full install into a git repo with delimiter-safe `CLAUDE.md` merge.

## For maintainers (publish the catalog)

1. Ensure [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) has:
   - **`name`** — marketplace id (here: `agentic-swe-catalog`). Reserved names are listed in Anthropic’s marketplace schema docs; do not impersonate official marketplaces.
   - **`owner`** — at least **`name`**; **`email`** optional but recommended.
   - **`plugins`** — each entry needs **`name`** + **`source`** (`./` = this repository root as the plugin tree).

2. Commit and **push** to GitHub (or another Git host Claude Code can fetch).

3. After adding or removing **slash commands** or **agent** markdown under `.claude/commands/` or `.claude/agents/`, regenerate the plugin manifest lists (Claude Code expects **`agents`** as an **array of `.md` paths**, not a directory string — see [anthropics/claude-code#21598](https://github.com/anthropics/claude-code/issues/21598)):

   ```bash
   npm run sync:claude-plugin
   ```

4. Bump **`version`** in [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json) and the **`version`** field on the plugin entry in `marketplace.json` when you cut a release (keep them aligned with `package.json` when practical).

5. **Optional — curated official list:** Anthropic maintains community/plugin listings separately; watch [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) (or current docs) for contribution guidelines if you want listing in a central registry.

## Layout notes

- **`plugin.json`** lives at **`.claude-plugin/plugin.json`**. With marketplace **`source`: `./`**, the **plugin root** is the **repository root**. Paths use **`./`** only (no `../`). **`commands`** and **`agents`** are stored as **arrays of per-file paths** so Claude Code’s validator accepts them; run **`npm run sync:claude-plugin`** to refresh those arrays. Other paths (e.g. **`hooks`**, **`phases`**, **`templates`**) follow [Claude’s plugin docs](https://code.claude.com/docs/en/plugins-reference).
- **`hooks`** load [`hooks/hooks.json`](../../hooks/hooks.json) for session-start context.
- **`.claude/state-machine.json`** ships in the npm tarball and full CLI install; ensure it exists in target repos (CLI install copies it). If you ever install **only** via plugin, verify that file is present under **`.claude/`** or re-run **`npx agentic-swe`** once.

## Related

- [Installation](installation.md) — npm-first install.
- [Distribution](distribution.md) — npm, site, and channels.
