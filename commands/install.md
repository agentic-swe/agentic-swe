# /install

Scaffold or repair the `.claude/` pipeline directory inside a target repository.

This source repository stores the canonical files at repository root. The install action copies or restores them into `.claude/` in the target repository.

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

Ensure these minimum files exist:

- `.claude/CLAUDE.md`
- `.claude/commands/work.md`
- `.claude/commands/check.md`
- `.claude/commands/install.md`
- `.claude/commands/plan-only.md`
- `.claude/commands/evaluate-work.md`
- `.claude/phases/feasibility.md`
- `.claude/phases/fast-path-check.md`
- `.claude/phases/fast-implementation.md`
- `.claude/phases/design.md`
- `.claude/phases/design-review.md`
- `.claude/phases/verification.md`
- `.claude/phases/test.md`
- `.claude/phases/implementation.md`
- `.claude/phases/code-review.md`
- `.claude/phases/permissions.md`
- `.claude/phases/validation.md`
- `.claude/phases/pr-created.md`
- `.claude/phases/completion.md`
- `.claude/phases/escalate-code.md`
- `.claude/phases/escalate-validation.md`
- `.claude/phases/failed.md`
- `.claude/agents/developer.md`
- `.claude/agents/git-ops.md`
- `.claude/agents/pr-manager.md`
- `.claude/agents/panel/architect.md`
- `.claude/agents/panel/security.md`
- `.claude/agents/panel/adversarial.md`
- `.claude/templates/state.json`
- `.claude/templates/progress.md`
- `.claude/templates/audit.log`
- `.claude/templates/phase-checklist.md`
- `.claude/templates/evidence-standard.md`
- `.claude/templates/artifact-format.md`
- `.claude/commands/repo-scan.md`
- `.claude/commands/test-runner.md`
- `.claude/commands/lint.md`
- `.claude/commands/diff-review.md`
- `.claude/commands/ci-status.md`
- `.claude/commands/conflict-resolver.md`
- `.claude/commands/security-scan.md`
- `.claude/references/github.md`
- `.claude/commands/subagent.md`
- `.claude/tools/subagent-catalog/config.sh`
- `.claude/tools/subagent-catalog/list.md`
- `.claude/tools/subagent-catalog/search.md`
- `.claude/tools/subagent-catalog/fetch.md`
- `.claude/tools/subagent-catalog/invalidate.md`
- `.claude/agents/subagents/` (all `.md` files from all 10 category directories)

### CLAUDE.md Handling

- If the target repository has **no existing `CLAUDE.md`** at the repo root: create `.claude/CLAUDE.md` with the pipeline policy content.
- If a `CLAUDE.md` **already exists** at the repo root: do NOT overwrite it. Instead, **append** the pipeline policy content to the existing file, separated by a clear delimiter:

```markdown

---

<!-- BEGIN autonomous-swe-pipeline policy — do not edit above this line -->
```

This preserves the target repository's existing project instructions while adding the pipeline orchestrator policy.

- If the existing `CLAUDE.md` already contains the delimiter `<!-- BEGIN autonomous-swe-pipeline policy`, the pipeline section is already installed. In that case, **replace** only the content after the delimiter with the current pipeline policy (to support upgrades).

### General Install Behavior

If `.claude/` or any required pipeline file is missing on first run:

1. bootstrap the missing `.claude/` structure
2. restore the required files from the root pipeline source available to the current session
3. handle `CLAUDE.md` per the rules above
4. only then continue with the requested command

Do not add runtime code. Only create or restore the missing `.claude` pipeline files and directories.

Create `.claude/.work/.gitkeep` to ensure the work directory is tracked but empty.
