# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.1] - 2026-04-20

### Added

- **`scripts/github/apply-agentic-swe-site-main-ruleset.sh`** (+ JSON payload) — idempotently create/update the **`main`** branch ruleset on **`agentic-swe/agentic-swe-site`** with required checks **`site (20)`**, **`site (22)`**, and **`main-merge-source`**. Documented in **`docs/branch-workflow.md`**.

### Changed

- **Organization & repositories:** canonical GitHub location is **[agentic-swe/agentic-swe](https://github.com/agentic-swe/agentic-swe)**. The docs/marketing site is **[agentic-swe/agentic-swe-site](https://github.com/agentic-swe/agentic-swe-site)** (**`https://agentic-swe.github.io/agentic-swe-site/`**); optional private workspace **[agentic-swe-lab](https://github.com/agentic-swe/agentic-swe-lab)**. Root **`npm run ci`** no longer builds **`site/`**.
- **`.cursor-plugin/plugin.json`:** explicit **`commands`**, **`agents`**, **`hooks`**, and **`mcpServers`** (relative paths from the pack root) for Cursor marketplace / validation alignment with the [Cursor plugins reference](https://cursor.com/docs/reference/plugins).
- **Release `3.1.1`:** synchronized **`package.json`**, **`.claude-plugin/plugin.json`**, **`.claude-plugin/marketplace.json`**, **`.cursor-plugin/plugin.json`**, and **`gemini-extension.json`** via **`scripts/bump-version.sh`**.

## [3.1.0] - 2026-04-20

### Documentation

- **Catalog routing & CI:** new site page [Catalog routing](https://agentic-swe.github.io/agentic-swe-site/docs/catalog-routing) (`site/src/content/docs/catalog-routing.md`), maintainer spec **`docs/specs/catalog-routing.md`**, hub/registry wiring, cross-links from **Usage**, **Check commands**, **Subagent catalog**, **Durable memory**, **Troubleshooting**, **README**, **GEMINI.md**, and the in-app **Guide** / **Documentation** pages.

### Fixed

- **`templates/audit.log`:** ship the template file referenced by **`work-engine init`** and **`phases/initialized.md`** so CI and fresh clones do not fail with **ENOENT** on **`copyFileSync`**.

### Added

- **Phase 3 (orchestration / routing / catalog hygiene):** **`scripts/catalog-lint.cjs`** (frontmatter, unique names, model enum, pairwise purpose overlap, invocation cues, required **`tools`**); **`scripts/catalog-route.cjs`** (**`--mode auto|lexical|semantic`**, semantic via **`scripts/catalog-index.cjs`** + **`scripts/lib/catalog/embed-rank.cjs`** and **`embeddings-backend`**); **`config/model-routing.default.json`** + **`scripts/lib/catalog/model-routing.cjs`**; **`scripts/session-model-tier-hint.cjs`** + **`hooks/session-start`** injection; **`config/catalog.default.json`**. NPM: **`catalog:lint`**, **`catalog:route`**, **`catalog:index`**. Tests: **`test/catalog-*.test.js`**, **`test/model-routing.test.js`**, **`test/catalog-semantic.test.js`**.
- **`memory-import`** (validated JSON bundle → SQLite nodes/edges), **`memory-sliding-summary`** (Claude JSONL transcript → `sliding-summary.md`, optional OpenAI for older turns), schema **`schemas/memory-import-bundle.schema.json`**, config **`sliding.*`**; session-start **memory prime default on** (opt out **`AGENTIC_SWE_MEMORY_PRIME=0`**).
- **Durable memory (Phase 2):** site doc **[Durable memory](https://agentic-swe.github.io/agentic-swe-site/docs/durable-memory)** (`site/src/content/docs/durable-memory.md`, registry slug **`durable-memory`**); cross-links from Usage, Multi-platform support, check-commands, Claude/Cursor plugin pages, Guide, and Documentation hub. Roadmap Phase 2 notes in-repo vs site pointers.
- **`work-engine doctor`** and **`work-engine migrate`** (delegates to **`scripts/migrate-work-state.js`**); **`AGENTIC_SWE_PROJECT_ROOT`** / **`--project-root`** for **`record-cost`**, **`doctor`**, and **`summarize-work.js`**; active work discovery **tie-break** + stderr warning when multiple actives share max **`state.json`** mtime (**`discover-workdir.cjs`**).
- **Best-effort `state.json` write lock** (**.`agentic-swe-write.lock`**) for **`applyTransition`** and **`syncCostFromTranscript`** (**`state-lock.cjs`**).
- **Dashboard API pagination:** **`collectWorkDashboard(cwd, { limit, offset })`**, **`GET /api/work-items?limit=&offset=`**, **`total_count`**; UI **Load more**, full-repo **rollup** on cards/chart, **Δ cost** column, richer **export JSON**.
- **`test/fixtures/work-engine/transition-cases.json`** and **`test/work-engine-transition-fixtures.test.js`** for stable illegal transition codes.
- **Local work dashboard (`/swe-dashboard`) — UX polish:** Filters (all / active / completed), search, Refresh + optional auto-refresh (30s), export JSON/CSV, per-row copy path + VS Code link, empty-state help, **by-state** bar chart for the filtered view, transition dots from **`history`**. **`GET /api/meta`**, **`POST /api/rollup`**, per-item **`state_json_abs_path`**, **`recent_transitions`**, **`state_histogram`** in **`collect-work-dashboard.cjs`**. **`npm run seed-dashboard-demo`** writes sample **`.worklogs/_demo-*`**. Site: [check-commands](site/src/content/docs/check-commands.md), [usage](site/src/content/docs/usage.md). Tests: **`test/swe-dashboard-server.test.js`** (meta + rollup), **`test/seed-dashboard-demo.test.js`**. Command: **`commands/swe-dashboard.md`**; hook **`hooks/dashboard-on-prompt.sh`** (port **47822** / **`SWE_DASHBOARD_PORT`**).
- **`budget.usage_totals`:** Cost sync (**`transcript-cost.cjs`**) now accumulates **input / output / cache read / cache creation** token counts on the same incremental transcript scan as **`cost_used`** (optional field in **`schemas/work-item.schema.json`**).
- **Configurable budget thresholds:** **`config/budget-thresholds.default.json`** defines per-track iteration/cost ceilings, **`counter_caps`** (including **`panel_runs`** / **`subagent_spawns`**), and **`subagents`** thresholds. **`AGENTIC_SWE_BUDGET_THRESHOLDS`** and **`.agentic-swe/budget-thresholds.json`** deep-merge over defaults. **`work-engine init --budget-profile …`**, **`apply-budget-profile`**, and **`transition --set-pipeline-track …`** apply profiles; engine **`checkBudgets`** uses merged caps when **`--work-dir`** is under **`.worklogs/`**. Loader: **`scripts/lib/work-engine/budget-config.cjs`**. Tests: **`test/budget-thresholds-config.test.js`**.
- **Work engine (Phase 1):** programmatic validation and transitions for **`.worklogs/<id>/state.json`** — JSON Schema (**`schemas/work-item.schema.json`**, Ajv), **`/check`-equivalent budgets**, **track-aware edges** (same graph as **`state-machine.json`** + CLAUDE track table), **required destination artifacts**, and safe **`--evidence`** paths. Implementation: **`scripts/lib/work-engine/`**; CLI: **`scripts/work-engine.cjs`** (**`npm run work-engine -- …`**). Tests under **`test/work-engine-*.test.js`**; CI runs **`node scripts/work-engine.cjs help`**. Maintainer spec: **`docs/specs/work-item-engine.md`**.
- **`budget.cost_used` from API usage:** Claude Code **`Stop`** hook (**`hooks/hooks.json`**) runs **`hook-record-cost.cjs`**, which increments **`cost_used`** from new **`transcript_path`** JSONL lines (token **`usage`** → USD via **`pricing.cjs`**; optional **`AGENTIC_SWE_PRICING_JSON`**). CLI: **`npm run work-engine -- record-cost --transcript-path … --cwd …`**. Discovery: **`AGENTIC_SWE_WORK_DIR`** or newest active **`.worklogs/<id>`** under the project.
- **Dependency:** **`ajv`** (root **`package.json`**) for schema validation.

### Changed

- **`schemas/work-item.schema.json`:** object-shaped **`history`** entries now require **`from`**, **`to`**, and **`at`** or **`timestamp`** (may reject legacy hand-edited rows until fixed or migrated).
- **Cursor manifest:** **`.cursor-plugin/plugin.json`** follows [Cursor’s plugin reference](https://cursor.com/docs/reference/plugins.md): default discovery for **`commands/`** and **`agents/`** at repo root (explicit **`../…`** paths removed), **`hooks`** set to **`hooks/hooks-cursor.json`**, **`author`** as an object, plus **`homepage`** and **`repository`** for marketplace submission.
- **Git workflow:** removed the **`uat`** line for this repo — topic branches open PRs **directly to `main`**; **`.github/workflows/main-merge-source.yml`** no longer restricts PR heads. **`docs/branch-workflow.md`** and **`.cursor/rules/development-branch-workflow.mdc`** describe **`main`**-only flow and that **only `@surajSFDC`** should merge (**GitHub** collaborator + branch rules, not YAML). CI **`push` / `pull_request`** triggers run on **`main`** only.
- **Plugin layout:** moved **`tools/brainstorm-server/`** and **`tools/subagent-catalog/`** to **`agents/plugin-runtime/`** so tooling ships next to **`agents/`** without mixing into **`agents/subagents/`**. **`package.json` `files[]`** no longer lists a top-level **`tools/`** tree. CI installs brainstorm deps via **`npm ci --prefix agents/plugin-runtime/brainstorm-server`**.
- **Claude Code hooks:** **`hooks/hooks.json`** adds async **`UserPromptSubmit`** hooks: **`hooks/brainstorm-on-prompt.sh`** when the user submits **`/brainstorm`** (if the brainstorm port is free), and **`hooks/dashboard-on-prompt.sh`** when the user submits **`/swe-dashboard`** (if **`SWE_DASHBOARD_PORT`** is free).

### Removed

- **Pro / commercial doc:** removed **`PRO.md`** (repo root) and **`site/src/content/docs/PRO.md`**; removed **`/docs/pro`** from **`site/src/docs/registry.ts`** and the documentation hub. **README**, **Licensing**, **Product positioning**, and **Product** page copy updated so the site describes the MIT markdown pack only (no separate Pro page).

### Added

- **`scripts/merge-claude-policy.js`** — non-interactive **`CLAUDE.md`** merge for a target repo (create / append delimiter / upgrade), matching **`commands/install.md`**; optional **`--gitignore`**. Invoked automatically from **`scripts/install-cursor-plugin.sh`** when **`AGENTIC_SWE_TARGET_REPO`** is set (**`AGENTIC_SWE_AUTO_GITIGNORE=1`** opts into **`.worklogs/`** in **`.gitignore`**). Covered by **`test/merge-claude-policy.test.js`**.
- **Site:** [Plugin privacy](https://agentic-swe.github.io/agentic-swe-site/docs/privacy) at **`/docs/privacy`** (`site/src/content/docs/privacy.md`) for directory listings and transparency; linked from **Licensing** and **Support**.
- **Docs:** link to **[plugin submission tracker](https://claude.ai/settings/plugins/submissions)** in **Distribution** and **Claude Code plugin** (maintainers).
- **Cursor:** [Cursor plugin](https://agentic-swe.github.io/agentic-swe-site/docs/cursor-plugin) guide — one-command local install (**`scripts/install-cursor-plugin.sh`** → **`~/.cursor/plugins/local/`**), Marketplace submit link, and doc updates across **README**, **installation**, **distribution**, **Guide**, **Support**, **PageShell**, **multi-platform-support**, **`site/src/docs/registry.ts`** (see **Changed** for manifest layout).
- **Templates:** **`templates/cursor-rules-stub.md`** — copy-paste stub for the target repo’s **`.cursor/rules/`** with a **`PACK_ROOT`** placeholder; linked from the Cursor plugin doc.

### Changed

- **Claude Code & Cursor plugin manifests:** release **3.1.0**. **`.cursor-plugin/plugin.json`** now includes **`keywords`** (aligned with the Claude plugin / marketplace) and a **description** that explicitly names **Claude Code**, **Cursor**, and compatible hosts, matching **`.claude-plugin/plugin.json`**. **`gemini-extension.json`** description updated for the same multi-host positioning.

## [3.0.5] - 2026-04-05

### Fixed

- **`.claude-plugin/plugin.json`:** removed **`hooks`** pointing at **`./hooks/hooks.json`**. Claude Code **v2.1.92** loads the default **`hooks/hooks.json`** at the plugin root automatically; listing the same path in **`manifest.hooks`** causes **Duplicate hooks file detected** and **`Hook load failed`** (`/doctor`). Use **`manifest.hooks`** only for *additional* hook config files, not the standard path.

## [3.0.4] - 2026-04-05

### Changed

- **Plugin commands and core agents:** added YAML frontmatter (`name`, `description`, and `model` for agents) so **`claude plugin validate`** completes without frontmatter warnings and discovery metadata matches [Claude plugin agent/command expectations](https://code.claude.com/docs/en/plugins-reference#agents).

## [3.0.3] - 2026-04-05

### Fixed

- **`.claude-plugin/plugin.json`:** removed **`commands`** and **`agents`** overrides. Claude Code **v2.1.92** `claude plugin validate` and marketplace install reject **`agents: ["./agents"]`** / **`["./agents/"]`** with **`agents: Invalid input`** (Zod expects agent **file** paths in the array, not a directory entry). Omitting both fields restores default discovery of **`./commands/`** and **`./agents/`** at the plugin root — same layout, install succeeds.
- **`test/install-platform-stubs.test.js`:** when the **`claude`** CLI is on PATH, run **`claude plugin validate`** on **`.claude-plugin/plugin.json`** as well as the repo (marketplace), so manifest regressions fail **`npm test`** locally/CI.

## [3.0.1] - 2026-04-05

### Fixed

- **`.claude-plugin/plugin.json`:** set explicit **`commands`**, **`agents`** (arrays with **`./`** paths), and **`hooks`**. **Update (3.0.3):** directory-style **`agents`** entries still fail **`claude plugin validate`** / install on **v2.1.92**; **`agents`** and **`commands`** overrides were removed again so defaults apply (see **[3.0.3]**).

## [3.0.2] - 2026-04-05

### Added

- **`mcp-servers.json`** at repo root (empty **`mcpServers`** map) and **`mcpServers`** in **`.claude-plugin/plugin.json`** — declares the MCP config path for Claude Code; extend **`mcpServers`** for bundled servers or keep project-specific secrets in gitignored **`.mcp.json`** (see **`references/tooling-expectations.md`**). Listed in **`package.json` `files[]`** for packaging.

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
- **CI (`.github/workflows/ci.yml`):** **`npm ci`** for root, **`site/`**, and **`tools/brainstorm-server`**; **npm cache** on three lockfiles; **site ESLint** before Vite build; **`merge_group`** + **`workflow_dispatch`** triggers; clearer step names. Root **`npm run ci`** mirrors the same checks (verify, version, lint site, build site, test) for local pre-push.
- **`test/install-platform-stubs.test.js`** — automated **per-platform wiring**: Claude marketplace version sync + **`hooks.json`** SessionStart + optional in-test **`claude plugin validate`** (marketplace); Cursor version + markdown counts + all **`hooks-cursor.json`** hooks; Gemini version + **`GEMINI.md`** heuristics; Codex **INSTALL** content; OpenCode **`import()`** of **`config`** / **`experimental.chat`**. Docs **[`release-checklist.md`](site/src/content/docs/release-checklist.md)** and **[`multi-platform-support.md`](site/src/content/docs/multi-platform-support.md)** describe coverage vs UI smoke.
- **README:** Removed the **Migrating from npm** section and the Quick Start link to it; use the [installation](https://agentic-swe.github.io/agentic-swe-site/docs/installation) doc for vendored **`.claude/`** cleanup.
- **Marketing site docs:** Removed end-user references to the deprecated **`npx agentic-swe`** / npm package install path; migration and troubleshooting now describe a **vendored `.claude/`** tree only. Maintainer commands (**`npm test`**, **`npm run build:site`**) remain in release/deploy docs.
- **Docs URLs:** README **Product** table and inline doc links list **GitHub Pages** first and **CloudFront** as mirror; paths use **`/docs/*`** (not legacy **`*.md`**). **`package.json` `homepage`**, **`.claude-plugin/plugin.json`**, and **`marketplace.json`** **`homepage`** set to **`https://agentic-swe.github.io/agentic-swe-site/`**. **[`distribution.md`](site/src/content/docs/distribution.md)** describes Pages as canonical and CloudFront as mirror.
- **GitHub Pages:** [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the marketing site with **`VITE_BASE=/<repo>/`** and deploys **`site/dist/`**; **`404.html`** duplicates **`index.html`** for SPA routing. **`site/vite.config.ts`** reads optional **`VITE_BASE`** (default **`/`** for root deploys).
- **Release checklist / stub:** **[Release checklist](site/src/content/docs/release-checklist.md)** (`/docs/release-checklist`) documents automated vs manual verification; **`docs/RELEASE-CHECKLIST.md`** points at the site source. **[`distribution.md`](site/src/content/docs/distribution.md)** links in-site.
- **Marketing site:** long-form docs live in **`site/src/content/docs/*.md`** and render as styled pages at **`/docs/*`** (with **`react-markdown`** / **`remark-gfm`**). Raw **`site/public/*.md`** copies were removed; legacy **`/*.md`** URLs redirect to **`/docs/*`**. README CloudFront links and **`infra/README.md`** point at the new paths.
- Documentation and marketing site updated for **plugin-only** install (removed npm/doctor references from primary flows).
- **Repo hygiene:** alongside plugin-root layout, root **`.claude/`** is **gitignored** so local Claude Code metadata is not committed with the pack.
- **README:** New **CI and pre-push checks** section links the workflow, **`npm run ci`**, and the release checklist.

### Fixed

- **`package.json` `test` script:** delegate to **`scripts/run-node-tests.js`**, which collects **`test/**/*.test.js`** and runs **`node --test <files...>`**. Node **22** can treat **`node --test test`** / **`./test/`** like a module path (`MODULE_NOT_FOUND`); explicit file paths work on **20** and **22**.
- **`scripts/bump-version.sh`** / **`.version-bump.json`** — marketplace plugin version is included in sync checks and bumps via **`versionSelector`**.

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
