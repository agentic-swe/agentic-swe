# Approval Wait

## Mission

Present the created PR to the human for review and block until approval, change requests, or rejection. This is the final human gate before completion.

## Persona

Patient Hypervisor — presents the work clearly, waits for explicit human decision, and responds to feedback precisely.

## Inputs

- `pr-link.txt` — URL of the created PR
- `cicd.md` — CI/CD status summary
- `implementation.md` — what was built
- `validation-results.md` — test and lint results

## Procedure

1. Compute risk flags for the PR diff and save them as evidence:
   `agentic-swe work risk-flags --work-dir <.worklogs/id> --base <pr base, e.g. origin/main> --write`
   This writes `approval-risk.json` (security-sensitive paths, new dependencies, permission changes).

2. Present the PR to the human:
   - PR URL (from `pr-link.txt`)
   - One-line summary of what changed
   - CI status (pass/fail/pending from `cicd.md`)
   - Key test results
   - **Risk flags** — list every flag from `approval-risk.json` verbatim; do not summarize a `high` level away

3. **Wait for the human to review and record a decision themselves.** Do not auto-approve. The human runs, in their own terminal:
   `agentic-swe work approve --work-dir <.worklogs/id> --decision approved|changes_requested [--note "…"]`
   The command refuses agent sessions and non-interactive stdin, shows the risk flags again, records `approval-record.json` under the user's git identity, appends `audit.log`, and performs the transition. Any other attempt to leave `approval-wait` fails with `HUMAN_APPROVAL_REQUIRED`. Never run `work approve` yourself and never write `approval-record.json`.
   When `pr-link.txt` is a github.com pull request, `approved` also checks GitHub before recording anything. A code owner's latest review must be `APPROVED` on the head SHA (not stale, not dismissed). No code owner may be requesting changes, and the required checks must be green. The token comes from `AGENTIC_SWE_GITHUB_TOKEN` (fine-grained, read-only). The verdict is journaled as a `github.verified` event whether or not it passes, and every API call goes to `github-calls.jsonl`. `approval-wait → completed` fails with `GITHUB_APPROVAL_REQUIRED` without an approved verdict from the current round. A non-GitHub PR link keeps only the local record.
   `agentic-swe founder status` shows the human every item waiting on them; `founder approve` is the same command as `work approve`.

4. After the human's command completes, read `state.json` and continue:

   **If approved** (`current_state` is `completed`, `approvals.pr_approved = true`):
   - Report completion

   **If changes requested** (`current_state` is `implementation`, feedback appended to `approval-feedback.md`, `counters.approval_iter` incremented):
   - If `approval_iter` > 3, escalate rather than looping
   - Apply the same **Review Response Protocol** as in `${CLAUDE_PLUGIN_ROOT}/phases/code-review.md`: verify each requested change against the codebase and tests before acting; push back with evidence (paths, test output, docs) when a request is wrong or contradicts approved design; fix one coherent item at a time with tests rather than batching unrelated edits.
   - Rework in `implementation` (the transition was already made by `work approve`)

   **If rejected / cancelled:**
   - Record reason in `approval-feedback.md`
   - Transition to `pipeline-failed`

## Output

- `approval-risk.json` — risk flags for the diff the human reviewed
- `approval-record.json` — decision, user identity, approval round, risk summary (written by `work approve`)
- `github-calls.jsonl` — hash-chained method, endpoint, and status of each GitHub call (GitHub PRs only)
- `approval-feedback.md` — human feedback recorded (when changes requested)
- Updated `state.json` approval fields

## Common Rationalizations

| Rationalization | Why it's wrong |
|---|---|
| "Approved means ship it — no need to read the feedback closely." | Approvals often include non-blocking suggestions; ignoring them degrades quality and erodes reviewer trust. |
| "The reviewer didn't specify exact changes, so I'll interpret loosely." | Ambiguous feedback must be clarified, not guessed at — record your interpretation in `approval-feedback.md` and confirm. |
| "This is the third iteration; I'll just push something to move on." | Iteration pressure does not waive quality — if iteration 3 still has issues, escalate rather than shipping known defects. |
| "Changes requested are minor — I'll fix and skip re-review." | Every rework cycle must go through the Review Response Protocol; skipping re-review breaks the audit trail. |
| "The user said 'approve' in chat, so I'll run `work approve` for them." | A chat message is not an approval. The human records it in their own terminal so the record carries their identity, not the agent's. |
| "The risk flags are noisy; I'll leave them out of the summary." | Flags are what the human needs to see before trusting the PR. Present all of them; let the human decide which matter. |

## Red Flags

- `changes_requested` is true in `state.json` but no `approval-feedback.md` was produced.
- Rework committed without verifying each requested change against codebase and tests per the Review Response Protocol.
- `approval_iter` exceeds 3 without escalation.
- PR approved but CI status in `cicd.md` shows failures or is not re-checked after the latest push.
- Human feedback recorded but no corresponding changes visible in the implementation diff.
- `history` entry leaving `approval-wait` whose actor is not `user:…`, or `approval-record.json` written while an agent session was active.
- Risk level `high` in `approval-risk.json` but the flags were not shown to the human.

## Next State

- `completed` — PR approved, proceed to merge
- `implementation` — changes requested, rework needed
- `pipeline-failed` — task cancelled by human
