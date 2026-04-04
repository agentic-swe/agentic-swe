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

1. Present the PR to the human:
   - PR URL (from `pr-link.txt`)
   - One-line summary of what changed
   - CI status (pass/fail/pending from `cicd.md`)
   - Key test results

2. **Wait for the human to review and respond.** Do not auto-approve.

3. Handle the human's response:

   **If approved:**
   - Set `state.json.approvals.pr_approved = true`
   - Transition to `completed`

   **If changes requested:**
   - Set `state.json.approvals.changes_requested = true`
   - Record the feedback in `approval-feedback.md`
   - Increment `state.json.counters.approval_iter`
   - If `approval_iter` > 3, escalate rather than looping
   - Apply the same **Review Response Protocol** as in `${CLAUDE_PLUGIN_ROOT}/phases/code-review.md`: verify each requested change against the codebase and tests before acting; push back with evidence (paths, test output, docs) when a request is wrong or contradicts approved design; fix one coherent item at a time with tests rather than batching unrelated edits.
   - Transition back to `implementation` for rework

   **If rejected / cancelled:**
   - Record reason in `approval-feedback.md`
   - Transition to `pipeline-failed`

## Output

- `approval-feedback.md` — human feedback recorded (when changes requested)
- Updated `state.json` approval fields

## Next State

- `completed` — PR approved, proceed to merge
- `implementation` — changes requested, rework needed
- `pipeline-failed` — task cancelled by human
