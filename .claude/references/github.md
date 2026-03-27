# GitHub

Authoritative workflow guidance for all git and GitHub operations in this pipeline.

## Source Priority

- Git core behavior: official Git docs at `git-scm.com/docs`
- GitHub repository and PR workflow: `docs.github.com`
- GitHub CLI behavior: `cli.github.com/manual`

## Core Facts

- `git pull` fetches and then integrates remote changes by merge or rebase depending on options and configuration.
- a non-fast-forward push is rejected to avoid losing history; GitHub Docs recommend fetching and merging or using `git pull` before pushing again.
- `gh pr create` prints the PR URL on success.
- `gh pr create --dry-run` is not side-effect free and may still push git changes.
- first push of a new branch commonly uses `git push --set-upstream origin <branch>`.

## Preconditions

Before git workflow actions:

- relevant tests have passed or gaps are documented
- the worktree has been inspected for unrelated changes
- you know whether the repository is a direct clone or a fork
- you know the intended base branch

## Operational Guidance

- confirm branch, remotes, and worktree status before git or GitHub actions
- do not invent PR URLs
- do not use force push casually; prefer `--force-with-lease` over raw `--force`
- if auth, permissions, or branch protection prevent an action, record the exact blocker
- prefer explicit flags with `gh pr create` for deterministic behavior

## Common Workflows

For step-by-step branch, sync, and conflict procedures, see `.claude/agents/git-ops.md`. This reference provides the authoritative facts those procedures rely on.

### Create Pull Request

```bash
gh pr create --base <base-branch> --title "<title>" --body "<body>"
```

## Fetch, Pull, Merge, Rebase

- `git fetch <remote>` retrieves remote updates without modifying the working branch
- `git pull` fetches and integrates; local work must be committed first
- `git merge <remote>/<branch>` integrates remote-tracking changes, preserving history
- `git rebase` replays local commits onto a new base; do not rebase shared history

## Conflict Resolution

Inspect markers, preserve upstream fixes, abort when unsafe. See `.claude/agents/git-ops.md` Conflict Rules for procedure.

## Fork and Upstream Sync

Verify remotes: `origin` = fork, `upstream` = original. Add `upstream` if missing. See `.claude/agents/git-ops.md` for sync procedure.

## Decision Heuristics

- prefer merge when preserving shared history is safer than rewriting
- prefer rebase when local unshared commits need linear history
- prefer draft PRs when work is visible but not merge-ready
- keep commits atomic
- prefer non-interactive, explicit, reversible commands

## Required Recordkeeping

- record the actual PR URL in `.claude/.work/<id>/pr-link.txt`
- record important git workflow actions in `.claude/.work/<id>/progress.md`
- record blockers and failed workflow attempts in `.claude/.work/<id>/audit.log`
