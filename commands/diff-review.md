---
name: diff-review
description: "Review code changes against structured criteria with evidence-backed findings."
---

# /diff-review

Review code changes against structured criteria with evidence-backed findings.

## Prompt

You are reviewing code changes for defects, risks, and quality issues. Produce structured, evidence-backed findings.

Arguments: `$ARGUMENTS`

- If arguments specify a commit range or file list, scope the review to those changes.
- If no arguments, review all uncommitted changes (staged + unstaged) and untracked files in the working tree.

### Procedure

1. **Gather the diff**:
   - If scoped: `git diff <range>` or `git diff -- <files>`
   - If unscoped: `git diff HEAD` (all uncommitted changes)
   - If comparing branches: `git diff <base>...<head>`
   - Record the exact command used and the number of files/lines changed.

2. **Classify changes**:
   - For each changed file, classify the change type: new file, modified, deleted, renamed, permissions change.
   - Note files with large diffs (>200 lines) — flag for extra scrutiny.

3. **Review against criteria**:
   Apply each criterion to every changed file. For each finding, cite the file and line range.

   **Correctness**:
   - Does the change implement the intended behavior?
   - Are edge cases handled (null, empty, boundary, error paths)?
   - Are error conditions caught and handled appropriately?
   - Is the logic sound (off-by-one, operator precedence, type coercion)?

   **Safety**:
   - Any command injection, path traversal, XSS, SQL injection, or deserialization risk?
   - Are secrets, credentials, or PII introduced or exposed?
   - Are destructive operations (delete, overwrite, drop) properly gated?
   - Are external inputs validated at trust boundaries?

   **Consistency**:
   - Does the change follow existing patterns in the surrounding code?
   - Are naming conventions consistent?
   - Are imports, exports, and module boundaries respected?

   **Test coverage**:
   - Are new behaviors covered by tests?
   - Are modified behaviors' existing tests updated?
   - Are edge cases and error paths tested?

   **Complexity**:
   - Is the implementation the simplest that satisfies requirements?
   - Are there unnecessary abstractions, indirections, or premature generalizations?
   - Could any part be simplified without losing correctness?

4. **Produce findings**:
   - Each finding must follow the evidence standard: observed → inferred → evidence → uncertain.
   - Classify severity: `blocking` (must fix), `warning` (should fix), `note` (optional improvement).
   - Do not produce findings for style preferences unless they violate configured linter rules.

### Output Format

```markdown
# Diff Review

## Scope
- **Command**: `<exact git diff command>`
- **Files changed**: <count>
- **Lines**: +<added> / -<removed>

## Verdict
- **Result**: APPROVED | CHANGES_REQUESTED | NEEDS_DISCUSSION
- **Blocking findings**: <count>
- **Warnings**: <count>
- **Notes**: <count>

## Findings

### [BLOCKING] <short title>
- **File**: `<path>:<line range>`
- **Observed**: <what the code does>
- **Risk**: <what could go wrong>
- **Suggestion**: <specific fix>

### [WARNING] <short title>
- **File**: `<path>:<line range>`
- **Observed**: <what the code does>
- **Risk**: <what could go wrong>
- **Suggestion**: <specific fix>

### [NOTE] <short title>
- **File**: `<path>:<line range>`
- **Observation**: <what was noticed>

## Files Reviewed
| File | Type | Lines Changed | Findings |
|------|------|---------------|----------|
| ... | ... | ... | ... |
```

### Rubric Scoring (when invoked by code-review or design-review)

If the caller requests rubric scoring, append:

```markdown
## Rubric Scores
| Dimension | Score (1-3) | Evidence |
|-----------|-------------|----------|
| Correctness | ... | ... |
| Safety | ... | ... |
| Test adequacy | ... | ... |
| Design conformance | ... | ... |
| Complexity | ... | ... |

**Verdict**: APPROVED (all ≥ 2) | CHANGES_REQUESTED (any = 1)
```

### Failure Protocol

- If the diff is empty, report "no changes to review" and exit.
- If a file in the diff cannot be read (deleted on disk but in diff), note it and continue with remaining files.
- Do not suggest changes that contradict the repository's existing patterns without citing why.
- Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` to all findings.
