# Troubleshooting

## Slash commands like `/work` are missing

The pipeline must be installed into **your project** first (`npx agentic-swe /path/to/project`). Slash commands come from `.claude/commands/` in that project. Open **Claude Code in that directory**, not only in the `agentic-swe` package repo.

## `agentic-swe` says the target is not a git repository

The installer warns when the target is not a git repo. Use `-y` / `--yes` to skip the prompt (e.g. sandboxes), or initialize git in the project.

## Install seems partial (only some folders)

Re-run the same install command against the project; it refreshes `.claude/` and the appended `CLAUDE.md` block when the delimiter is present. See [installation.md](installation.md).

## Budget or gate stops every time

Read `/check budget` and the work item’s `state.json` under `.claude/.work/<id>/`. See [check-commands.md](check-commands.md) for enforcement commands.

## Work state looks wrong after upgrading the pack (missing `pipeline.track`, bad transitions)

Major releases may change `state.json` shape or the state machine. From the **installed** `agentic-swe` package (or this repo), run **`node scripts/migrate-work-state.js`** on your project root (dry-run), then **`node scripts/migrate-work-state.js --apply`** if the diff looks correct. See **`CHANGELOG.md`**. Canonical edges live in **`.claude/state-machine.json`** and must match **`CLAUDE.md`**; use **`npm run summarize-work`** in the pack to list work folders and current states.

## Claude Code cannot find Node or tools

Agentic SWE does not install Claude Code. Ensure Node 18+, git, and `gh` match [installation.md](installation.md).

## Still stuck

Run **`agentic-swe doctor /path/to/your/project`** to verify Node, git, and that `.claude/phases` and `.claude/commands` exist.
