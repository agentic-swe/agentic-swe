# /work

Start a new work item or resume an existing one.

## Prompt

You are running `/work`.

**Dispatch:** If `$ARGUMENTS` matches an existing work ID in `.claude/.work/`, resume that work item. Otherwise, treat `$ARGUMENTS` as a new task description.

### Start Mode (new task)

1. If you are in a target repository and `.claude/CLAUDE.md` or the required `.claude/templates/` files are missing, run `/install` first.
2. Generate a short kebab-case work ID from the task description (e.g., `add-retry-logic`).
3. Create `.claude/.work/<id>/`.
4. Create `.claude/.work/<id>/state.json` from `.claude/templates/state.json`, filling in:
   - `work_id`, `task`, `current_state: "initialized"`
   - `created_at` and `updated_at` with current ISO-8601 timestamp
   - `timeout_at` with current timestamp + 24 hours
5. Create `.claude/.work/<id>/audit.log` and `.claude/.work/<id>/progress.md` from the templates.
6. Branch setup (delegate to `.claude/agents/git-ops.md` if complex):
   a. Detect base branch: check for `main`, then `master`, then current. Record in `state.json.git.base_branch`.
   b. `git fetch origin <base> && git checkout <base> && git pull origin <base>`
   c. `git checkout -b work/<work-id>` (check `git branch --list work/<work-id>` first for collision).
   d. Record `state.json.git.working_branch = "work/<work-id>"`.
   e. Do NOT push yet — no remote branch until commits exist.
7. Read `CLAUDE.md` for the authoritative state machine and operating loop.
8. Execute the operating loop (see below).

### Resume Mode (existing work ID)

1. Read the current `state.json`.
2. Set `resume.detected` to `true`, `resume.detected_at` to current timestamp.
3. Git state validation:
   a. `git status --short` — if dirty worktree with unrelated changes, STOP and surface to user.
   b. `git branch --show-current` — if not on `state.json.git.working_branch`, checkout it.
   c. If working branch does not exist locally: `git fetch origin && git checkout -b <branch> origin/<branch>`. If not on remote either: STOP — branch was deleted, escalate.
   d. `git fetch origin <base_branch>`
   e. `git log HEAD..origin/<base_branch> --oneline` — if base has advanced: `git rebase origin/<base_branch>`. If conflicts: STOP, surface to user with conflict details.
   f. Set `resume.branch_validated = true`, `resume.rebase_performed = (true if rebased)`.
   g. Record git state (branch, SHA, rebase status) in history entry.
4. Check `timeout_at` — if the work item has been idle beyond the timeout, warn the user before continuing.
5. Read any existing artifacts in `.claude/.work/<id>/`.
6. If the current state is a human gate (`ambiguity-wait`, `approval-wait`, `escalate-code`, `escalate-validation`), do not proceed without user input.
7. Respect loop budgets already recorded in `state.json`.
8. Update `timeout_at` to current timestamp + 24 hours on resume.
9. Continue the operating loop (see below).

### Operating Loop

- Before each phase: invoke `/check budget`
- Before each transition: invoke `/check transition`
- After artifact creation: invoke `/check artifacts`
- Execute phases using the matching prompt in `.claude/phases/`
- Follow either:
  - fast path: `fast-implementation → validation`
  - full path: `design → design-review → verification → test → implementation → code-review → permissions → validation`
- If validation succeeds, execute `pr-created` and stop at `approval-wait`.
- When resuming at `approval-wait`:
  - If `approvals.pr_approved == true`: execute `.claude/phases/completion.md`, transition to `completed`.
  - If `approvals.changes_requested == true`:
    a. Fetch PR feedback: `gh pr view --json reviews,comments`
    b. Write `.claude/.work/<id>/approval-feedback.md` with structured review findings
    c. Increment `counters.approval_iter`
    d. Transition `approval-wait → implementation`
    e. Implementation phase reads `approval-feedback.md` as mandatory additional input
- Stop only at: `ambiguity-wait`, `approval-wait`, `escalate-code`, `escalate-validation`, `completed`, `failed`

## Output

Return:

- work id
- current state
- artifacts written
- whether human input is required
