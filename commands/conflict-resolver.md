---
name: conflict-resolver
description: "Detect, classify, and resolve git merge/rebase conflicts with structured reporting."
---

# /conflict-resolver

Detect, classify, and resolve git merge/rebase conflicts with structured reporting.

## Prompt

You are resolving git conflicts. Detect conflicts, classify their complexity, attempt safe resolution, and report results.

Arguments: `$ARGUMENTS`

- If arguments specify a merge or rebase command, execute it and handle resulting conflicts.
- If no arguments, inspect the current worktree for existing unresolved conflicts.

### Procedure

1. **Detect conflict state**:
   - Check `git status` for unmerged paths.
   - If no conflicts exist and no merge/rebase argument was given, report "no conflicts detected" and exit.
   - If a merge/rebase command was requested, execute it and capture the result.

2. **Inventory conflicting files**:
   - List each conflicting file path.
   - For each file, extract the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
   - Count conflict regions per file.

3. **Classify each conflict**:
   - **Trivial**: One side added, other didn't touch (auto-resolvable by accepting the addition).
   - **Formatting**: Only whitespace, import ordering, or line ending differences.
   - **Content**: Both sides modified the same lines with different intent.
   - **Structural**: File renamed/moved on one side, modified on other. Or deleted on one side, modified on other.
   - **Complex**: Overlapping logic changes requiring human judgment.

4. **Attempt resolution** (safe cases only):
   - **Trivial**: Accept the addition. Stage the file.
   - **Formatting**: Accept the version consistent with the project's formatter config. Stage the file.
   - **Content** (when one side is clearly a superset): Accept the superset. Stage the file.
   - **Structural/Complex**: Do NOT auto-resolve. Report as requiring human review.

5. **Verify resolution**:
   - For each resolved file, confirm no conflict markers remain.
   - If all conflicts resolved, do NOT finalize the merge/rebase (do not commit or continue). Leave staged for human verification.
   - Report what was resolved and what remains.

### Output Format

```markdown
# Conflict Resolution

## Context
- **Operation**: merge | rebase | existing conflicts
- **Source**: <branch or commit being merged/rebased>
- **Target**: <current branch>

## Conflicts
| File | Regions | Classification | Resolution |
|------|---------|---------------|------------|
| ... | ... | trivial/formatting/content/structural/complex | resolved/manual |

## Resolved (<count>)
- `<file>`: <what was done>

## Requires Manual Resolution (<count>)
- `<file>`: <why auto-resolution is unsafe>

## Status
- **Auto-resolved**: <count>/<total>
- **Remaining**: <count>
- **Next step**: <"all resolved — verify and continue" | "manual resolution needed for N files">
```

### Failure Protocol

- Do NOT commit or run `git merge --continue` / `git rebase --continue`. Leave resolved files staged for verification.
- Do NOT force-resolve content or structural conflicts. Report them for manual review.
- If the merge/rebase command itself fails for reasons other than conflicts (e.g., "not a git repository"), report the error and stop.
- If conflict markers remain in any file after resolution attempt, flag it immediately.
