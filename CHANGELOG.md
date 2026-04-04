# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`package.json` `test` script:** use **`node --test ./test/`** so Node **22** treats **`test`** as a directory; bare **`node --test test`** resolves **`test`** as a module path and fails in CI with `MODULE_NOT_FOUND`.

### Changed

- **CI (`.github/workflows/ci.yml`):** **`npm ci`** for root, **`site/`**, and **`tools/brainstorm-server`**; **npm cache** on three lockfiles; **site ESLint** before Vite build; **`merge_group`** + **`workflow_dispatch`** triggers; clearer step names. Root **`npm run ci`** mirrors the same checks (verify, version, lint site, build site, test) for local pre-push.
- **`test/install-platform-stubs.test.js`** — Expanded automated **per-platform wiring**: Claude marketplace version sync + **`hooks.json`** SessionStart + optional in-test **`claude plugin validate`**; Cursor version + markdown counts + all **`hooks-cursor.json`** hooks; Gemini version + **`GEMINI.md`** heuristics; Codex **INSTALL** content; OpenCode **`import()`** of **`config`** / **`experimental.chat`**. Docs **[`release-checklist.md`](site/src/content/docs/release-checklist.md)** and **[`multi-platform-support.md`](site/src/content/docs/multi-platform-support.md)** describe coverage vs UI smoke.
- **README:** Removed the **Migrating from npm** section and the Quick Start link to it; use the [installation](https://surajSFDC.github.io/agentic-swe/docs/installation) doc for vendored **`.claude/`** cleanup.
- **Marketing site docs:** Removed end-user references to the deprecated **`npx agentic-swe`** / npm package install path; migration and troubleshooting now describe a **vendored `.claude/`** tree only. Maintainer commands (**`npm test`**, **`npm run build:site`**) remain in release/deploy docs.
- **Docs URLs:** README **Product** table and inline doc links list **GitHub Pages** first and **CloudFront** as mirror; paths use **`/docs/*`** (not legacy **`*.md`**). **`package.json` `homepage`**, **`.claude-plugin/plugin.json`**, and **`marketplace.json`** **`homepage`** set to **`https://surajSFDC.github.io/agentic-swe/`**. **[`distribution.md`](site/src/content/docs/distribution.md)** describes Pages as canonical and CloudFront as mirror.
- **GitHub Pages:** [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the marketing site with **`VITE_BASE=/<repo>/`** and deploys **`site/dist/`**; **`404.html`** duplicates **`index.html`** for SPA routing. **`site/vite.config.ts`** reads optional **`VITE_BASE`** (default **`/`** for root deploys).
- **Release checklist / stub:** **[Release checklist](site/src/content/docs/release-checklist.md)** (`/docs/release-checklist`) documents automated vs manual verification; **`docs/RELEASE-CHECKLIST.md`** points at the site source. **[`distribution.md`](site/src/content/docs/distribution.md)** links in-site.
- **Marketing site:** long-form docs live in **`site/src/content/docs/*.md`** and render as styled pages at **`/docs/*`** (with **`react-markdown`** / **`remark-gfm`**). Raw **`site/public/*.md`** copies were removed; legacy **`/*.md`** URLs redirect to **`/docs/*`**. README CloudFront links and **`infra/README.md`** point at the new paths.
- Documentation and marketing site updated for **plugin-only** install (removed npm/doctor references from primary flows).
- Removed the committed duplicate **`.claude/**` tree**; the plugin’s canonical assets live only at **repo root** (`commands/`, `phases/`, `agents/`, …). **`/.claude/`** is gitignored so a local Claude Code folder is not re-added by mistake.
- **README:** New **CI and pre-push checks** section links the workflow, **`npm run ci`**, and the release checklist.

### Fixed

- **`scripts/bump-version.sh`** / **`.version-bump.json`** — marketplace plugin version is included in sync checks and bumps via **`versionSelector`**.

## [3.0.0] - 2026-04-05

### Added

- **Standard (medium) track** — third pipeline path after `lean-track-check`: lighter than rigorous (skips design panel, `design-review`, `code-review`, `permissions-check`). Set `pipeline.track` to `lean` | `standard` | `rigorous`; see `CLAUDE.md` transition table and track-specific rules.
- **`state-machine.json`** (repo root) — canonical edge list kept in sync with the fenced transition block in `CLAUDE.md` (`test/state-machine-json.test.js`).
- **`scripts/migrate-work-state.js`** — migration entrypoint (delegates to `migrate-lean-track-state.js`).
- **`scripts/summarize-work.js`** and **`npm run summarize-work`** — read-only summary of `.worklogs/*/state.json`.
- **Brainstorm server** — optional `BRAINSTORM_WATCH_DIR` + `chokidar` file-watch with `file-change` WebSocket broadcasts; README clarifies install story vs repo root.
- **LLM fixtures** — additional opt-in cases (`ambiguous-task`, `resume-work-prompt`, `standard-scope-prompt`) and optional `expectAll` assertions in `run-llm-tests.cjs`.
- **`ci-llm.yml`** — documented secrets, optional schedule snippet, passes `ANTHROPIC_API_KEY` from `secrets.ANTHROPIC_API_KEY` when set.

### Changed

- **`/author-pipeline`** — explicit **CHANGELOG + version** checklist step; state-machine sync called out when editing transitions.

### Breaking

- **Plugin-native layout** — Pipeline assets moved from **`.claude/commands`**, **`.claude/phases`**, etc. to the **repository (plugin) root**: **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, **`tools/`**, **`state-machine.json`**. Only **`.claude-plugin/`** remains under a `.claude*` path in source.
- **Per-work state** — Default location is **`.worklogs/<id>/`** at the **target project root** (replaces **`.claude/.work/<id>/`**). **`summarize-work`** and new sessions use **`.worklogs/`**; **`migrate-lean-track-state.js`** scans **`.worklogs/`** and still finds legacy **`.claude/.work/`** for migration.
- **npm CLI removed** — **`bin/agentic-swe.js`**, **`package.json` `bin`**, **`prepack`**, and publish **`files`** list are gone; root **`package.json`** is **`private: true`**. Install via **Claude Code plugin** (marketplace or **`claude --plugin-dir`**).
- **Minimal `.claude-plugin/plugin.json`** — **`commands`**, **`agents`**, **`phases`**, **`templates`**, **`references`**, and **`entryPoint`** arrays/fields removed; Claude Code discovers default **`./commands/`** and **`./agents/`**. **`scripts/sync-claude-plugin-manifest.cjs`** removed.
- **Prompt fragments** — Moved from **`agents/prompts/`** to **`templates/prompts/`** so **`agents/`** contains only invocable agents.

### Migration

- Enable the **agentic-swe** plugin; use **`/install`** (see **`commands/install.md`**) to merge **`CLAUDE.md`** and bootstrap **`.worklogs/`** (optional **`.gitignore`** with explicit user consent).
- If you have work under **`.claude/.work/`**, move folders to **`.worklogs/`** or run **`node scripts/migrate-lean-track-state.js`** (still reads legacy root).
- Deprecate the **`agentic-swe`** npm package manually on npm if you published it previously.

## [2.0.0] - 2026-04-04

### Breaking

- Renamed pipeline tracks for clarity: **lean track** (low-risk shortcut) and **rigorous track** (design, reviews, full test strategy). User-facing prose, phase files, and `state.json` all use the new vocabulary.
- State names: `lean-track-check`, `lean-track-implementation` (replaces `fast-path-check`, `fast-path-implementation`). Phase files: `lean-track-check.md`, `lean-track-implementation.md`.
- `state.json`: `pipeline.lean_track_eligible`, `pipeline.lean_track_decision`, `counters.lean_iter`, `artifacts["lean-track-check"]` (replaces `fast_path_*`, `fast_iter`, `fast-path-check`).

### Migration

- For existing work under `.claude/.work/<id>/`, run from the target repo root: `node scripts/migrate-lean-track-state.js` (dry-run) then `node scripts/migrate-lean-track-state.js --apply`.

### Added

- `scripts/migrate-lean-track-state.js` — migrates legacy `state.json` and renames `fast-path-check.md` → `lean-track-check.md` when present.

## [1.1.2] - 2026-04-02

### Added

- CLI: `agentic-swe --version` / `-v`, version shown in `--help`
- CLI: `agentic-swe doctor [path]` — checks Node 18+, git, and pipeline layout
- CLI: `--dry-run` / `-n` — prints planned install actions without writing files
- `CHANGELOG.md` for release notes
- `site/public/troubleshooting.md`, `site/public/check-commands.md`
- `${CLAUDE_PLUGIN_ROOT}/templates/metrics-summary.md` (optional work-item metrics)
- `scripts/verify-sanity.js` and `npm run verify` in CI

### Documentation

- README: how this differs from hosted “coding agent” frameworks
- PRO.md: clearer separation of what Pro is and is not

## [1.1.1] - earlier

See git history for prior releases.
