# /author-pipeline

Extend or modify the **agentic-swe** workflow pack (phases, commands, agents, templates, references) while keeping the pipeline consistent.

## Prompt

You are running `/author-pipeline`.

**Goal:** Apply a structured change to the **plugin-root** trees (`commands/`, `phases/`, `agents/`, `templates/`, `references/`, `tools/`) and root `CLAUDE.md` when the state machine changes, with tests passing and documentation updated.

### Before editing

1. Read `${CLAUDE_PLUGIN_ROOT}/references/authoring-pipeline-capabilities.md` for command vs phase vs reference rules.
2. If adding a **phase** or **state**, read the current state machine in root `CLAUDE.md` end-to-end.

### Checklist (execute in order)

1. **Scope** — State what the user wants: new command, new phase/state, new reference, new subagent, or doc-only fix.
2. **Design the change** — List files to create/modify; if state machine changes, list new transitions and required artifacts.
3. **Implement** — Create or edit markdown under **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, or **`tools/`** at the plugin root; use `${CLAUDE_PLUGIN_ROOT}/templates/new-phase-stub.md` for new phases.
4. **Update policy** — If states changed: update `CLAUDE.md` (diagram, transition block, Required Artifacts table, Utility Skills if needed) and **`${CLAUDE_PLUGIN_ROOT}/state-machine.json`** so it matches the fenced transition block.
5. **Update discovery** — Add new slash commands to `README.md` Key Commands; link new references from relevant phases.
6. **CHANGELOG + version** — For any user-visible pack change, add an entry under `CHANGELOG.md` `[Unreleased]`. Before a release, run `npm run version:check` and bump versions listed in `.version-bump.json` (`npm run version:bump` when ready). Do not ship silent doc-only or behavior changes without a note.
7. **Breaking renames** — If `current_state` strings or `state.json` keys change, add or update `scripts/migrate-*.js` (see `scripts/migrate-work-state.js`), document migration in `CHANGELOG.md`, and bump **major** version in `package.json` and plugin manifests.
8. **Verify** — Run `npm test` from the **agentic-swe** package root (or the repo hosting the pack). Fix `state-machine-json`, `claude-md-consistency`, `phase-structure`, or `references-integrity` failures.
9. **Summarize** — Tell the user which files changed and any follow-up (e.g. bump **`.claude-plugin/plugin.json`** / **`marketplace.json`** version and push). Do **not** regenerate large **`commands`/`agents`** arrays — discovery is automatic at plugin root.

### Constraints

- Do not duplicate external workflow packs verbatim; adapt ideas into this structure (see project Cursor rules).
- Do not skip `CLAUDE.md` updates when adding or renaming pipeline states.
- Prefer small, reviewable diffs over sweeping rewrites.
