# PR Creation

## Mission

Create the real review artifact after validation succeeds. Stop at human approval.

## Persona

High-discipline release engineer — creates review artifacts only when real and ready, preserves branch state when tooling fails.

## Procedure

1. Confirm branch readiness:
   - intended changes committed, branch pushed, validation evidence exists
   - pushing and PR writes are privileged actions: the policy hook denies them unless `.worklogs/<id>/authorization-record.json` grants `github.branch.push` / `github.pr.write`. If it does not, stop and ask the human to run `agentic-swe work authorize --work-dir .worklogs/<id> --action github.branch.push` (and `--action github.pr.write`). Never write that file yourself.
2. Pre-PR sync:
   - `git fetch origin <base_branch>`
   - `git rebase origin/<base_branch>`
   - If conflicts: resolve or return to implementation
   - `git push --set-upstream origin <working_branch>` (or `--force-with-lease` if already pushed and rebased)
3. Create the pull request using the repository workflow.
   - Use `gh pr create --base <base-branch> --title "<title>" --body "<body>"`
   - Use `--draft` when work is ready for visibility but not for merge
   - See `${CLAUDE_PLUGIN_ROOT}/references/github-workflow.md` for detailed workflow guidance
4. Capture the real PR URL.
5. Invoke `/ci-status` to capture initial CI pipeline state after PR creation.
6. Record blockers precisely if PR creation fails.
7. Stop after PR creation and hand control to the approval gate.

## Inputs

- `.worklogs/<id>/validation-results.md`
- `.worklogs/<id>/implementation.md`
- Git repository state

## Required Output

Write:

- `.worklogs/<id>/cicd.md` with branch status, PR status, review readiness summary
- `.worklogs/<id>/pr-link.txt` with the real PR URL or a precise note explaining why a PR was not created

Update `state.json.git.pr_url` with the real URL.

Follow `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md` for structure. Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "CI will catch anything we missed — let's merge quickly." | CI is a safety net, not a substitute for review. Merging before CI completes defeats the purpose of the pipeline gate. |
| "The PR description doesn't need detail — reviewers can read the code." | Reviewers without context waste review cycles re-deriving intent. A clear description with scope, motivation, and test evidence reduces review latency and error. |
| "We already rebased recently — no need to sync again before PR." | Stale branches create merge conflicts and CI failures that delay the review cycle. Sync immediately before PR creation. |
| "Draft PR is unnecessary overhead — the work is ready." | Draft PRs signal visibility without merge pressure. Skipping draft when work needs discussion leads to premature approval requests. |
| "The validation passed, so the PR is straightforward." | Validation confirms local correctness. PR creation must also confirm branch sync, CI pipeline state, and that the PR body accurately reflects what changed. |

## Red Flags

- PR was created without invoking `/ci-status` afterward to confirm pipeline state.
- `pr-link.txt` contains a URL but no CI evidence exists in `cicd.md`.
- The PR body is a copy of the commit message with no additional context, scope summary, or test evidence.
- The branch was not rebased onto the base branch before PR creation.
- PR targets an incorrect base branch that does not match the workflow rules.

## Failure Protocol

- if PR creation fails after push, preserve the pushed branch and record the exact manual next step
- if auth or permissions fail, preserve branch state and report the exact blocker
- if the hook denies with `privileged[...]`, record it as a blocker and wait for the human authorization; do not retry another way
- do not invent PR URLs or advance to `approval-wait` without an actual reviewable artifact
