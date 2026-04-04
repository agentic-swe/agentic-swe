# Authoring pipeline capabilities

How to extend **agentic-swe** safely: new phases, commands, agents, templates, and references. This is the pack’s answer to a “writing skills” meta-workflow—everything stays compatible with **`CLAUDE.md`** and the state machine.

## Command vs phase vs reference

| Add a… | When | Must update |
|--------|------|-------------|
| **Slash command** | User-invoked shortcut, no new pipeline state | `${CLAUDE_PLUGIN_ROOT}/commands/<name>.md`, README command table, optionally `CLAUDE.md` Utility Skills |
| **Phase** | New **state** or a split of an existing state's procedure | `${CLAUDE_PLUGIN_ROOT}/phases/<state-name>.md`, **`CLAUDE.md`** (diagram, transitions, Required Artifacts), `test/claude-md-consistency.test.js` expected phases if hardcoded |
| **Reference** | Long-form guidance consulted by phases (no state change) | `${CLAUDE_PLUGIN_ROOT}/references/<topic>.md`, link from phase(s) |
| **Template** | Reusable artifact or checklist schema | `${CLAUDE_PLUGIN_ROOT}/templates/<name>.md`, link from phases |
| **Core agent** | Delegation target (developer, git, PR, panel) | `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md`, `CLAUDE.md` Delegation + Key Directories |
| **Subagent** | Domain specialist | `${CLAUDE_PLUGIN_ROOT}/agents/subagents/<category>/<name>.md`, update `subagent-selection.md` if auto-select should find it |

## New phase checklist

1. Copy structure from `${CLAUDE_PLUGIN_ROOT}/templates/new-phase-stub.md` or an existing phase.
2. Include sections expected by `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md` (Inputs, procedure, evidence, outputs).
3. Map every **new state name** in `CLAUDE.md`: ASCII diagram, transition block, Required Artifacts row, and **`${CLAUDE_PLUGIN_ROOT}/state-machine.json`** (must match the fenced transition block; `test/state-machine-json.test.js`).
4. Run `npm test` — especially `state-machine-json`, `phase-structure`, `claude-md-consistency`, `references-integrity`.
5. If install copies phases, confirm `lib/install.js` / install tree tests still match (no extra config usually).

## New command checklist

1. File `${CLAUDE_PLUGIN_ROOT}/commands/<command>.md` with `# /command` title and **Prompt** section the agent follows.
2. Document arguments (`$ARGUMENTS`) and interaction with `.worklogs/<id>/`.
3. Add to README “Key Commands” and optionally `CLAUDE.md` Key Directories slash list.

## Subagent frontmatter

Use YAML frontmatter consistent with siblings in the same category:

- `name`, `description`, `tools`, `model` (recommended: opus | sonnet | haiku)

## Evidence

Follow `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md`. Phases must not encourage narrative-only conclusions when executable proof exists.

## Do not

- Introduce a second state machine or duplicate `CLAUDE.md` policy in a forked file.
- Rename phase files without renaming **states** everywhere (see rename policy in project docs).
- Paste third-party skill packs verbatim into this repo (adapt structure and voice).
