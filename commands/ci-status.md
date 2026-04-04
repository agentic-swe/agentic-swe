# /ci-status

Check CI/CD pipeline status for a branch or pull request with structured reporting.

## Prompt

You are checking CI/CD status. Query GitHub for check runs and report structured results.

Arguments: `$ARGUMENTS`

- If a PR number or URL is provided, check that PR's status.
- If a branch name is provided, check the latest commit's status on that branch.
- If no arguments, check the current branch's latest push.

### Procedure

1. **Identify target**:
   - If PR: `gh pr view <number> --json statusCheckRollup,mergeable,mergeStateStatus,state`
   - If branch: `gh api repos/{owner}/{repo}/commits/{branch}/status` and `gh api repos/{owner}/{repo}/commits/{branch}/check-runs`
   - If current branch: determine branch name via `git branch --show-current`, then query as above.

2. **Collect check results**:
   - For each check run: name, status (queued/in_progress/completed), conclusion (success/failure/neutral/skipped/cancelled/timed_out), duration, URL.
   - For each status context (legacy status API): context, state, target_url, description.
   - Note the overall rollup status: pass, fail, pending.

3. **Assess mergeability** (PR only):
   - Is the PR mergeable? (clean, dirty, blocked, unknown)
   - Required checks passing?
   - Review approval status?
   - Branch protection requirements met?

4. **Detect actionable issues**:
   - Failed checks: which ones, link to logs.
   - Pending checks: which ones, how long queued.
   - Flaky indicators: check that failed then passed on retry.

### Output Format

```markdown
# CI Status

## Target
- **Type**: PR #<number> | Branch: <name>
- **Commit**: <sha (short)>
- **Overall**: PASSING | FAILING | PENDING | NO_CHECKS

## Check Runs
| Name | Status | Conclusion | Duration | Link |
|------|--------|------------|----------|------|
| ... | ... | ... | ... | ... |

## Mergeability (PR only)
- **Mergeable**: yes | no | blocked | unknown
- **Required checks**: <passing count>/<total count>
- **Review status**: approved | changes_requested | pending | none
- **Blockers**: <list or "none">

## Action Items
- <specific next steps if any checks failed or are pending>
```

### Failure Protocol

- If `gh` CLI is not authenticated, report `BLOCKED` with "GitHub CLI not authenticated".
- If the branch or PR does not exist, report the error clearly.
- If no CI is configured (no checks found), report `NO_CHECKS` — do not fabricate status.
- Do not trigger or re-run CI. Report status only.
