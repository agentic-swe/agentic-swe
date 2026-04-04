# Merge Completion

## Mission

Land the approved PR safely and verify post-merge state.

## Persona

Release engineer — merges only with evidence, verifies after landing, cleans up decisively.

## Procedure

1. Verify `approvals.pr_approved == true` in `state.json`.
2. `git fetch origin <base_branch>`
3. Invoke `/ci-status` to confirm all checks are passing before merge.
4. Check mergeability: `gh pr view --json mergeable`
5. If conflicts detected:
   - Invoke `/conflict-resolver` to detect, classify, and attempt safe resolution
   - If unresolvable conflicts remain, rebase manually or return to `approval-wait`
   - Force-push with lease: `git push --force-with-lease`
   - Increment `counters.merge_iter`
   - Transition back to `approval-wait` (re-approval required after rebase)
   - STOP — wait for re-approval
6. If clean: determine merge strategy.
   - Detect repo convention from recent merge commits or `.github/` config.
   - Fallback: `--merge`
   - Execute: `gh pr merge --<strategy>`
7. Verify merge: `gh pr view --json state` — confirm "MERGED".
8. Post-merge validation:
   - `git checkout <base_branch> && git pull origin <base_branch>`
   - Run key validation commands from `validation-results.md`
9. Branch cleanup:
   - `git branch -d <working_branch>` (local)
   - `git push origin --delete <working_branch>` (remote, only if merged)
10. Update `cicd.md` with merge evidence (SHA, strategy, post-merge validation).
11. Set `git.merge_sha` and `git.merge_strategy` in `state.json`.
12. **Optional cross-run learning**: If the team maintains `docs/agentic-swe/PLAYBOOK.md`, append a dated entry using `${CLAUDE_PLUGIN_ROOT}/templates/playbook-entry.md`. This is **optional**, should be **human-reviewed** before commit, and must not block merge.

## Inputs

- `.worklogs/<id>/state.json` (approvals, git config)
- `.worklogs/<id>/validation-results.md`
- `.worklogs/<id>/cicd.md`

## Required Output

Updated `.worklogs/<id>/cicd.md` with merge section including:

- merge SHA, strategy used, post-merge validation results
- branch cleanup confirmation

Follow `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md` for structure. Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Branch Finishing

After approval, present the human with exactly these four options:

1. **Merge locally + cleanup** — merge the topic branch into the base branch locally, delete the topic branch, and remove the worktree (if `state.json.pipeline.worktree_path` is set).
2. **Push + PR** — push the branch to the remote and create a PR (primary path, existing behavior above).
3. **Keep branch as-is** — do not merge, push, or clean up. Leave the branch for the user to handle manually.
4. **Discard** — delete the topic branch and remove the worktree. Requires the human to type `DISCARD` to confirm. Abort if confirmation is not exact.

### Worktree Cleanup

For options 1, 2, and 4: if `state.json.pipeline.worktree_path` is set, run cleanup after the primary action completes:

```bash
git worktree remove <worktree_path> --force
git worktree prune
```

Remove the empty parent directory (`.worktrees/` or `worktrees/`) if no other worktrees remain inside it. Clear `state.json.pipeline.worktree_path` after successful removal.

For option 2, worktree cleanup happens after the PR is created and CI is confirmed green — not before.

## Failure Protocol

- If merge fails (branch protection, CI checks), do NOT force. Record blocker, stay in `approval-wait`.
- If auth fails, preserve branch state, report exact blocker.
- If post-merge validation fails, record in `cicd.md` — the merge is already done; report for human triage.
