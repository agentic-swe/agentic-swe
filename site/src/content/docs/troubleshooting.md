# Troubleshooting

## Slash commands like `/work` are missing

Enable the **agentic-swe** plugin in Claude Code for the project you are working in (`/plugin install …`), or run **`claude --plugin-dir /path/to/agentic-swe`** when developing the pack. Slash commands come from **`${CLAUDE_PLUGIN_ROOT}/commands/`**. Open **Claude Code in your target project directory**, not only inside a bare clone of this repo without the plugin.

## Install seems partial (policy or worklogs missing)

Run **`/install`** in the target repo to merge **`CLAUDE.md`** and set up **`.worklogs/`** (see [installation.md](installation.md)).

## Budget or gate stops every time

Read **`/check budget`** and the work item’s **`state.json`** under **`.worklogs/<id>/`**. See [check-commands.md](check-commands.md).

## Work state looks wrong after upgrading the pack

Major releases may change **`state.json`** shape or the state machine. From a checkout of this repo, run **`node scripts/migrate-work-state.js`** on your **project root** (dry-run), then **`--apply`** if the diff looks correct. See **`CHANGELOG.md`**. Canonical edges live in **`${CLAUDE_PLUGIN_ROOT}/state-machine.json`** and must match **`CLAUDE.md`**. From a checkout of the pack repo, run **`node scripts/summarize-work.js`** (optional **`--json`**) to list work folders.

## Claude Code cannot find tools

Ensure **git** and **`gh`** (if you use PR flows) match [installation.md](installation.md). **Node** is not required for plugin-only use.

## Legacy `.claude/` copy in my project

If you still have a **vendored** **`.claude/commands`**, **`.claude/phases`**, etc., you can remove those after enabling the plugin if you no longer want a duplicate copy. Move **`.claude/.work/`** to **`.worklogs/`** if needed.

## Still stuck

Confirm **`claude plugin validate`** passes on a checkout of this repository. Re-read [claude-code-plugin.md](claude-code-plugin.md) and [installation.md](installation.md).
