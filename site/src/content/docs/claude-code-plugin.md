# Claude Code plugin (marketplace)

agentic-swe ships a **Claude Code plugin manifest** under [`.claude-plugin/`](../../.claude-plugin/) so others can add this repo as a **plugin marketplace** and install the pack without manually copying files.

Official reference: [Plugins](https://code.claude.com/docs/en/plugins) and [Plugins reference](https://code.claude.com/docs/en/plugins-reference).

## For users (install from GitHub)

After this catalog is **pushed to a public GitHub repo** (e.g. `surajSFDC/agentic-swe`):

1. In **Claude Code**, add the marketplace:

   ```text
   /plugin marketplace add surajSFDC/agentic-swe
   ```

2. Install the plugin (catalog id **`agentic-swe-catalog`**, plugin id **`agentic-swe`**):

   ```text
   /plugin install agentic-swe@agentic-swe-catalog
   ```

3. **Project setup:** With the plugin enabled, commands, agents, phases, templates, and hooks resolve from **`${CLAUDE_PLUGIN_ROOT}/`** (this repo’s root when installed from Git). Run **`/install`** in your **target repository** to merge root **`CLAUDE.md`** with the Hypervisor policy (delimiter-safe) and configure **`.worklogs/<id>/`** (including optional **`.gitignore`**). You do **not** need to copy the pipeline into **`project/.claude/`** for the default path.

## For maintainers (publish the catalog)

1. Ensure [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) has **`name`**, **`owner`**, and **`plugins`** with **`source`: `./`** (repository root = plugin root).

2. **[`plugin.json`](../../.claude-plugin/plugin.json)** should stay **minimal**: metadata plus **`mcpServers`** when needed. **`commands/`**, **`agents/`**, and default **`hooks/hooks.json`** at the plugin root are **auto-discovered** — do **not** set **`manifest.hooks`** to **`./hooks/hooks.json`** (Claude **v2.1.92+** treats that as a duplicate and fails hook load; use **`hooks`** in the manifest only for *extra* hook config files).

3. Bump **`version`** in **`plugin.json`** and the plugin entry in **`marketplace.json`** when you cut a release (align with root **`package.json`** when practical).

4. Validate before release: **`claude plugin validate`** (or **`/plugin validate`**) from a checkout.

   For public plugin directories that ask for a **privacy policy URL**, use the published page: **[Plugin privacy](privacy.md)** (`https://surajSFDC.github.io/agentic-swe/docs/privacy`).

5. Session hooks live in **`hooks/hooks.json`** at the plugin root ([`hooks/hooks.json`](../../hooks/hooks.json)); Claude loads it automatically — no **`hooks`** key in **`plugin.json`** unless you add a second config file.

6. **`phases/`**, **`templates/`**, **`references/`**, **`tools/`**, and **`state-machine.json`** are **not** manifest component keys; policy and phases reference them via **`${CLAUDE_PLUGIN_ROOT}/...`**.

## Layout notes

- Only **`.claude-plugin/plugin.json`** lives under **`.claude-plugin/`**; portable dirs (**`commands/`**, **`agents/`**, **`phases/`**, **`hooks/`**, …) sit at the **repository root** per [standard plugin layout](https://code.claude.com/docs/en/plugins-reference#plugin-directory-structure).
- **`${CLAUDE_PLUGIN_ROOT}/state-machine.json`** ships at the plugin root; tests in this repo keep it in sync with **`CLAUDE.md`**.

## `commands/` vs `skills/` (Claude Code)

Per the [Plugins reference — Skills](https://code.claude.com/docs/en/plugins-reference#skills), plugins expose slash shortcuts from either:

- **`skills/`** — one directory per capability, with a **`SKILL.md`** (and optional supporting files), or  
- **`commands/`** — standalone **`.md`** files (one file per command).

The same doc’s [file locations table](https://code.claude.com/docs/en/plugins-reference#file-locations-reference) lists **`commands/`** for “Skill Markdown files” and says to **use `skills/` for new skills**—i.e. two supported shapes, not a deprecated plugin type.

**agentic-swe** ships pipeline slash commands only under **`commands/`** (e.g. **`/work`**, **`/check`**, **`/install`**). That matches the documented **`commands/`** mechanism, keeps one file per command aligned with **`${CLAUDE_PLUGIN_ROOT}/commands/`** in policy, and avoids duplicating every prompt under **`skills/<name>/SKILL.md`**. Adding a parallel **`skills/`** tree would be a deliberate migration (optional future work), not required for a valid plugin.

### Should commands be grouped into subfolders?

**Recommendation: keep a flat `commands/*.md` tree** (what this repo does today).

- The [standard plugin layout](https://code.claude.com/docs/en/plugins-reference#plugin-directory-structure) shows **markdown files directly under `commands/`** (`status.md`, `logs.md`, …). That is the clearest, most portable pattern for plugin slash commands.
- The [Skills](https://code.claude.com/docs/en/skills) doc says **skills** (directories with **`SKILL.md`**) are **recommended** over plain command files when you want extra features (bundled files, richer frontmatter, model vs user invocation). It does **not** say to create arbitrary category subfolders under **`commands/`** for organization.
- Custom command directories are expected to contain **`.md` files and/or skill-style subdirectories with `SKILL.md`** ([troubleshooting](https://code.claude.com/docs/en/plugins-reference#example-error-messages)); nesting **`commands/util/work.md`** may or may not map to the slash name you expect depending on host behavior—**flat names avoid that ambiguity**.
- **Categorization for humans** belongs in **docs** (e.g. [usage.md](usage.md) command tables, **`AGENTS.md`**, **`CLAUDE.md`**) without moving files.

If you later want per-command folders and supporting assets, migrate selected entry points to **`skills/<name>/SKILL.md`** (with frontmatter **`name`** = slash) rather than inventing **`commands/<category>/...`** layouts.

## Related

- [Installation](installation.md) — plugin-first setup and migrating from a vendored `.claude/` tree.
- [Distribution](distribution.md) — channels and hosting.
