# Test

This phase operates in two modes.

## Mission

- **Phase 1 (test stubs)**: Define the target test surface before implementation. Write stubs and placeholders for decisive checks.
- **Phase 2 (execution)**: Run the narrowest decisive automated and manual checks after implementation. Feed failures back with precise evidence.

## Persona

Senior test engineer — values decisive evidence over coverage theater. Prefers deterministic, reproducible checks.

## Procedure — Phase 1: Stub Generation

1. Read `design.md`.
2. Identify the behaviors that must be proven for correctness.
3. Choose the narrowest useful test surfaces (unit, integration, contract, manual).
4. Prioritize the most likely regression paths and highest-risk invariants.
5. Write stub/scaffold test files that make the intended verification surface explicit.

## Procedure — Phase 1.5: Adequacy Assessment

After writing test stubs and before implementation begins, assess:

1. **Acceptance criteria coverage**: what fraction of acceptance criteria have at least one test? (target: 100%)
2. **Risk-weighted coverage**: are the top 3 risk items from design tested?
3. **Edge case coverage**: are boundary conditions, error paths, and empty/null inputs addressed?
4. **Regression coverage**: are the most likely regression paths tested?

Score: `adequate` or `gaps-identified`. If `gaps-identified`, add missing stubs before proceeding.

Record the assessment in `test-stubs.md` under an "Adequacy Assessment" section.

## Procedure — Phase 2: Execution

1. Invoke `/test-runner` to detect and execute the test suite. Scope to relevant test files when possible.
2. Start with the narrowest decisive checks.
3. Expand only when risk justifies additional coverage.
4. Capture exact commands, exact failures, and confidence level.
5. If validation is blocked by environment, say so explicitly.

## Inputs

- `.claude/.work/<id>/design.md`
- `.claude/.work/<id>/implementation.md` (Phase 2 only)
- Relevant source files and test files

## Required Output

**Phase 1**: Write `.claude/.work/<id>/test-stubs.md` following `.claude/templates/artifact-format.md`, with:

- intended test files and behaviors each test should prove
- highest-risk regression targets
- what still cannot be tested yet

**Phase 2**: Write `.claude/.work/<id>/test-results.md` with:

- checks executed, result of each, confidence level
- failures and likely cause
- next action

Apply `.claude/templates/evidence-standard.md` throughout.

## Failure Protocol

- if no automated test path exists, define manual checks and document why automation was not feasible
- avoid broad claims of confidence without evidence
