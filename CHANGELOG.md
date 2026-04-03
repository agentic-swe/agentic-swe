# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Standard (medium) track** — third pipeline path after `lean-track-check`: lighter than rigorous (skips design panel, `design-review`, `code-review`, `permissions-check`). Set `pipeline.track` to `lean` | `standard` | `rigorous`; see `CLAUDE.md` transition table and track-specific rules.
- **`.claude/state-machine.json`** — canonical edge list kept in sync with the fenced transition block in `CLAUDE.md` (`test/state-machine-json.test.js`).
- **`scripts/migrate-work-state.js`** — migration entrypoint (delegates to `migrate-lean-track-state.js`).
- **`scripts/summarize-work.js`** and **`npm run summarize-work`** — read-only summary of `.claude/.work/*/state.json`.
- **Brainstorm server** — optional `BRAINSTORM_WATCH_DIR` + `chokidar` file-watch with `file-change` WebSocket broadcasts; README clarifies install story vs repo root.
- **LLM fixtures** — additional opt-in cases (`ambiguous-task`, `resume-work-prompt`, `standard-scope-prompt`) and optional `expectAll` assertions in `run-llm-tests.cjs`.
- **`ci-llm.yml`** — documented secrets, optional schedule snippet, passes `ANTHROPIC_API_KEY` from `secrets.ANTHROPIC_API_KEY` when set.

### Changed

- **`/author-pipeline`** — explicit **CHANGELOG + version** checklist step; state-machine sync called out when editing transitions.

## [2.0.0] - 2026-04-04

### Breaking

- Renamed pipeline tracks for clarity: **lean track** (low-risk shortcut) and **rigorous track** (design, reviews, full test strategy). User-facing prose, phase files, and `state.json` all use the new vocabulary.
- State names: `lean-track-check`, `lean-track-implementation` (replaces `fast-path-check`, `fast-path-implementation`). Phase files: `lean-track-check.md`, `lean-track-implementation.md`.
- `state.json`: `pipeline.lean_track_eligible`, `pipeline.lean_track_decision`, `counters.lean_iter`, `artifacts["lean-track-check"]` (replaces `fast_path_*`, `fast_iter`, `fast-path-check`).

### Migration

- For existing work under `.claude/.work/<id>/`, run from the target repo root: `node scripts/migrate-lean-track-state.js` (dry-run) then `node scripts/migrate-lean-track-state.js --apply`. The script ships with the npm package under `scripts/`.

### Added

- `scripts/migrate-lean-track-state.js` — migrates legacy `state.json` and renames `fast-path-check.md` → `lean-track-check.md` when present.

## [1.1.2] - 2026-04-02

### Added

- CLI: `agentic-swe --version` / `-v`, version shown in `--help`
- CLI: `agentic-swe doctor [path]` — checks Node 18+, git, and pipeline layout
- CLI: `--dry-run` / `-n` — prints planned install actions without writing files
- `CHANGELOG.md` for release notes
- `docs/troubleshooting.md`, `docs/check-commands.md`
- `.claude/templates/metrics-summary.md` (optional work-item metrics)
- `scripts/verify-sanity.js` and `npm run verify` in CI

### Documentation

- README: how this differs from hosted “coding agent” frameworks
- PRO.md: clearer separation of what Pro is and is not

## [1.1.1] - earlier

See git history for prior releases.
