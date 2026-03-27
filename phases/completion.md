# Completion

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
5. If clean: determine merge strategy.
   - Detect repo convention from recent merge commits or `.github/` config.
   - Fallback: `--merge`
   - Execute: `gh pr merge --<strategy>`
6. Verify merge: `gh pr view --json state` — confirm "MERGED".
7. Post-merge validation:
   - `git checkout <base_branch> && git pull origin <base_branch>`
   - Run key validation commands from `validation-results.md`
8. Branch cleanup:
   - `git branch -d <working_branch>` (local)
   - `git push origin --delete <working_branch>` (remote, only if merged)
9. Update `cicd.md` with merge evidence (SHA, strategy, post-merge validation).
10. Set `git.merge_sha` and `git.merge_strategy` in `state.json`.

## Inputs

- `.claude/.work/<id>/state.json` (approvals, git config)
- `.claude/.work/<id>/validation-results.md`
- `.claude/.work/<id>/cicd.md`

## Required Output

Updated `.claude/.work/<id>/cicd.md` with merge section including:

- merge SHA, strategy used, post-merge validation results
- branch cleanup confirmation

Follow `templates/artifact-format.md` for structure. Apply `templates/evidence-standard.md` throughout.

## Failure Protocol

- If merge fails (branch protection, CI checks), do NOT force. Record blocker, stay in `approval-wait`.
- If auth fails, preserve branch state, report exact blocker.
- If post-merge validation fails, record in `cicd.md` — the merge is already done; report for human triage.
