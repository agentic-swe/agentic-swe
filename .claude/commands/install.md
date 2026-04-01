# /install

Scaffold or repair the `.claude/` pipeline directory inside a target repository.

All pipeline files live under `.claude/` in the source repo. This command copies them to the target repository's `.claude/` directory.

> **Note**: First-time installation must use **`npx agentic-swe`** or **`agentic-swe install`** (npm only—do not direct end users to clone a repository). This `/install` command is for guided repairs after `.claude/` already exists in the project.

## Prompt

Ensure the following directories exist under the repository root:

- `.claude/`
- `.claude/.work/`
- `.claude/commands/`
- `.claude/phases/`
- `.claude/agents/`
- `.claude/agents/panel/`
- `.claude/agents/subagents/` (and all 10 category subdirectories)
- `.claude/tools/subagent-catalog/`
- `.claude/templates/`
- `.claude/references/`

Copy all pipeline files from the source `.claude/` into the target `.claude/`:

- All `.md` files from `.claude/commands/`
- All `.md` files from `.claude/phases/`
- All `.md` files from `.claude/agents/` and `.claude/agents/panel/`
- All `.md` files from `.claude/agents/subagents/` (all 10 category directories)
- All files from `.claude/templates/`
- All files from `.claude/references/`
- All files from `.claude/tools/subagent-catalog/`

### CLAUDE.md Handling

- If the target repository has **no existing `CLAUDE.md`** at the repo root: copy the pipeline `CLAUDE.md` to the target repo root.
- If a `CLAUDE.md` **already exists** at the repo root: do NOT overwrite it. Instead, **append** the pipeline policy content, separated by a clear delimiter:

```markdown

---

<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->
```

- If the existing `CLAUDE.md` already contains the delimiter `<!-- BEGIN autonomous-swe-pipeline policy`, the pipeline section is already installed. **Replace** only the content after the delimiter with the current pipeline policy (to support upgrades).

### General Install Behavior

If `.claude/` or any required pipeline file is missing on first run:

1. bootstrap the missing `.claude/` structure
2. restore the required files from the source `.claude/` directory
3. handle `CLAUDE.md` per the rules above
4. only then continue with the requested command

Do not add runtime code. Only create or restore the missing `.claude/` pipeline files and directories.

Create `.claude/.work/.gitkeep` to ensure the work directory is tracked but empty.
Add `.claude/.work/` to `.gitignore` if not already present.
