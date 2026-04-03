# TDD discipline (AI agents)

Use this when `state.json.pipeline.tdd_mode` is `true`. Feasibility activates `tdd_mode` when the repo has a functioning test framework **and** the task touches observable behavior (not docs-only, config-only, or pure refactors with existing coverage).

## Red-green-refactor for agents

The cycle is epistemic, not ceremonial. Each step produces evidence that the previous step cannot fake.

1. **Red** — write a test that describes the intended behavior. Run it. It must fail. Record the failing output in the implementation artifact. If it passes, either the behavior already exists (update scope) or the test is wrong (fix the test).
2. **Green** — write the minimum production code to make the failing test pass. Nothing more. Run the test again. Record the passing output.
3. **Refactor** — clean up duplication, rename, simplify. Run tests again to confirm no regressions. Record the result.

The artifact trail is: failing output → code change → passing output → cleanup → still passing. Each transition must be evidenced, not narrated.

## Why this matters for AI agents specifically

AI agents are prone to writing implementation and tests simultaneously, which destroys the epistemic value of the test. A test written alongside or after the code only proves the test matches the code — not that the code matches the requirement. The red step is what connects the test to the requirement.

## Activation criteria

Feasibility sets `tdd_mode: true` in `state.json.pipeline` when **all** of:

- `/repo-scan` detects a test framework (jest, pytest, go test, rspec, etc.)
- The task modifies or adds observable behavior (API endpoints, business logic, CLI commands, data transformations)
- The task is not exclusively documentation, configuration, or dependency updates

When `tdd_mode` is false, normal test-strategy phase rules apply — tests are still expected but the red-green-refactor evidence chain is not enforced.

## Evidence requirements in artifacts

When `tdd_mode` is active, `implementation.md` must contain a `## TDD Evidence` section with:

| Step | Required evidence |
|------|-------------------|
| Red | Test code written, test command run, **failing** output captured verbatim |
| Green | Production code written, same test command, **passing** output captured |
| Refactor | Refactored code, tests still passing (output or confirmation) |

Multiple red-green-refactor cycles are expected for multi-behavior changes. Each cycle targets one behavior.

## Anti-patterns

### Mock abuse

Mocking a dependency you don't understand produces tests that pass against your assumptions, not against reality. Before mocking, read the real interface. Mock only the I/O boundary, not internal logic.

### Test-only production methods

Adding a method to production code solely so a test can call it is a design smell. If the test needs access, the interface is wrong — fix the interface, not the test.

### Incomplete mocks that silently pass

A mock that returns a happy-path response for every call will never catch integration failures. Mocks must model at least: success, expected errors, and edge-case shapes (empty, null, large).

### Integration-as-afterthought

Writing only unit tests during TDD and deferring integration tests "for later" defeats half the value. If the change involves component boundaries, at least one integration-level red-green cycle is required.

## Rationalization table

These are common reasons agents (and humans) skip TDD. None of them hold.

| Excuse | Rebuttal |
|--------|----------|
| "It's a simple change" | Simple changes are the cheapest to TDD. If it's truly simple, the red step takes 30 seconds. |
| "I'll add tests after" | Tests-after only prove the code matches itself. You lose the requirement-verification link. |
| "The test framework isn't set up" | Then `tdd_mode` should be false. If it's true, the framework exists — use it. |
| "I need to see the implementation shape first" | Write the test as a specification of the external behavior. You don't need internals to describe what the function should return. |
| "Mocking is too complex for this" | If the dependency is too complex to mock, that's an integration test — write that instead. Don't skip testing. |
| "The existing code doesn't have tests" | You're not responsible for legacy coverage. You are responsible for proving your change works. |
| "TDD slows me down" | TDD slows the first draft. It accelerates debugging, review, and rework — where most time actually goes. |

## Scope

This reference is consumed by:

- `.claude/phases/test-strategy.md` (Phase 1 stub generation under TDD)
- `.claude/phases/implementation.md` and `.claude/phases/fast-path-implementation.md` (evidence requirements)
- `.claude/agents/developer-agent.md` (working method)

Related: `.claude/references/testing-anti-patterns.md`, `.claude/references/tdd-examples.md`
